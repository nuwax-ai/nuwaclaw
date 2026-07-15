# 跨 Agent 会话上下文同步方案

> 本文完善 `nuwa-cli` 当前 `chat --ref-session` 的设计边界。参考对象：
> - AionUi Team Mode：共享工作区 + 独立 Agent 会话 + mailbox/task board 传递结果。
> - tutti Agent reference：稳定 mention/handle + skill/CLI 按需解析，而不是把引用内容提前展开进 prompt。
> - tutti Agent Activity：保留 owner/thread 身份，事件流用单调 cursor 做增量同步。

## ACP 前提

`nuwa-cli` 的核心协议是 ACP。所有真实 Agent 会话生命周期都必须继续由 ACP 承载：

- 启动会话：`session/new`
- 同引擎续接：`session/load`
- 发送用户输入：`session/prompt`
- 权限请求：`session/request_permission`
- 会话关闭/取消：ACP 原生命令或 ACP 连接生命周期
- Agent 输出：ACP session update / notification

本文讨论的“跨 Agent 上下文同步”不是替代 ACP 的新会话协议，而是 **ACP 之上的上下文引用层**：

- 不伪造另一个引擎的 ACP `session/load`。
- 不把外部 transcript 转写成某个引擎的私有落盘格式。
- 不让 `serve` 自己成为新的 Agent runtime。
- 只通过 ACP 会话中的首轮提示、工具调用能力、CLI/MCP 可访问面，让目标 Agent 按需读取外部上下文。

换句话说：ACP 负责“Agent 怎么运行”，`context/ref/handoff` 只负责“Agent 需要时去哪里读上下文”。

## 目标

让不同 Agent/引擎之间可以共享“足够继续工作的上下文”，但不假装它们能原生加载彼此的 transcript。

具体目标：

1. **同引擎 resume 仍走原生能力**：`claude` 历史只能由 claude 原生 resume，`codex` 历史只能由 codex 原生 resume。
2. **跨引擎 reference 走稳定引用**：新会话拿到一个短 handle，模型需要时再调用 `nuwa-cli` CLI 读取摘要/消息/产物。
3. **跨 Agent handoff 走交接包**：从源会话生成结构化 handoff，包括目标、决策、文件、未完成任务、风险，而不是完整 transcript dump。
4. **多 Agent 协作走共享状态**：长期同步不要靠互相复制聊天记录，而应落到 mailbox/task board/shared workspace 这类可查询状态。
5. **事件流保持身份**：如果未来 `serve` 暴露多 Agent 活动流，事件必须保留 source agent/session/turn 身份，不能平铺混成一个会话。

## 当前状态

`nuwa-cli chat --ref-session <engine>:<sessionId>` 已经采用了正确方向：

- 不做跨引擎 `session/load`。
- 首轮只注入一条提醒。
- 让模型按需运行 `nuwa-cli context digest/read --ref ... --json`。

首版已补齐：

- `nuwa-cli context list/read/digest/handoff` 命令组。
- `chat --handoff <engine>:<sessionId>`：通过新的 ACP 会话首轮注入结构化交接包。
- `--resume` / `--ref-session` / `--handoff` 三种语义互斥。

仍待完善：

- handle 仍以短写 `<engine>:<sessionId>` 为主，完整 URI / content hash 尚未持久化。
- `digest/handoff` 当前是规则型抽取，不调用模型 summarizer。
- 没有共享状态层，无法表达 AionUi Team Mode 那类 mailbox/task board。

## 核心设计

### 1. 三种语义分清

| 语义 | 命令形态 | 说明 |
|---|---|---|
| 原生续接 | `chat --resume <sessionId>` | 只支持同引擎，经 ACP `session/load` 真实加载原始会话。 |
| 只读引用 | `chat --ref-session <engine>:<sessionId>` | 目标 Agent 仍是新的 ACP 会话；引用另一段历史，按需读取。 |
| 交接启动 | `chat --handoff <contextRef>` | 目标 Agent 仍是新的 ACP 会话；首轮收到结构化交接包，适合换引擎继续做。 |

`--ref-session` 是“看资料”；`--handoff` 是“接手工作”；`--resume` 是“继续同一条原生线程”。三者不要合并。

### 2. 稳定 ContextRef

引入内部引用模型：

```ts
interface ContextRef {
  kind: "local-session";
  engine: "claude" | "codex";
  sessionId: string;
  cwd: string;
  updatedAt: string;
  transcriptPath?: string;
  contentHash?: string;
}
```

对用户仍可接受短写法：

```bash
nuwa-cli chat --ref-session claude:c6e84245...
```

内部解析后使用完整 `ContextRef`。未来可以序列化成 URI：

```text
nuwa-cli://context/local-session?engine=claude&sessionId=...&cwd=...
```

URI/handle 不携带完整消息内容，只携带可解析身份。这一点沿用 tutti 的 `workspace-reference` 设计：发 handle，不提前展开。

### 3. 新增 `context` 命令组

保留 `sessions summary` 兼容当前能力，但新能力放到 `context` 下：

