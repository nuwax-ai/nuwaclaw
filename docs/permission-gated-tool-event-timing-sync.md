# Permission-Gated Tool 事件时序补丁同步说明

更新时间：2026-06-04

## 1. 问题抽象

这是一个通用的 tool event 与 permission event 时序问题。

当 `agentMode = ask` 时，某些工具调用需要先经过 ACP `session/request_permission` 审批。但部分 ACP engine 会先发出该工具的 `session/update`：

```text
1. session/update: tool_call 或 tool_call_update
   toolCallId = call_xxx
   rawInput = 工具输入
   status = pending / in_progress

2. session/request_permission
   toolCallId = call_xxx

3. 用户审批 Selected / Cancelled

4. session/update: tool_call_update
   toolCallId = call_xxx
   status = completed
   rawOutput = 工具执行结果
```

如果第 1 步的 `rawInput` 会触发前端业务交互或副作用，而 Host 又直接把它透传给前端，就会出现“工具尚未被允许，前端已经开始处理工具输入”的问题。

当前观测到的具体表现是：前端先渲染了一个交互卡片，随后又渲染权限审批卡片，用户操作顺序被打乱，最终可能导致原会话仍阻塞在权限审批上。

## 2. 通用原则

> 对 permission-gated tool，在权限审批完成前，Host 不应把会触发前端业务交互或副作用的 tool input 透传给前端。

推荐行为：

1. 权限审批前收到 `tool_call` / 未完成 `tool_call_update`：
   - Host 缓存必要的 `rawInput`。
   - 不向前端下发会触发业务交互的事件。
2. 权限审批事件 `request_permission`：
   - 正常下发。
   - 前端只展示权限审批。
3. 权限通过后收到完成态 `tool_call_update`：
   - Host 补回之前缓存的 `rawInput`。
   - 再下发给前端。
4. 非交互型工具：
   - 如果前端只是只读展示工具进度，可以继续透传，不需要拦截。

## 3. 当前触发案例

当前 NuwaClaw 遇到的触发案例是 `nuwax_ask_question`。

该工具的 `rawInput` 会被前端识别为结构化交互表单。如果在权限审批前透传，前端会提前渲染业务卡片；而同一个 tool call 随后还会触发 ACP 权限审批卡片。

因此 NuwaClaw 当前补丁按 `rawInput` 形态判断是否为交互型输入，而不是按工具名白名单判断。当前判断条件是 `rawInput.ui` 存在且为对象；普通只读工具进度不受影响。

## 4. NuwaClaw 当前实现

NuwaClaw 在 ACP engine 的 SSE 转发前做 normalize。

| 文件 | 说明 |
| --- | --- |
| `crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts` | 在 `handleAcpSessionUpdate` 转发 `computer:progress` 前调用 normalize |
| `crates/agent-electron-client/src/main/services/engines/acp/permissionGatedToolUpdate.ts` | permission-gated interactive tool input 的时序补丁逻辑 |
| `crates/agent-electron-client/src/main/services/engines/acp/permissionGatedToolUpdate.test.ts` | 回归测试 |

当前实现行为：

1. 识别带 `rawInput.ui` 的交互型工具输入。
2. 权限审批前的 `tool_call` 或未完成 `tool_call_update`：
   - 按 `toolCallId` 缓存 `rawInput`。
   - 不继续转发。
3. 完成态 `tool_call_update`：
   - 条件：`status = completed` 且存在 `rawOutput`。
   - 按 `toolCallId` 补回缓存的 `rawInput`。
   - 正常转发。
4. `request_permission` 权限审批事件不受影响。
5. 普通工具不受影响。

## 5. rcoder / 云电脑是否需要同步

需要确认 rcoder/云电脑是否满足以下条件：

- 支持 `agentMode = ask`。
- 会把 ACP `session/update` 的 `tool_call` / `tool_call_update` 透传为 SSE。
- 存在某些工具的 `rawInput` 会被前端识别为业务交互或触发副作用。
- `session/request_permission` 可能晚于 `tool_call` / 未完成 `tool_call_update` 到达。

如果满足，就需要同步同类补丁。

这不是前端展示问题，而是 Host 对 permission-gated tool event 的下发时机问题。前端无法稳定判断某个 `rawInput` 是否已经通过权限审批。

## 6. rcoder 推荐落点

建议放在所有 progress 输出的共同出口，优先级如下：

1. **Session 消息入缓存 / 入队前**
   - 覆盖实时 SSE 和 ring buffer 重连回放。
   - 适合按 `toolCallId` 跨事件缓存 `rawInput`。
