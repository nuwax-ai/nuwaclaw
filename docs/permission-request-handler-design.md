# Permission Request Handler Design

## 概述

本文档描述如何在 RCoder 平台扩展支持用户审批 bash 命令的功能。

### 背景

当前 ACP 协议使用默认放行（YOLO）模式。为了提供更安全的控制机制，需要增加 `ask` 模式，允许用户手动审批 Agent 发起的危险 bash 命令。

### 设计目标

1. **YOLO 模式（默认）**: 所有命令自动放行，保持向后兼容
2. **ASK 模式**: Agent 请求 bash 命令时暂停执行，等待用户审批
3. **审批选项**: 支持 `allow_once`、`allow_always`、`reject_once`、`reject_always`
4. **规则存储**: 由 RCoder 服务端管理规则，前端只需选择是否保存

---

## 一、修改现有接口

### 1.1 `/computer/chat` 接口扩展

**位置**: `computer_agent_types.rs` -> `ComputerChatRequest`

**修改内容**: 在 `agent_config.agent_server` 下新增 `agent_mode` 字段

#### 修改 `ChatAgentServerConfig` 结构

```rust
// crates/shared_types/src/chat_agent_config.rs

/// 单个 Agent 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct ChatAgentServerConfig {
    /// ... 现有字段 ...

    /// Agent 运行模式
    /// - `yolo`: 默认模式，所有命令自动放行（向后兼容）
    /// - `ask`: 交互模式，危险命令需要用户审批
    #[serde(default = "default_agent_mode")]
    #[schema(example = "yolo", default = "yolo")]
    pub agent_mode: Option<String>,
}
```

**枚举值说明**:

| 值 | 说明 |
|----|------|
| `yolo` | YOLO 模式，所有命令自动放行（默认） |
| `ask` | ASK 模式，命令需要用户审批 |

---

## 二、新增 HTTP 接口

### 2.1 `/computer/notify-resolved` - 权限审批结果回执

**功能**: 前端调用此接口回传用户对权限请求的审批结果

#### 请求参数

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Selected": {
          "option_id": "always_allow:terminal"
        }
      }
    },
    "session_id": "session_789",
    "tool_call_id": "tool_001",
    "save_rule": true
  },
  "user_id": "user_123",
  "project_id": "proj_456",
  "pod_id": "pod_tenant_123",
  "tenant_id": "tenant_abc",
  "space_id": "space_xyz",
  "isolation_type": "tenant"
}
```

#### `PermissionResolveRequest` 结构体

**定义**：

```rust
pub struct PermissionResolveRequest {
    pub request_permission_response: RequestPermissionResponse,
    pub session_id: String,
    pub tool_call_id: String,
    pub save_rule: bool,
}

// ACP 协议定义
pub struct RequestPermissionResponse {
    pub outcome: RequestPermissionOutcome,
}

pub enum RequestPermissionOutcome {
    Cancelled,
    Selected(SelectedPermissionOutcome),
}