```bash
nuwa-cli context list [--engine claude|codex]
nuwa-cli context read --ref claude:<sessionId> [--limit N] --json
nuwa-cli context digest --ref claude:<sessionId> --json
nuwa-cli context handoff --ref claude:<sessionId> --json
```

建议输出分层：

- `read`：规范化消息流，接近当前 `sessions summary`。
- `digest`：压缩摘要，包含最近目标、关键事实、文件路径、工具调用概要。
- `handoff`：面向接手 Agent 的结构化交接包。

`handoff` 输出建议：

```json
{
  "source": { "engine": "claude", "sessionId": "...", "cwd": "..." },
  "goal": "用户当前想完成什么",
  "decisions": ["已经确定的技术/产品决策"],
  "openTasks": ["还没做完的事项"],
  "changedFiles": ["相对或绝对路径"],
  "risks": ["需要接手 Agent 注意的坑"],
  "recentMessages": [{ "role": "user", "text": "..." }],
  "hasMore": true
}
```

首版 `digest/handoff` 可以先用规则抽取，不调用模型：最近 N 条消息 + 工具调用 + 文件路径 + 明确 TODO/decision 关键字。后续再接入可选的 summarizer。

### 4. Agent 侧路由提醒

`--ref-session` 不应该把 `read/digest/handoff` 的结果直接塞进 prompt。应继续注入短提醒：

```text
<system-reminder>
引用会话 claude:<id> 位于 cwd=<cwd>。
需要上下文时，先运行：
nuwa-cli context digest --ref claude:<id> --json
若仍不够，再运行：
nuwa-cli context read --ref claude:<id> --limit 40 --json
不要假设未读取的内容。
</system-reminder>
```

这和 tutti 的 reference skill 一致：先给模型一条可解析路径，让它在 ACP 会话内通过自身可用工具按需拉取。

### 5. 共享状态层：不要用 transcript 当协作数据库

借鉴 AionUi Team Mode，真正的跨 Agent 协作应拆成三类共享对象：

```text
~/.nuwa-cli/context/
  mailbox.jsonl       # agent 间消息/结果投递
  tasks.jsonl         # 共享任务板
  artifacts.jsonl     # 文件/产物引用索引
```

首版可以只做 CLI：

```bash
nuwa-cli context mailbox send --to codex:<sessionId> --from claude:<sessionId> --text ...
nuwa-cli context mailbox list --for codex:<sessionId> --json
nuwa-cli context task add --title ... --owner codex:<sessionId>
nuwa-cli context task list --json
```

但不建议马上把它塞进 `chat` 主链路。先把只读 reference/handoff 做稳，再加 mailbox/task board。

### 6. `serve` 事件流扩展

如果 `serve` 将来承载多 Agent 会话，它仍应只是 ACP 会话的 HTTP/SSE 外壳，而不是另一个 runtime。事件投影应学习 tutti 的 OwnerThreadID 思路：

```ts
interface UnifiedSessionMessage {
  sessionId: string;          // nuwa-cli serve 的父会话/HTTP session
  sourceEngine: "claude" | "codex";
  sourceSessionId?: string;   // 原生引擎会话 id
  ownerSessionId?: string;    // 子 Agent/被引用 Agent/协作者身份
  sequence: number;           // 每个 serve session 内单调递增
  timestamp: string;
  ...
}
```

要求：

- `sequence` 用内存单调计数，不用 timestamp 当 cursor。
- 子 Agent 或引用来源事件不混入父会话文本，保留 `ownerSessionId`。
- SSE 客户端可以按 `sequence` 增量恢复。

## 实施顺序

1. **已完成：ContextRef 解析层**：把 `resolveRefSessionReminder` 从字符串解析升级为完整 `ContextRef`。
2. **已完成：`context read`**：复用现有 `parseTranscript`，输出与 `sessions summary` 兼容的 JSON。
3. **已完成：`context digest` / `context handoff`**：先做规则型摘要，测试覆盖 claude/codex transcript。
4. **已完成：`chat --handoff`**：通过 ACP `session/new` 创建新会话，首轮注入 handoff 包；与 `--resume` 互斥。
5. **统一文档和 README**：把 `sessions summary` 标为低层命令，把 `context` 标为 Agent 可调用接口。
6. **可选共享状态层**：mailbox/task/artifacts，服务 Team-like 协作。
7. **serve 事件 cursor**：多 Agent 活动流需要时再加 `sequence`/`ownerSessionId`。

## 非目标

- 不做跨引擎原生 resume。
- 不绕过 ACP 管理会话生命周期。
- 不把完整 transcript 自动塞进 prompt。
- 不把 cloud session sync 混进本地 reference 首版。
- 不要求 claude/codex 两边 transcript 格式一致；统一只发生在 `context` 输出层。

## 结论

`nuwa-cli` 应把“跨 Agent 同步上下文”定义为：

> 通过稳定引用和可查询共享状态，让目标 Agent 按需读取源 Agent 的历史、交接包和产物；只有同引擎才使用原生 resume。

这比“复制整段会话”更稳，也给后续 Team Mode、远程/云端会话、`serve` 多 Agent 活动流留出了清晰边界。