2. **SSE handler 序列化前**
   - 只覆盖当前连接输出。
   - 如果历史缓存已保存权限前事件，重连仍可能复现。
3. **前端适配器**
   - 不推荐作为主修复点。
   - 前端缺少权限审批状态上下文，容易误判。

rcoder 同学可重点检查：

| 路径 | 关注点 |
| --- | --- |
| `crates/shared_types/src/model/agent_session_notify.rs` | `SessionUpdate::ToolCall` / `ToolCallUpdate` 转 `UnifiedSessionMessage` |
| `crates/agent_runner/src/service/session_cache.rs` | `UnifiedSessionMessage` 入 ring buffer / 实时 sender 前 |
| `crates/agent_runner/src/http_server/handlers/computer_progress.rs` | `/computer/*` SSE 输出 |
| `crates/agent_runner/src/http_server/handlers/rcoder_progress.rs` | `/rcoder/*` SSE 输出 |

如果 `session_cache.rs` 是所有 progress 输出共同出口，建议在这里做 normalize。

## 7. 建议接口形态

伪代码如下，仅表示行为，不要求照搬实现：

```rust
fn normalize_permission_gated_interactive_tool_update(
    message: UnifiedSessionMessage,
    raw_inputs_by_tool_call_id: &mut HashMap<String, Value>,
) -> Option<UnifiedSessionMessage> {
    if !is_tool_call_or_update(&message) {
        return Some(message);
    }

    if !is_interactive_or_side_effect_input(&message.data) {
        return Some(message);
    }

    if let Some(raw_input) = read_raw_input(&message.data) {
        raw_inputs_by_tool_call_id.insert(tool_call_id(&message.data), raw_input);
    }

    if !is_completed_tool_result(&message) {
        return None;
    }

    if missing_raw_input(&message.data) {
        attach_cached_raw_input(&mut message.data, raw_inputs_by_tool_call_id);
    }

    Some(message)
}
```

关键点：

- `toolCallId` 是缓存 key。
- `rawInput` / `raw_input` 都要按实际序列化格式兼容。
- `rawOutput` / `raw_output` 都要按实际序列化格式兼容。
- 完成态事件如果已经自带 `rawInput`，不要覆盖。
- 缓存丢失时不要阻塞完成态事件。
- `request_permission` 事件不应被该逻辑拦截。

## 8. 验收用例

### 用例 1：权限前交互型 tool input 不下发

输入：

```json
{
  "messageType": "agentSessionUpdate",
  "subType": "tool_call",
  "data": {
    "toolCallId": "call_interactive_1",
    "status": "pending",
    "rawInput": {
      "ui": {
        "version": "example.interaction.v1"
      }
    }
  }
}
```

期望：

- 不进入 SSE 输出。
- `rawInput` 被缓存到 `call_interactive_1`。

### 用例 2：权限审批事件正常下发

输入：

```json
{
  "messageType": "acpRequestPermission",
  "subType": "request_permission",
  "data": {
    "tool_call_id": "call_interactive_1",
    "request_permission_request": {}
  }
}
```

期望：

- 正常进入 SSE 输出。
- 前端只展示权限审批。

### 用例 3：完成态事件补回 rawInput 后下发

输入：

```json
{
  "messageType": "agentSessionUpdate",
  "subType": "tool_call_update",
  "data": {
    "toolCallId": "call_interactive_1",
    "status": "completed",
    "rawOutput": "{\"status\":\"pending\"}"
  }
}
```

期望：

- 正常进入 SSE 输出。
- 输出事件包含用例 1 缓存的 `rawInput`。
- 前端此时才渲染对应业务交互。

### 用例 4：普通只读工具进度不受影响

输入：

```json
{
  "messageType": "agentSessionUpdate",
  "subType": "tool_call",
  "data": {
    "toolCallId": "call_readonly_1",
    "status": "pending",
    "rawInput": {
      "command": "pwd"
    }
  }
}
```

期望：

- 正常进入 SSE 输出。
- 不写入交互型 tool input 缓存。

## 9. 前端可见效果

修复前：

```text
业务交互卡片先出现
权限审批卡片随后出现
用户操作业务卡片后，原工具调用仍可能阻塞在权限审批上
```

修复后：

```text
先只出现权限审批
用户允许后，工具真正执行
完成态 tool update 下发
前端再展示业务交互卡片
```

## 10. 与现有协议文档关系

- ACP Permission 数据契约仍以 `docs/permission-request-handler-design.md` 为准。
- 具体业务工具的数据契约仍以各自协议文档为准。
- 本文只定义 permission-gated tool event 的下发时序原则。