pub struct SelectedPermissionOutcome {
    pub option_id: String,
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `permission_resolve_request.request_permission_response` | Object | ✅ | 审批结果 |
| `permission_resolve_request.request_permission_response.outcome` | Object | ✅ | outcome 是 tagged enum，值为 `Cancelled` 或 `Selected` |
| `permission_resolve_request.request_permission_response.outcome.Selected.option_id` | String | ✅ | 用户选择的 option_id |
| `permission_resolve_request.session_id` | String | ✅ | 会话 ID（关联审批请求） |
| `permission_resolve_request.tool_call_id` | String | ✅ | 工具调用 ID（用于定位具体工具权限请求） |
| `permission_resolve_request.save_rule` | bool | ❌ | 是否保存为规则（默认 false） |
| `user_id` | String | ✅ | 用户 ID |
| `project_id` | String | ✅ | 项目 ID |
| `pod_id` | String | ❌ | Pod ID（共享容器模式） |
| `tenant_id` | String | ❌ | 租户 ID |
| `space_id` | String | ❌ | 空间 ID |
| `isolation_type` | String | ❌ | 隔离类型：tenant / space / project |

#### 设计说明

- **`session_id + tool_call_id` 组合定位**: 用于精确定位是哪个工具的权限审批请求
  - `session_id`: 关联会话
  - `tool_call_id`: 具体工具调用 ID（从 `tool_call.tool_call_id` 提取）
- **`option_id` 的来源和作用**:
  - `option_id` 是 **ACP Agent 生成**的，RCoder 只是透传
  - RCoder 收到 Agent 的 `RequestPermissionRequest` 后，将 `options`（含 `option_id`）展示给用户
  - 用户选择后，RCoder 把用户选择的 `option_id` 传回给 Agent
  - **RCoder 不需要理解 `option_id` 的含义**，那是 Agent 的事情
  - 参考 Zed Agent 的 `option_id` 格式（用于解析用户选择）：
    - `"allow"` / `"deny"` — 一次性允许/拒绝
    - `"always_allow:<tool>"` / `"always_deny:<tool>"` — 始终允许/拒绝
    - `"always_allow_mcp:<server>:<tool>"` / `"always_deny_mcp:<server>:<tool>"` — MCP 工具
- **`params.sub_patterns`** 由 Agent 生成，用于区分规则级别:
  - `sub_patterns` 非空 → pattern-level 规则
  - `sub_patterns` 为空 → tool-level 规则
- **`save_rule` 为布尔值**: 前端只需告诉 RCoder 是否保存规则
- **规则存储由 RCoder 处理**: RCoder 根据 `save_rule` 和原始请求信息生成规则

#### `Cancelled` vs `RejectOnce` 的区别

根据 ACP 协议，`RequestPermissionOutcome` 有两种拒绝场景：

| outcome | 使用场景 | 用户行为 |
|---------|----------|----------|
| `RejectOnce` | 用户在权限弹窗中选择"拒绝本次" | 用户明确拒绝该命令 |
| `Cancelled` | 用户取消整个会话，未对权限请求做任何选择 | 会话被取消，权限请求自动失效 |

**`Cancelled` 的典型场景**：
```
1. Agent 请求执行 `rm -rf /` 
2. RCoder 推送 SSE 权限请求给前端
3. 用户还没响应，点击了"取消会话"按钮
4. 客户端发送 `session/cancel` 通知
5. RCoder 必须对所有 pending 的 RequestPermissionRequest 回复 `Cancelled`
```

> **注意**：`Cancelled` 不是用于"取消正在执行的工具调用"，而是用于"整个会话被取消时，自动清理 pending 的权限请求"。

#### ASK 模式下取消会话的业务影响

当用户调用取消接口（`/computer/agent/session/cancel` 或 `/agent/session/cancel`）时：

```
┌─────────────────────────────────────────────────────────────────┐
│  ASK 模式下取消会话的处理流程                                    │
│                                                                 │
│  1. 用户调用取消接口                                           │
│  2. RCoder 收到 session/cancel 通知                            │
│  3. RCoder 检查该会话是否有 pending 的权限请求                  │
│     - PermissionStore.remove_by_session(session_id)             │
│  4. 对每个 pending 请求调用 responder(Cancelled)                │
│     - 必须回复 Cancelled，不能只删除 storage 中的记录           │
│  5. 清理完成后返回取消结果                                     │
└─────────────────────────────────────────────────────────────────┘
```

**业务影响点**：
- `yolo` 模式：无需处理权限请求（命令自动放行，无 pending 状态）
- `ask` 模式：**必须对所有 pending 权限请求回复 `Cancelled`**，否则：
  - Agent 会一直等待响应，导致会话无法正常结束
  - Responder 不会被 drop，可能造成资源泄漏

#### 响应格式

**成功响应** (`HttpResult`):

```json
{
  "code": "0000",
  "message": "Permission resolved successfully",
  "data": {
    "resolved": true,
    "session_id": "session_789",
    "tool_call_id": "tool_001",
    "outcome": {
      "Selected": { "option_id": "always_allow:terminal" }
    },
    "rule_saved": true
  },
  "tid": "trace_id_xxx",
  "success": true
}
```

**失败响应**:

```json
{
  "code": "ERR_PERMISSION_RESOLVE_FAILED",
  "message": "Failed to resolve permission request",
  "data": null,
  "tid": "trace_id_xxx",
  "success": false
}
```

#### 错误码

| 错误码 | 说明 |
|--------|------|
| `ERR_VALIDATION` | 参数校验失败（user_id/project_id/session_id/tool_call_id 为空） |
| `ERR_SESSION_NOT_FOUND` | 会话不存在 |
| `ERR_PERMISSION_NOT_FOUND` | 权限请求不存在（tool_call_id 不匹配） |
| `ERR_PERMISSION_RESOLVE_FAILED` | 权限审批处理失败 |
| `ERR_PERMISSION_EXPIRED` | 权限请求已过期 |
| `ERR_CONTAINER_ERROR` | 容器通信错误 |

---

## 三、SSE 事件扩展

### 3.1 权限请求 SSE 事件

**SSE 接口**：`GET /computer/progress/{session_id}`

**消息结构**：`UnifiedSessionMessage`

```rust
pub struct UnifiedSessionMessage {
    pub session_id: String,
    pub message_type: SessionMessageType,  // 新增 AcpRequestPermission
    pub sub_type: String,
    pub data: serde_json::Value,           // 包含 RequestPermissionRequest + RCoder 扩展字段
    pub timestamp: DateTime<Utc>,
}
```

**`SessionMessageType` 新增变体**：

```rust
pub enum SessionMessageType {
    SessionPromptStart,
    SessionPromptEnd,
    AgentSessionUpdate,
    Heartbeat,
    AcpRequestPermission,  // 🆕 新增
}
```

**SSE 推送的数据结构**：

```json
{
  "session_id": "session_789",
  "message_type": "acpRequestPermission",
  "sub_type": "request_permission",
  "data": {
    "request_permission_request": {
      "session_id": "session_789",
      "tool_call": {
        "tool_call_id": "tool_call_001",
        "kind": "bash",
        "status": "pending",
        "title": "bash",
        "content": [],
        "raw_input": { "command": "cargo build" },
        "_meta": {}
      },
      "options": [
        {
          "option_id": "always_allow:terminal",
          "name": "始终允许",
          "kind": "allow_always",
          "_meta": {}
        },
        {
          "option_id": "allow",
          "name": "允许本次",
          "kind": "allow_once",
          "_meta": {}
        }
      ],
      "_meta": {}
    },
    "tool_call_id": "tool_001",
    "save_rule": {
      "suggested_pattern": "^cargo\\s+build",
      "rule_type": "allow",
      "tool_name": "terminal"
    }
  },
  "timestamp": "2026-05-14T10:30:00Z"
}
```

**字段说明**：

**UnifiedSessionMessage 外层字段**：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `session_id` | String | - | 会话 ID |
| `message_type` | String | RCoder | 固定为 `acpRequestPermission` |
| `sub_type` | String | RCoder | 固定为 `request_permission` |
| `timestamp` | String | RCoder | 时间戳 |

**data.request_permission_request 字段**（ACP 协议，直接透传）：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `session_id` | String | ACP 协议 | 会话 ID |
| `tool_call` | Object | ACP 协议 | 工具调用信息（见 tool_call 子字段） |
| `options` | Array | ACP 协议 | 权限选项列表（见 options 子字段） |
| `_meta` | Object | ACP 协议 | ACP 协议扩展字段（可选） |

**data.request_permission_request.tool_call 子字段**：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `tool_call_id` | String | ACP 协议 | 工具调用 ID |
| `kind` | String | ACP 协议 | 工具类型（如 "bash"） |
| `status` | String | ACP 协议 | 执行状态 |
| `title` | String | ACP 协议 | 工具标题 |
| `content` | Array | ACP 协议 | 工具输出内容 |
| `raw_input` | Object | ACP 协议 | 工具输入参数 |
| `_meta` | Object | ACP 协议 | ACP 协议扩展字段（可选） |

**data.request_permission_request.options[] 子字段**：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `option_id` | String | ACP 协议 | 选项 ID |
| `name` | String | ACP 协议 | 选项显示名称 |
| `kind` | String | ACP 协议 | 选项类型（allow_once/allow_always/reject_once/reject_always） |
| `_meta` | Object | ACP 协议 | ACP 协议扩展字段（可选） |

**data.RCoder 扩展字段**：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `tool_call_id` | String | RCoder 扩展 | 工具调用 ID（从 tool_call.tool_call_id 提取，用于关联审批结果） |
| `save_rule` | Object | RCoder 扩展 | 规则建议（可选） |

**设计原则**：
- **`message_type` = `acpRequestPermission`** 表示这是权限请求事件
- **`data` 字段包含完整的 `RequestPermissionRequest` 内容**，直接透传 ACP 协议
- **`tool_call_id`**：RCoder 从 `tool_call.id` 提取，用于后续关联审批结果
- **`save_rule`**：RCoder 根据命令内容生成的规则建议

**前端展示建议**:
- `data.options` 中的每个选项直接展示给用户
- `option_id` 可当作不透明字符串，用户选择后原样传回
- 当用户选择 "始终允许" 时，`data.save_rule` 告诉前端可以保存规则
- 前端可以显示一个复选框："以后自动允许类似命令"
- 如果用户勾选，回传时设置 `save_rule: true`

---

## 四、数据流

### 4.1 ASK 模式完整流程

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   Client    │                    │    RCoder    │                    │ AgentRunner │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │ POST /computer/chat              │                                  │
       │ { agent_mode: "ask", ... }     │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │ gRPC Chat                        │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │    Agent 请求执行 bash 命令       │
       │                                  │    (RequestPermissionRequest)    │
       │                                  │    tool_call_id="tool_001"      │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │  SSE: AcpRequestPermission       │                                  │
       │  (session_id, tool_call_id,      │                                  │
       │   save_rule 建议)              │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │  [用户在前端审批]                 │                                  │
       │  - 选择: 允许/拒绝                │                                  │
       │  - 可选: 保存为规则 (checkbox)  │                                  │
       │                                  │                                  │
       │ POST /computer/notify-resolved   │ gRPC: RequestPermissionResponse │
       │ { permission_resolve_request: {  │─────────────────────────────────>│
       │   session_id,                    │                                  │
       │   tool_call_id,                   │                                  │
       │   request_permission_response,     │                                  │
       │   save_rule },                   │                                  │
       │   user_id, project_id }          │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │    命令执行结果                   │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │  🆕 RCoder 存储规则（如果 save_rule=true）│
       │                                  │                                  │
       │  SSE: AgentSessionUpdate        │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
```

### 4.2 规则自动匹配流程

**收到 RequestPermissionRequest 后的处理流程**：

1. **检查硬编码安全规则**（不可覆盖）
   - 匹配 `rm\s+-rf\s+/`、`rm\s+-rf\s+~` 等 → 直接 `respond(RejectAlways)` 拒绝
2. **RuleStore.match_rule(tool_name, command)** 检查是否有匹配规则
   - 匹配 `SavedRuleType::Allow`（用户允许规则）→ `respond(AllowAlways)` 自动放行，不发 SSE
   - 匹配 `SavedRuleType::Deny`（用户拒绝规则）→ `respond(RejectAlways)` 直接拒绝，不发 SSE
3. 无匹配 → 检查 `agent_mode`
   - `"yolo"` → `respond(AllowOnce)` 自动放行，不发 SSE
   - `"ask"` → 推送 SSE 给前端，等待用户审批

**YOLO 模式选项选择优先级**：
```
1. AllowAlways  (始终允许) - 优先选择
2. AllowOnce    (本次允许) - 其次选择
3. first()      (兜底)    - 最后取第一个选项
```
> 注意：不要盲目取第一个选项，因为 options[0] 可能是 deny 选项。

**优先级**（参考 Zed 的 `ToolPermissionDecision::from_input`）：

```
1. 硬编码安全规则 (Hardcoded Rules)     - 最高优先级，无法覆盖
2. always_deny 规则 (User Deny)        - 用户明确拒绝的规则
3. always_allow 规则 (User Allow)      - 用户明确允许的规则 → AllowAlways
4. agent_mode 检查                     - yolo=AllowOnce，ask=需要审批
```

**注意**：当 `always_allow` 规则匹配时，响应 `AllowAlways` 而非 `AllowOnce`，因为规则已存储，Agent 无需再次请求确认。

**硬编码安全规则**（不可覆盖，参考 Zed）：

Zed 的实现比简单 regex 复杂得多，包含标志组合、路径变体、链式命令处理等：

```rust
// 简化版示意（实际实现更复杂）
const FLAGS: &str = r"(--[a-zA-Z0-9][-a-zA-Z0-9_]*(=[^\s]*)?\s+|-[a-zA-Z]+\s+)*";
const TRAILING_FLAGS: &str = r"(\s+--[a-zA-Z0-9][-a-zA-Z0-9_]*(=[^\s]*)?|\s+-[a-zA-Z]+)*\s*";

// 根目录: "rm -rf /", "rm -rfv /", "rm -rf /*", "rm / -rf"
r"\brm\s+{FLAGS}(--\s+)?/\*?{TRAILING_FLAGS}$"

// Home 目录: "rm -rf ~", "rm -rf ~/", "rm -rf ~/*"
r"\brm\s+{FLAGS}(--\s+)?~/?\*?{TRAILING_FLAGS}$"

// $HOME: "rm -rf $HOME", "rm -rf ${HOME}", "rm -rf $HOME/*"
r"\brm\s+{FLAGS}(--\s+)?(\$HOME|\$\{{HOME\}})/?(\*)?{TRAILING_FLAGS}$"

// 当前目录: "rm -rf .", "rm -rf ./", "rm -rf ./*"
r"\brm\s+{FLAGS}(--\s+)?\./?\*?{TRAILING_FLAGS}$"

// 父目录: "rm -rf ..", "rm -rf ../", "rm -rf ../*"
r"\brm\s+{FLAGS}(--\s+)?\.\./?\*?{TRAILING_FLAGS}$"
```

**关键特性**：
- 处理各种标志组合 (`-rf`, `-rfv`, `-v -rf`, `--recursive --force`)
- 处理标志和操作数位置互换 (`rm / -rf` vs `rm -rf /`)
- 处理路径遍历 (`rm -rf /tmp/../../`)
- 处理多路径删除 (`rm -rf /tmp /`)
- 处理链式命令中的子命令

### 4.3 规则存储流程

```
┌─────────────────────────────────────────────────────────────────┐
│  RCoder 规则存储流程                                              │
│                                                                 │
│  1. 收到 /computer/notify-resolved (save_rule: true)           │
│  2. 从原始请求中提取信息:                                        │
│     - tool_name = "terminal"                                    │
│     - option_id = "always_allow:terminal"                       │
│     - params.terminal.patterns = ["^cargo\\s+build"]  // sub_patterns│
│  3. 根据 option_id 决定规则类型 (SavedRuleType):                 │
│     - "always_allow:terminal" → SavedRuleType::Allow          │
│     - "always_deny:terminal"  → SavedRuleType::Deny            │
│  4. 根据 sub_patterns 决定存储的 pattern:                       │
│     - sub_patterns 非空 → 存储 "^cargo\\s+build" (pattern-level)│
│     - sub_patterns 为空 → 存储 ".*" (tool-level)               │
│  5. 存储到内存 (HashMap)                                       │
│     - key: (project_id, user_id, tool_name)                    │
│     - value: Vec<PatternRule>                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Pattern 生成规则

参考 Zed 的 `pattern_extraction.rs`，pattern 生成规则如下：

#### Terminal 命令 (bash)

| 输入命令 | 生成的 Pattern | 说明 |
|----------|---------------|------|
| `cargo build` | `^cargo\\s+build(\\s\|$)` | 匹配 `cargo build` 及后续参数 |
| `npm install` | `^npm\\s+install(\\s\|$)` | 匹配 `npm install` 及后续参数 |
| `git status` | `^git\\s+status(\\s\|$)` | 匹配 `git status` |
| `./script.sh` | 无（拒绝） | 路径前缀不安全 |
| `/usr/bin/python` | 无（拒绝） | 绝对路径不安全 |
| `ls -la` | `^ls\\b` | 单命令，只匹配命令名 |

**安全规则**:
- 只允许已知的命令名（cargo, npm, git, ls 等）
- 拒绝 `./script.sh`、`/usr/bin/python` 等路径前缀
- 子命令后必须是空白字符或字符串结束

#### 文件路径

| 输入路径 | 生成的 Pattern | 说明 |
|----------|---------------|------|
| `src/main.rs` | `^src/` | 匹配 src/ 目录下所有文件 |
| `/Users/project/src/lib.rs` | `^/Users/project/src/` | 匹配完整父目录 |

#### URL

| 输入 URL | 生成的 Pattern | 说明 |
|----------|---------------|------|
| `https://github.com/user/repo` | `^https?://github\\.com` | 匹配域名 |

### 4.5 Pending 请求存储

存储等待用户审批的权限请求，使用 `(session_id, tool_call_id)` 作为 key。

| 结构 | 说明 |
|------|------|
| `PendingPermissionRequest` | 待审批的权限请求，含 tool_call、options、save_rule、responder、created_at |
| `PermissionStore` | Pending 请求存储，key = `(session_id, tool_call_id)` |

**核心操作**：
- `insert(session_id, tool_call_id, request)` — 插入待审批请求
- `remove(session_id, tool_call_id)` — 移除并返回请求
- `remove_by_session(session_id)` — 清理会话的所有请求

> **详细实现见附录「十、Rust 实现参考」章节**

### 4.6 规则存储

用户配置的 allow/deny 规则存储，key = `(project_id, user_id, tool_name)`。

| 结构 | 说明 |
|------|------|
| `PatternRule` | 单条规则，含 pattern（regex）、rule_type（Allow/Deny）、created_at |
| `RuleStore` | 规则存储，key = `(project_id, user_id, tool_name)` |

**核心操作**：
- `match_rule(project_id, user_id, tool_name, command)` — 检查命令是否匹配规则，返回 `Some(SavedRuleType)` 或 `None`
- `add_rule(project_id, user_id, tool_name, pattern, rule_type)` — 添加规则

**匹配优先级**：deny > allow（先检查拒绝规则，再检查允许规则）

> **详细实现见附录「十、Rust 实现参考」章节**

### 4.7 状态管理

跟踪权限请求的处理状态。

| 结构 | 说明 |
|------|------|
| `PermissionRequestState` | 权限请求状态，含 session_id、tool_call_id、user_id、project_id、tool_call、options、save_rule、created_at、status |
| `PermissionRequestStatus` | 状态枚举：Pending（等待审批）、Resolved（已审批）、Expired（已过期） |

> **详细实现见附录「十、Rust 实现参考」章节

---

## 五、错误处理

### 5.1 错误场景

| 场景 | 错误码 | 处理方式 |
|------|--------|----------|
| user_id 为空 | `ERR_VALIDATION` | 返回 400 |
| project_id 为空 | `ERR_VALIDATION` | 返回 400 |
| session_id 为空 | `ERR_VALIDATION` | 返回 400 |
| tool_call_id 为空 | `ERR_VALIDATION` | 返回 400 |
| 会话不存在 | `ERR_SESSION_NOT_FOUND` | 返回 404 |
| tool_call_id 不匹配 | `ERR_PERMISSION_NOT_FOUND` | 返回 404 |
| 容器通信失败 | `ERR_CONTAINER_ERROR` | 返回 502 |
| 权限请求已过期 | `ERR_PERMISSION_EXPIRED` | 返回 410 |

### 5.2 超时处理

- 权限请求默认超时: 5 分钟
- 超时后自动拒绝，Agent 继续执行但该命令被标记为失败

---

## 六、向后兼容性

1. **agent_mode 默认为 `yolo`**: 未传参时保持原有行为
2. **SSE 事件类型扩展**: 仅在 `agent_mode=ask` 时发送 `AcpRequestPermission`
3. **save_rule 默认为 false**: 前端不传时不保存规则
4. **现有接口无破坏性变更**: 所有修改都是新增可选字段

---

## 七、文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `crates/shared_types/src/chat_agent_config.rs` | `ChatAgentServerConfig` 新增 `agent_mode` 字段 |
| `crates/shared_types/src/computer_agent_types.rs` | 新增 `SavedRuleType`、`SaveRuleSuggestion` 结构体；`AcpRequestPermission` 新增 `save_rule` 字段 |
| `crates/shared_types/src/model/agent_session_notify.rs` | `SessionMessageType` 新增 `AcpRequestPermission` 变体 |
| `crates/shared_types/src/pattern_extraction.rs` | 🆕 新增 pattern 提取逻辑（参考 zed） |
| `crates/rcoder/src/handler/computer_chat_handler.rs` | SSE 事件处理逻辑 |
| `crates/rcoder/src/router.rs` | 新增 `/computer/notify-resolved` 路由 |
| `crates/rcoder/src/handler/` | 新增 `permission_handler.rs` 处理审批回执和规则存储 |
| `crates/rcoder/src/rule_store.rs` | 🆕 新增规则存储（内存 HashMap） |

---

## 八、API 总结

### 8.1 修改的接口

| 接口 | 方法 | 修改内容 |
|------|------|----------|
| `/computer/chat` | POST | `agent_config.agent_server.agent_mode` 新增可选字段 |

### 8.2 新增的接口

| 接口 | 方法 | 功能 |
|------|------|------|
| `/computer/notify-resolved` | POST | 权限审批结果回执（含规则存储） |
| `/computer/progress/{session_id}` | GET | SSE 流新增 `AcpRequestPermission` 事件类型 |

---

## 九、方案说明

### 9.1 规则存储方案选择

**采用方案 B: RCoder 返回规则，前端选择**

- **SSE 消息中包含 `save_rule` 字段**: 由 RCoder 提取并建议 pattern
- **前端只需返回布尔值**: 告诉 RCoder 是否保存规则
- **规则存储由 RCoder 处理**: 保持规则逻辑在服务端，前端无需理解规则格式
- **Pattern 生成参考 Zed**: 使用类似的 shell 命令解析逻辑

### 9.2 Pattern 生成参考

Pattern 生成逻辑参考 Zed 的 `pattern_extraction.rs`：

- **Terminal 命令**: 使用 shell parser 提取命令名和子命令，生成 `^cmd\\s+subcmd(\\s|$)` 格式
- **文件路径**: 提取父目录，生成 `^parent/` 格式
- **URL**: 提取域名，生成 `^https?://domain` 格式
- **安全限制**: 拒绝 `./script.sh`、`/usr/bin/python` 等路径前缀

### 9.3 新增的可选字段

| 位置 | 字段 | 说明 |
|------|------|------|
| SSE `data.save_rule` | `SaveRuleSuggestion` | 🆕 规则建议，由 RCoder 生成 |
| `/computer/notify-resolved` | `save_rule: bool` | 🆕 前端告诉 RCoder 是否保存规则 |
| `/computer/notify-resolved` | `pod_id` 等 | Pod ID 用于共享容器模式 |

---

## 十、Rust 实现参考

> 本章节包含 Rust 语言的具体实现代码。TS/JS 实现可参考接口设计，对应实现逻辑。

### 10.1 核心数据结构

**SSE 消息结构与 `UnifiedSessionMessage` 一致**：

```rust
// SSE 消息统一使用 UnifiedSessionMessage，data 字段为 serde_json::Value
pub struct UnifiedSessionMessage {
    pub session_id: String,
    pub message_type: SessionMessageType,  // AcpRequestPermission
    pub sub_type: String,                  // "request_permission"
    pub data: serde_json::Value,            // 包含 request_permission_request + RCoder 扩展字段
    pub timestamp: DateTime<Utc>,
}

/// RCoder 扩展字段（放在 data 中，与 request_permission_request 平级）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestExtensions {
    pub tool_call_id: String,  // 工具调用 ID（从 tool_call.id 提取）
    pub save_rule: Option<SaveRuleSuggestion>,
}

/// 🆕 规则建议（由 RCoder 生成）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveRuleSuggestion {
    /// 建议的 pattern（由 RCoder 从命令中提取）
    pub suggested_pattern: String,
    /// 规则类型
    pub rule_type: SavedRuleType,
    /// 工具名称
    pub tool_name: String,
}

/// 用户保存的规则类型（对应"始终允许/始终拒绝"选项）
/// - SavedRuleType::Allow 存储后，匹配时 respond(AllowAlways)
/// - SavedRuleType::Deny 存储后，匹配时 respond(RejectAlways)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SavedRuleType {
    Allow,  // 始终允许规则
    Deny,   // 始终拒绝规则
}
```

**JSON 示例**：

```json
{
  "session_id": "session_789",
  "message_type": "acpRequestPermission",
  "sub_type": "request_permission",
  "data": {
    "request_permission_request": { /* ACP RequestPermissionRequest */ },
    "tool_call_id": "tool_001",
    "save_rule": { "suggested_pattern": "^cargo\\s+build", "rule_type": "allow", "tool_name": "terminal" }
  },
  "timestamp": "2026-05-14T10:30:00Z"
}
```

### 10.2 Pending 请求存储

```rust
use std::collections::HashMap;
use tokio::sync::oneshot;

/// Pending 权限请求（等待用户审批）
pub struct PendingPermissionRequest {
    pub tool_call_id: String,     // 工具调用 ID
    pub tool_call: ToolCallUpdate, // 工具调用信息（来自 ACP 的 RequestPermissionRequest）
    pub options: Vec<PermissionOption>>, // 可供选择的选项（直接来自 ACP）
    pub save_rule: Option<SaveRuleSuggestion>, // 规则建议
    pub responder: Responder<RequestPermissionResponse>, // ACP responder
    pub created_at: std::time::Instant,      // 创建时间（用于超时检测）
}

/// Pending 请求存储: key = (session_id, tool_call_id)
pub struct PermissionStore {
    pending: HashMap<(String, String), PendingPermissionRequest>,
}

impl PermissionStore {
    /// 插入 pending 请求
    pub fn insert(&self, session_id: &str, tool_call_id: &str, request: PendingPermissionRequest) {
        self.pending.insert((session_id.to_string(), tool_call_id.to_string()), request);
    }

    /// 移除并返回 pending 请求
    pub fn remove(&self, session_id: &str, tool_call_id: &str) -> Option<PendingPermissionRequest> {
        self.pending.remove(&(session_id.to_string(), tool_call_id.to_string()))
    }

    /// 根据 session_id 移除所有 pending 请求（用于会话清理）
    pub fn remove_by_session(&self, session_id: &str) {
        self.pending.retain(|(_, _), _| false); // TODO: 实现真正的过滤
    }
}
```

### 10.3 规则存储

```rust
use std::collections::HashMap;

pub struct RuleStore {
    /// 规则存储: key = (project_id, user_id, tool_name)
    rules: HashMap<(String, String, String), Vec<PatternRule>>,
}

pub struct PatternRule {
    pub pattern: String,           // regex pattern
    pub rule_type: SavedRuleType,  // allow / deny
    pub created_at: DateTime<Utc>,
}

impl RuleStore {
    /// 检查命令是否匹配规则
    /// 优先级：deny > allow（先检查拒绝规则，再检查允许规则）
    pub fn match_rule(&self, project_id: &str, user_id: &str, tool_name: &str, command: &str) -> Option<SavedRuleType> {
        let rules = self.rules.get(&(project_id.to_string(), user_id.to_string(), tool_name.to_string()))?;

        // 先检查 deny 规则（优先级更高）
        for rule in rules.iter() {
            if rule.rule_type == SavedRuleType::Deny {
                if regex::Regex::new(&rule.pattern)
                    .map(|re| re.is_match(command))
                    .unwrap_or(false)
                {
                    return Some(SavedRuleType::Deny);
                }
            }
        }

        // 再检查 allow 规则
        for rule in rules.iter() {
            if rule.rule_type == SavedRuleType::Allow {
                if regex::Regex::new(&rule.pattern)
                    .map(|re| re.is_match(command))
                    .unwrap_or(false)
                {
                    return Some(SavedRuleType::Allow);
                }
            }
        }

        None
    }

    /// 添加规则
    pub fn add_rule(&self, project_id: String, user_id: String, tool_name: String, pattern: String, rule_type: SavedRuleType) {
        let key = (project_id, user_id, tool_name);
        let rule = PatternRule { pattern, rule_type, created_at: Utc::now() };
        self.rules.entry(key).or_insert_with(Vec::new).push(rule);
    }
}
```

### 10.4 状态管理

```rust
/// 权限请求状态
pub struct PermissionRequestState {
    pub session_id: String,
    pub tool_call_id: String,  // 🆕 用于关联具体工具调用
    pub user_id: String,
    pub project_id: String,
    pub tool_call: ToolCallUpdate,
    pub options: Vec<PermissionOption>>,  // 权限选项列表（直接来自 ACP）
    pub save_rule: Option<SaveRuleSuggestion>,  // 🆕 规则建议
    pub created_at: DateTime<Utc>,
    pub status: PermissionRequestStatus,
}

/// 权限请求状态枚举
pub enum PermissionRequestStatus {
    Pending,    // 等待用户审批
    Resolved,   // 用户已审批
    Expired,    // 超时未处理
}
```

### 10.5 硬编码安全规则

```rust
// 简化版示意（实际实现更复杂，参考 Zed）
const FLAGS: &str = r"(--[a-zA-Z0-9][-a-zA-Z0-9_]*(=[^\s]*)?\s+|-[a-zA-Z]+\s+)*";
const TRAILING_FLAGS: &str = r"(\s+--[a-zA-Z0-9][-a-zA-Z0-9_]*(=[^\s]*)?|\s+-[a-zA-Z]+)*\s*";

// 根目录: "rm -rf /", "rm -rfv /", "rm -rf /*", "rm / -rf"
r"\brm\s+{FLAGS}(--\s+)?/\*?{TRAILING_FLAGS}$"

// Home 目录: "rm -rf ~", "rm -rf ~/", "rm -rf ~/*"
r"\brm\s+{FLAGS}(--\s+)?~/?\*?{TRAILING_FLAGS}$"

// $HOME: "rm -rf $HOME", "rm -rf ${HOME}", "rm -rf $HOME/*"
r"\brm\s+{FLAGS}(--\s+)?(\$HOME|\$\{{HOME\}})/?(\*)?{TRAILING_FLAGS}$"

// 当前目录: "rm -rf .", "rm -rf ./", "rm -rf ./*"
r"\brm\s+{FLAGS}(--\s+)?\./?\*?{TRAILING_FLAGS}$"

// 父目录: "rm -rf ..", "rm -rf ../", "rm -rf ../*"
r"\brm\s+{FLAGS}(--\s+)?\.\./?\*?{TRAILING_FLAGS}$"
```
