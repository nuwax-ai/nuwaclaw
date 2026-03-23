# GUI Agent MCP Server — Plan 计划文档

> **文档类型**: Plan（计划文档）— 描述"如何实现"，定义技术方案与架构设计
>
> **基于**: `specs/gui-agent/gui-agent.md` Spec 规范文档
>
> **模块路径**: `crates/agent-gui-server/`
>
> **日期**: 2026-03-18

---

## 1. 技术架构

### 1.1 模块划分

```
crates/agent-gui-server/
├── src/
│   ├── index.ts                  # CLI 入口: 参数解析 + 启动 MCP Server
│   ├── lib.ts                    # SDK 入口: 导出 createGuiAgentMcpServer()
│   ├── config.ts                 # 统一配置: 环境变量解析、校验、Fail Fast
│   │
│   ├── mcp/                      # MCP 协议层（外部接口）
│   │   ├── server.ts             # MCP Server 实例 (stdio + HTTP 双模式)
│   │   ├── atomicTools.ts        # 13 个原子操作 tool handler
│   │   ├── taskTools.ts          # gui_execute_task 互斥执行 + 进度通知
│   │   └── resources.ts          # MCP Resources (status/permissions/audit)
│   │
│   ├── agent/                    # Agent 循环引擎（gui_execute_task 内部）
│   │   ├── taskRunner.ts         # 循环核心: pi-mono session + 截图→LLM→操作
│   │   ├── systemPrompt.ts       # GUI Agent system prompt 模板
│   │   ├── memoryManager.ts      # 三层记忆管理 (Summary/Recent/Pending) + LLM 摘要压缩
│   │   └── stuckDetector.ts      # 卡死检测: 连续截图相似度比对
│   │
│   ├── desktop/                  # 桌面操作层（底层能力封装）
│   │   ├── screenshot.ts         # 截图管线: capture → scale → JPEG → base64
│   │   ├── mouse.ts              # 鼠标: click/doubleClick/move/drag/scroll
│   │   ├── keyboard.ts           # 键盘: type/pressKey/hotkey
│   │   ├── clipboard.ts          # 剪贴板: CJK粘贴、备份恢复
│   │   ├── display.ts            # 显示器: 列表、scaleFactor、全局偏移
│   │   └── imageSearch.ts        # 图像查找 (nut.js template matcher)
│   │
│   ├── coordinates/              # 坐标系统（核心难点，独立目录）
│   │   ├── resolver.ts           # CoordinateResolver: 模型坐标 → 逻辑坐标 → 全局坐标
│   │   └── modelProfiles.ts      # 模型配置表: 坐标模式、坐标顺序
│   │
│   ├── safety/                   # 安全层
│   │   ├── hotkeys.ts            # 危险热键黑名单拦截
│   │   └── auditLog.ts           # 环形缓冲审计日志
│   │
│   └── utils/
│       ├── logger.ts             # 日志: stderr + 可选文件
│       ├── platform.ts           # 平台检测、权限检查
│       └── errors.ts             # 结构化错误类型
│
├── tests/                        # Vitest 测试
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**关键设计决策**：

- **`desktop/` vs `tools/`**: Spec 用了 `tools/` 但会与 MCP 的 "tool" 概念冲突。底层桌面操作命名为 `desktop/`，与 MCP 工具层 (`mcp/`) 明确分离。MCP handler 调 desktop 层，desktop 层不知道 MCP 存在（依赖反转）
- **`coordinates/` 独立目录**: 坐标转换是核心难点（7+ 模型配置 + 三步转换 + 多屏偏移），独立提升可维护性和可测试性

### 1.2 模块依赖关系

```
index.ts → config.ts → mcp/server.ts
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        mcp/atomicTools.ts      mcp/taskTools.ts
              │                       │
              ▼                       ▼
        safety/* (前置检查)      agent/taskRunner.ts
              │                       │
              ▼                       ├── agent/systemPrompt.ts
        desktop/*                     ├── agent/memoryManager.ts (三层记忆 + LLM 摘要)
              │                       ├── agent/stuckDetector.ts
              ▼                       └── pi-mono (LLM + tool calling)
        coordinates/resolver.ts              │
              │                              ▼
              ▼                        desktop/* (复用)
        coordinates/modelProfiles.ts
```

**数据流 — 原子操作** (`gui_click`):
```
MCP tool call → atomicTools → hotkeys.validate()
  → resolver.resolve(x, y, mode, meta) → display.getGlobalOffset()
  → mouse.click(globalX, globalY) → auditLog.record() → MCP response
```

**数据流 — 完整任务** (`gui_execute_task`):
```
MCP tool call → taskTools.executeTask(taskText, extra)
  → mutex.acquire()（确保同时只有一个 GUI 任务）
  → taskRunner.run(taskText, extra.signal) → Agent 循环 {
      screenshot.capture() → agent.prompt(taskText + screenshot)
      → Agent 内部自动循环:
        transformContext(messages) → 截图裁剪 + 记忆注入
        → convertToLlm(messages)
        → LLM 调用 → 返回 tool call
        → beforeToolCall → hotkeys.validate() 安全检查
        → tool.execute() → resolver + desktop 操作 → delay(stepDelayMs)
        → afterToolCall → auditLog.record()
        → turn_end 事件 → memory.finalizeStep() + stuckDetector.check()
      每步通过 extra.sendNotification() 推送进度
      监听 extra.signal.aborted 处理取消 → agent.abort()
    } → mutex.release() → MCP response (steps + finalScreenshot + result)

连接断开 → AbortSignal 自动触发 → Agent 循环终止 → mutex 释放
```

---

## 2. 关键技术决策

### 2.1 pi-mono 的使用边界

| 场景 | 使用哪个包 | 具体 API |
|------|:---:|------|
| 原子操作 (gui_click 等) | 不使用 pi-mono | 纯工具执行，无需 LLM |
| gui_execute_task 的 Agent 循环 | `@mariozechner/pi-agent-core` | `Agent` 类：内置循环、工具执行、事件流、abort |
| gui_execute_task 的 LLM 调用 | `@mariozechner/pi-ai` | `getModel(provider, modelId)` 获取模型实例，Agent 内部自动调用 |
| gui_execute_task 的工具注册 | `@mariozechner/pi-agent-core` | `AgentTool` 接口 + TypeBox schema + `execute` 函数 |
| 上下文压缩 | `@mariozechner/pi-agent-core` | Agent 构造参数 `transformContext` hook |
| 安全层（热键拦截 + 审计） | `@mariozechner/pi-agent-core` | Agent 构造参数 `beforeToolCall` / `afterToolCall` hook |
| 记忆摘要的 LLM 调用 | `@mariozechner/pi-ai` | 独立 `complete(memoryModel, context)` 调用（不走 Agent 循环） |
| 进度通知 | `@mariozechner/pi-agent-core` | `agent.subscribe(event)` 事件系统 |

**关键认识**：pi-mono 的 `Agent` 类已经内置了完整的 Agent 循环（LLM 调用 → 解析 tool call → 执行工具 → 再次调 LLM），**我们不需要手写循环**。taskRunner 的职责是配置 Agent 实例、注册工具、接入钩子。

MCP Server 和 pi-mono Agent 是**两个独立的框架**，各司其职：
- MCP Server 负责外部协议（文本 Agent 调用）
- pi-mono Agent 负责内部 Agent 循环（LLM + tool calling）

### 2.2 nut.js 而非 robotjs

robotjs 已停止维护（2018），不支持 Apple Silicon 和 Node 22。nut.js 活跃维护，跨平台，async API，逻辑坐标空间与我们的坐标转换链路契合。

### 2.3 gui_execute_task 同步执行 + 互斥锁

**同步阻塞**：
- `gui_execute_task` 是标准的 MCP tool call，handler 内部 await Agent 循环完成后返回结果
- MCP SDK 的 tool handler 支持长时间 `Promise<Result>` 返回，无需异步队列

**互斥锁**：
- 桌面同一时间只能有一个 GUI 操作者，通过 `Mutex` 确保同时只有一个 `gui_execute_task` 在执行
- 第二个调用会等待锁释放后再执行（不拒绝，排队等待）

**进度通知**（MCP SDK 原生）：
- 客户端在 `_meta.progressToken` 中传入 token
- handler 通过 `extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total, message } })` 推送每步进度

**取消**（MCP SDK 原生）：
- handler 中 `extra.signal`（AbortSignal）由 SDK 自动注入
- 客户端取消请求或连接断开时，signal 自动触发
- handler 监听 signal → 调用 pi-mono `agent.abort()` 终止循环
- 无需手动管理 session 或自定义 abort 工具

### 2.4 截图管线: nut.js + sharp

- nut.js `screen.capture(region)` 获取原始 RGBA Buffer（物理分辨率）
- sharp 做 resize（`kernel: 'lanczos3'`）+ JPEG 编码（`quality: 75`）
- sharp 已在 monorepo 中验证可用

### 2.5 SDK 嵌入模式

`lib.ts` 导出 `createGuiAgentMcpServer(config)` 工厂函数，供 Electron 客户端未来直接 import 集成。package.json 中 `"main": "./dist/lib.js"` 导出 SDK，`"bin"` 导出 CLI。

---

## 3. 各模块详细设计

### 3.1 config.ts — 统一配置

- 解析所有 `GUI_AGENT_*` 环境变量，返回类型安全的 `GuiAgentConfig` 对象
- 必填字段（如 `API_KEY`）缺失时直接 throw，进程退出（Fail Fast）
- 数值参数做范围校验（jpegQuality 1-100，maxSteps 1-200）
- `coordinateMode` 为空时表示自动匹配（由 modelProfiles 决定）

### 3.2 coordinates/modelProfiles.ts — 模型配置表

**内置模型配置表**：

| 模型名匹配规则 | 坐标模式 | 坐标顺序 | 说明 |
|---------------|---------|---------|------|
| `claude-*` | `image-absolute` | `xy` | Anthropic Computer Use API 标准格式 |
| `gpt-4o*`, `gpt-5*` | `image-absolute` | `xy` | OpenAI CUA |
| `gemini*` | `normalized-999` | **`yx`** | Google Gemini，坐标顺序是 `[y, x]` 而非 `[x, y]`，这是 Google 训练数据的固有格式 |
| `ui-tars*` | `normalized-1000` | `xy` | UI-TARS |
| `qwen2.5-vl*`, `qwen-vl*` | `image-absolute` | `xy` | 通义千问 VL |
| `cogagent*` | `image-absolute` | `xy` | CogAgent |
| `seeclick*`, `showui*` | `normalized-0-1` | `xy` | SeeClick/ShowUI |
| **未匹配（fallback）** | `image-absolute` | `xy` | 保守策略 |

**截图分辨率策略（统一，不按模型区分）**：

不同模型的坐标转换都会经过归一化步骤（`modelX / imageWidth` 或 `modelX / 1000` 等），数学上与截图发送的分辨率无关。因此**不需要按模型匹配不同截图分辨率**，也**不做 28/32 等倍数对齐**（云端 API 服务端内部会处理 padding，本地部署场景暂不考虑）。

采用统一的分级缩放策略（参考 TuriX-CUA）：

1. 物理截图必须缩放到**逻辑分辨率**（吸收 scaleFactor），否则坐标会偏移 scaleFactor 倍
2. 逻辑分辨率仍然过大时，按最长边分级等比缩放：

| 逻辑分辨率最长边 | 缩放策略 | 示例 |
|----------------|---------|------|
| ≤ 1920 | 不缩放 | 1440×900 → 1440×900 |
| 1921 ~ 2560 | 等比缩放到最长边 1920 | 2560×1440 → 1920×1080 |
| > 2560 | 等比缩放到最长边 1920 | 3840×2160 → 1920×1080 |

3. 转 JPEG quality=75 进一步压缩

**Gemini 坐标顺序特殊处理**：

Gemini 模型输出坐标格式为 `[y_min, x_min, y_max, x_max]`（点坐标为 `[y, x]`），与其他所有模型的 `[x, y]` 相反。这是 Google 训练数据的固有格式，**切换为 `[x, y]` 会导致性能显著下降**。CoordinateResolver 必须在归一化前根据 `coordinateOrder` 做 swap。

**实现逻辑**：
- `getModelProfile(modelName)` → `ModelProfile { coordinateMode, coordinateOrder }`
- `coordinateOrder` 默认 `xy`，Gemini 为 `yx`
- 环境变量 `GUI_AGENT_COORDINATE_MODE` 可覆盖坐标模式
- 未匹配 fallback: `image-absolute` + `xy`
- 扩展新模型只需在数组中加一条正则规则

### 3.3 coordinates/resolver.ts — CoordinateResolver

**核心四步转换**（纯函数，零 I/O，高可测试性）：

1. **坐标顺序修正**: 根据 `coordinateOrder` 处理
   - `xy`（默认）: 不变，`rawX = modelX, rawY = modelY`
   - `yx`（Gemini）: swap，`rawX = modelY, rawY = modelX`
2. **归一化** (0~1): 根据 coordinateMode 处理
   - image-absolute: `normX = rawX / imageWidth`
   - normalized-1000: `normX = rawX / 1000`
   - normalized-999: `normX = rawX / 999`
   - normalized-0-1: `normX = rawX`（直接用）
3. **逻辑坐标**: `localX = normX × logicalWidth`
4. **全局偏移**: `globalX = localX + display.origin.x`

边界校验：结果 clamp 到目标显示器范围内，超出记 warning。

### 3.4 desktop/screenshot.ts — 截图管线

1. 获取目标显示器信息（bounds、scaleFactor）
2. nut.js `screen.capture(region)` 截取目标显示器区域（物理分辨率）
3. 缩放到逻辑分辨率（吸收 scaleFactor）；若逻辑分辨率最长边 > 1920，等比缩放到最长边 1920
4. sharp resize（`kernel: 'lanczos3'`）+ JPEG encode（`quality: 75`）
5. 检查字节数是否超限，超限则降 quality 重试
6. 返回 `ScreenshotResult`（base64 + 完整元数据）

### 3.5 desktop/keyboard.ts + clipboard.ts — 文本输入

**typeText 智能路由**:
- 包含非 ASCII (`/[^\x00-\x7F]/`) 或长度 > 50 → clipboard.pasteText()
- 否则 → nut.js keyboard.type()

**clipboard.pasteText 流程**:
1. 读取当前剪贴板（通过 `clipboardy` 库，跨平台）
2. 写入目标文本
3. 模拟 Cmd+V (macOS) / Ctrl+V (Win/Linux)
4. 等待 100ms
5. 恢复原剪贴板（try-catch 包裹，失败不阻断主流程）

### 3.6 agent/taskRunner.ts — Agent 循环引擎

**核心认识**：pi-mono 的 `Agent` 类已经内置完整的 Agent 循环（LLM 调用 → 解析 tool call → 执行工具 → 再次调 LLM）。taskRunner **不需要手写循环**，职责是：配置 Agent 实例、注册工具、接入钩子、管理生命周期。

> TuriX-CUA 使用独立的 Brain + Actor 两个角色。我们 v1 简化为单角色：一个 LLM 同时分析截图 + 输出操作，但**记忆管理参考 TuriX-CUA 的三层架构**。

**Agent 实例创建**：

```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { getModel, complete } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';

// getModel() 是强类型泛型 API，动态配置需使用 as any 绕过编译期检查
// pi-mono 内部会校验 provider+model 组合是否有效，无效时 throw
const model = getModel(config.provider as any, config.model as any);
const memoryModel = getModel(
  (config.memoryProvider ?? config.provider) as any,
  (config.memoryModel ?? config.model) as any,
);
const memoryManager = new MemoryManager(memoryModel);

const agent = new Agent({
  initialState: {
    systemPrompt: buildSystemPrompt(taskText, memoryManager.compose()),
    model,
    thinkingLevel: 'off',
    tools: guiTools,            // AgentTool[] — 见下方工具定义
    messages: [],
  },

  // 工具串行执行（GUI 操作同一屏幕不能并行）
  toolExecution: 'sequential',

  // 上下文转换：截图丢弃（注意：记忆文本通过 systemPrompt 注入，不在这里）
  transformContext: async (messages, signal) => {
    return memoryManager.pruneScreenshots(messages);
  },

  // 消息格式转换：AgentMessage[] → LLM Message[]
  convertToLlm: (messages) =>
    messages.filter(m => ['user', 'assistant', 'toolResult'].includes(m.role)),

  // 安全层：工具执行前拦截危险热键
  beforeToolCall: async ({ toolCall, args }) => {
    if (toolCall.name === 'computer_hotkey') {
      const blocked = hotkeys.validate(args.keys);
      if (blocked) return { block: true, reason: `Blocked dangerous hotkey: ${args.keys}` };
    }
  },

  // 审计层：工具执行后记录日志
  // 注意：isError 是独立字段，不是 result.isError
  afterToolCall: async ({ toolCall, args, result, isError }) => {
    auditLog.record({ tool: toolCall.name, args, success: !isError });
  },
});
```

**运行任务**：

```typescript
async function runTask(taskText: string, signal: AbortSignal): Promise<TaskResult> {
  // 1. 截取初始截图
  const screenshot = await desktop.screenshot.capture(displayIndex);

  // 2. 订阅事件 → 推送 MCP 进度通知 + 记忆管理
  //    注意：subscribe 回调是同步的，异步操作不能在回调中 await
  agent.subscribe((event) => {
    switch (event.type) {
      case 'turn_end':
        stepCount++;
        // finalizeStep 是异步的（可能触发 LLM 摘要），放入 Promise 队列
        pendingMemoryWork = memoryManager.finalizeStep(stepCount, evaluateStep(event))
          .then(() => {
            // 记忆更新后，刷新 systemPrompt（包含最新的 compose() 文本）
            agent.state.systemPrompt = buildSystemPrompt(taskText, memoryManager.compose());
          });
        stuckDetector.check(latestScreenshot);
        onProgress({ step: stepCount, status: 'running' });
        // maxSteps 限制
        if (stepCount >= config.maxSteps) agent.abort();
        break;
    }
  });

  // 3. 发起 prompt — Agent 内部自动循环
  //    循环终止条件：LLM 返回纯文本（无 tool call）→ stopReason: "stop"
  //    或 agent.abort() → stopReason: "aborted"
  await agent.prompt(taskText, [
    { type: 'image', data: screenshot.image, mimeType: screenshot.mimeType }
  ]);

  // 4. 等待最后一次记忆压缩完成
  await pendingMemoryWork;

  // 5. 返回结果
  return buildTaskResult(agent.state.messages);
}

// 外部 abort → agent.abort()
function abort() { agent.abort(); }
```

**内部工具定义**（`AgentTool` 接口）：

```typescript
const guiTools: AgentTool[] = [
  {
    name: 'computer_screenshot',
    label: 'Screenshot',
    description: '截取当前屏幕',
    parameters: Type.Object({}),
    execute: async (toolCallId, params, signal) => {
      const shot = await desktop.screenshot.capture(displayIndex);
      latestScreenshot = shot;
      return {
        content: [{ type: 'image', data: shot.image, mimeType: shot.mimeType }],
        details: { imageWidth: shot.imageWidth, imageHeight: shot.imageHeight },
      };
    },
  },
  {
    name: 'computer_click',
    label: 'Click',
    description: '鼠标点击指定坐标',
    parameters: Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      button: Type.Optional(Type.String()),
    }),
    execute: async (toolCallId, params, signal) => {
      const { globalX, globalY } = resolver.resolve(params.x, params.y, profile, screenshotMeta);
      await desktop.mouse.click(globalX, globalY, params.button);
      // 操作后等待 UI 渲染（延迟放在工具内部，而非 subscribe 回调）
      await delay(config.stepDelayMs);
      return { content: [{ type: 'text', text: `Clicked (${globalX}, ${globalY})` }], details: {} };
    },
  },
  // computer_type, computer_scroll, computer_hotkey, computer_wait 同理...
  // 每个操作类工具的 execute 末尾都包含 await delay(config.stepDelayMs)
  {
    name: 'computer_done',
    label: 'Done',
    description: '任务完成，调用此工具表示任务已完成',
    parameters: Type.Object({
      result: Type.String({ description: '任务完成的结果描述' }),
    }),
    execute: async (toolCallId, params, signal) => {
      // computer_done 的 tool result 返回给 LLM 后，
      // LLM 应输出纯文本总结（无 tool call），Agent 循环自然终止（stopReason: "stop"）。
      // system prompt 中明确指导：调用 computer_done 后不要再调其他工具。
      return { content: [{ type: 'text', text: params.result }], details: { done: true } };
    },
  },
];
```

**Agent 循环终止机制**：

pi-mono Agent 的循环在以下条件终止：
1. **LLM 返回纯文本**（无 tool call）→ `stopReason: "stop"` — `computer_done` 走这条路：工具返回结果后，LLM 看到 "任务完成" 的 tool result，输出纯文本总结，循环自然结束
2. **`agent.abort()`** → `stopReason: "aborted"` — maxSteps 超限或外部 abort 走这条路
3. **context overflow** → `stopReason: "error"` — 可通过 `isContextOverflow()` 检测

**记忆文本注入方式**：

记忆文本（`compose()` 输出）通过 **systemPrompt 动态更新**注入，而非通过 `transformContext` 注入消息。原因：
- `transformContext` 操作的是 `AgentMessage[]`，注入合成消息会干扰 Agent 内部的消息追踪
- `agent.state.systemPrompt` 可直接赋值更新，在下一次 LLM 调用时生效
- 在 `turn_end` 事件回调中更新 systemPrompt，时机正确（当前轮结束、下一轮开始之前）

**pi-mono Agent 事件流（单轮示例）**：

```
agent.prompt(taskText + screenshot)
  ├─ agent_start
  ├─ turn_start
  │   ├─ message_start  { userMessage }
  │   ├─ message_end    { userMessage }
  │   ├─ message_start  { assistantMessage }
  │   ├─ message_update { toolcall_delta: "computer_click..." }
  │   ├─ message_end    { assistantMessage with toolCall }
  │   ├─ tool_execution_start  { computer_click, args }
  │   ├─ tool_execution_end    { result }
  │   ├─ message_start  { toolResultMessage }
  │   └─ message_end    { toolResultMessage }
  ├─ turn_end { message, toolResults }
  ├─ turn_start  ← 自动下一轮（因为有 tool call）
  │   └─ ... (LLM 看到 tool result → 继续决策)
  └─ agent_end { messages }
```

### 3.7 agent/memoryManager.ts — 三层记忆管理

**参考 TuriX-CUA 的三层记忆架构**，实现 LLM 驱动的上下文压缩。

#### 3.7.1 三层记忆结构

```
┌──────────────────────────────────────────────────────┐
│  summaryMemory（摘要记忆）                             │
│  预算: summaryBudget = 2000 字符                      │
│  内容: 更早步骤的高度压缩摘要                           │
│  超限时: 调 memory_model 做"摘要的摘要"                │
├──────────────────────────────────────────────────────┤
│  recentMemory（近期记忆）                              │
│  预算: recentBudget = 500 字符                        │
│  内容: 最近完成的步骤记录 + 评估结果                     │
│  超限时: 调 memory_model 总结 → 移入 summaryMemory     │
├──────────────────────────────────────────────────────┤
│  pendingMemory（进行中）                               │
│  不计入预算                                           │
│  内容: 当前正在执行的步骤                               │
│  完成后: 移入 recentMemory                            │
└──────────────────────────────────────────────────────┘
```

#### 3.7.2 核心 API

```typescript
class MemoryManager {
  // 三层记忆
  private summaryMemory: string = '';
  private recentMemory: string = '';
  private pendingMemory: string = '';

  // 预算配置
  private recentBudget: number = 500;          // 字符数
  private summaryBudget: number = 2000;        // 字符数 (4x recentBudget)
  private screenshotKeepCount: number = 3;     // 保留最近 N 步的完整截图

  // 记忆模型（用于 LLM 摘要，独立于主 Agent）
  private memoryModel: Model;

  /** 当前步骤开始 — 记录到 pendingMemory */
  addPendingStep(stepId: number, goal: string): void;

  /** 当前步骤完成 — 从 pending 移入 recent，触发压缩检查 */
  async finalizeStep(stepId: number, evaluation: 'success' | 'failed'): Promise<void>;

  /** 组合三层记忆为文本，用于注入 systemPrompt */
  compose(): string;

  /**
   * 接入 Agent 的 transformContext hook
   * 职责：仅处理截图 base64 裁剪（记忆文本通过 systemPrompt 注入，不在这里）
   * 1. 丢弃超过 screenshotKeepCount 步的截图 base64
   * 2. token 硬限制兜底（从最旧消息开始强制移除图片）
   */
  pruneScreenshots(messages: AgentMessage[]): AgentMessage[];
}
```

**与 pi-mono 的集成方式**：

- `pruneScreenshots` 作为 `transformContext` hook 传入 Agent，每次 LLM 调用前自动执行，只负责截图裁剪
- **记忆文本通过 `agent.state.systemPrompt` 注入**：在 `turn_end` 事件回调中调用 `buildSystemPrompt(taskText, memoryManager.compose())` 更新 systemPrompt，下一轮 LLM 调用时生效
- `finalizeStep` 在 `turn_end` 事件回调中调用（异步，可能触发 LLM 摘要）
- 记忆摘要使用独立的 `complete(memoryModel, context)` 调用，不走 Agent 循环
- pi-mono 的 `Usage` 对象提供了 provider 返回的实际 token 数（`usage.input`），可用于更准确的 token 预算判断（替代 `text.length / 3` 估算）

#### 3.7.3 压缩触发流程（参考 TuriX-CUA）

```
finalizeStep(stepId, evaluation)
  │
  │  将 pending 行移入 recentMemory:
  │  "Step {stepId} | Eval: {evaluation} | Goal: {goal}"
  │
  │  检查: recentMemory.length > recentBudget (500)?
  │  ├── 否 → 返回
  │  └── 是 ↓
  │
  │  调 memory_model 生成摘要:
  │    输入: recentMemory 全文
  │    输出: { summary: string }  ← 结构化 JSON
  │  │
  │  summaryMemory += summary
  │  recentMemory = ''  ← 清空
  │  │
  │  检查: summaryMemory.length > summaryBudget (2000)?
  │  ├── 否 → 返回
  │  └── 是 ↓
  │
  │  调 memory_model 做二次压缩:
  │    输入: summaryMemory 全文
  │    输出: { summary: string }  ← 更高层摘要
  │  │
  │  summaryMemory = summary  ← 替换
```

#### 3.7.4 compose() — 组合输出

```typescript
compose(): string {
  const parts: string[] = [];
  if (this.summaryMemory) {
    parts.push(`[Summarized history]\n${this.summaryMemory}`);
  }
  if (this.recentMemory) {
    parts.push(`[Recent steps]\n${this.recentMemory}`);
  }
  if (this.pendingMemory) {
    parts.push(`[Current step]\n${this.pendingMemory}`);
  }
  return parts.join('\n\n');
}
```

#### 3.7.5 截图 base64 的管理（pruneScreenshots，在 transformContext 中执行）

记忆压缩管理的是**文字上下文**（通过 systemPrompt 注入）。截图 base64 在 `pruneScreenshots` 中单独管理：

```
pruneScreenshots(messages: AgentMessage[])
  │
  │  1. 遍历消息，识别包含 ImageContent 的 toolResultMessage
  │  2. 按时间排序，保留最近 screenshotKeepCount (默认 3) 步的截图
  │  3. 更早步骤：移除 ImageContent，替换为文字描述
  │     { type: 'text', text: '[Screenshot removed - Step 5: browser opened]' }
  │  4. token 硬限制兜底：
  │     估算总 token（文字 text.length/3 + 图片 ~800/张）
  │     超过 model.contextWindow * 0.9 时，从最旧消息强制移除图片
  │
  返回裁剪后的 AgentMessage[]
```

pi-mono 的 `transformContext` 在 `convertToLlm` **之前**执行，操作的是 `AgentMessage[]`，裁剪结果只影响当次 LLM 调用的输入，不修改 Agent 内部存储的完整消息历史。

#### 3.7.6 memory_model 配置

```
GUI_AGENT_MEMORY_MODEL      — 记忆摘要用的模型（可选，默认复用 GUI_AGENT_MODEL）
GUI_AGENT_MEMORY_PROVIDER   — 记忆模型 Provider（可选，默认复用 GUI_AGENT_PROVIDER）
```

记忆摘要是纯文本输入/输出，不需要视觉能力，可以用更便宜的模型（如 haiku / gpt-4o-mini）降低成本。

#### 3.7.7 记忆摘要 system prompt

```
You are a memory summarization assistant for a GUI automation agent.
Your task is to condense step-by-step action records into concise memory entries.

Output JSON:
{
  "summary": "Concise summary of the actions taken and their outcomes..."
}

Guidelines:
- Preserve key information: what was done, what succeeded/failed, current state
- Remove redundant details and repetitive patterns
- Keep the summary actionable — the agent needs to know what happened to plan next steps
```

### 3.8 agent/stuckDetector.ts — 卡死检测

- 将截图缩放到 32×32 → 计算与前 N 步（默认 3）的像素均值差异
- 连续 N 步差异 < 阈值（5%）→ 判定卡死，自动终止
- 简化方案，不需要 SSIM 或感知哈希

### 3.9 safety — 安全层

| 模块 | 实现 | 接入方式 |
|------|------|---------|
| **hotkeys** | 组合键黑名单匹配，按平台区分（macOS: Cmd+Q, Win: Alt+F4 等） | 原子操作：atomicTools 中直接调用；Agent 循环：通过 `beforeToolCall` hook 拦截 |
| **auditLog** | 固定大小数组 (1000)，环形写入，通过 MCP Resource 暴露 | 原子操作：atomicTools 执行后记录；Agent 循环：通过 `afterToolCall` hook 记录 |

### 3.10 mcp/server.ts — MCP Server

**Streamable HTTP 模式（主模式）**：

参考 `nuwax-mcp-stdio-proxy` 的 `PersistentMcpBridge` 模式：

- `http.createServer()` 监听 `127.0.0.1:<port>`（默认 60008），长期运行
- 请求路由：`/mcp` 路径处理 MCP 协议请求
- 每个客户端连接创建独立的 `StreamableHTTPServerTransport` + `Server` 实例
- Session 通过 `mcp-session-id` HTTP header 跟踪
- Session 管理：`Map<sessionId, { server, transport }>`，定期清理过期 session
- 每个 session 的 Server 注册相同的 tool handler（atomicTools / taskTools）
- DELETE 请求关闭指定 session

**stdio 模式（备选）**：

- `new Server()` + `StdioServerTransport`，单客户端，适合简单场景

**通用**：

- 注册 `ListToolsRequestSchema` 和 `CallToolRequestSchema` handler
- CallTool handler 内部路由到 atomicTools / taskTools
- 连接断开：Transport 关闭时 AbortSignal 自动触发，正在执行的 `gui_execute_task` 会收到 abort 信号并终止 Agent 循环

### 3.11 mcp/taskTools.ts — gui_execute_task 处理

- `executeTask(taskText, extra)` 函数：MCP tool handler 的核心逻辑
- `Mutex` 互斥锁：确保同时只有一个 GUI 任务在执行
- 流程：
  1. `mutex.acquire()` — 获取锁（如已有任务在执行则等待）
  2. `taskRunner.run(taskText, extra.signal)` — 启动 Agent 循环
  3. 循环中通过 `extra.sendNotification()` 推送 progress
  4. 监听 `extra.signal` 处理取消（AbortSignal → `agent.abort()`）
  5. `mutex.release()` — 释放锁（finally 块中确保释放）
  6. 返回 `{ success, result, finalScreenshot, steps }` 给 MCP 调用方

---

## 4. Electron 客户端改造

### 4.1 改造范围

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src/main/services/computerServer.ts` | 新增 4 个 `/computer/gui-agent/*` 路由 |
| 修改 | `src/shared/types/computerTypes.ts` | 新增 `GuiVisionModelConfig` 类型 |
| 新增 | `src/renderer/components/GUIAgentSettings.tsx` | 显示器选择 + 视觉模型配置 UI |
| 修改 | `src/renderer/components/SettingsPage.tsx` | 集成 GUIAgentSettings 标签页 |

### 4.2 computerServer.ts 新增路由

在 `handleRequest` 中新增 4 个路由（复用现有的 JSON envelope 响应格式）：

| 路径 | 方法 | 逻辑 |
|------|------|------|
| `/computer/gui-agent/vision-model` | POST | 验证 body → 存 SQLite |
| `/computer/gui-agent/vision-model` | GET | 读 SQLite → 附加推断参数 |
| `/computer/gui-agent/displays` | GET | `screen.getAllDisplays()` |
| `/computer/gui-agent/display` | POST | 校验 displayIndex → 存 SQLite |

### 4.3 配置传递

启动 GUI Agent MCP Server 子进程时，从 SQLite 读取配置，注入为环境变量：
`GUI_AGENT_PROVIDER`, `GUI_AGENT_MODEL`, `GUI_AGENT_API_KEY`, `GUI_AGENT_BASE_URL`, `GUI_AGENT_DISPLAY_INDEX`, `GUI_AGENT_COORDINATE_MODE`

---

## 5. 实现阶段

### Phase 1: 项目脚手架 + 原子操作

**目标**: MCP Server 启动（Streamable HTTP），13 个原子操作可调用。

1. 创建 `crates/agent-gui-server/`，配置 package.json / tsconfig / vitest（参考 nuwax-mcp-stdio-proxy 约定）
2. config.ts — 环境变量解析
3. utils/ — logger, platform, errors
4. coordinates/ — modelProfiles + resolver
5. desktop/ — display, screenshot, mouse, keyboard, clipboard, imageSearch
6. safety/ — hotkeys, auditLog
7. mcp/ — atomicTools, resources, server（Streamable HTTP 主模式 + stdio 备选，参考 nuwax-mcp-stdio-proxy 的 HTTP server + session 管理模式）
8. index.ts — CLI 入口（`--port`、`--transport stdio`）

**验收**: `tools/list` 返回 13 个工具；`gui_screenshot` 返回正确截图和元数据；多个 MCP 客户端可同时连接。

### Phase 2: 坐标转换验证 + 多屏

**目标**: 坐标转换准确，多屏正确。

1. CoordinateResolver 单元测试：覆盖所有 7 种模型 + Retina/HiDPI + 多屏偏移
2. 截图管线单元测试：不同分辨率缩放后 metadata 正确
3. 端到端：MCP 调 `gui_screenshot` + `gui_click`，验证点击位置

### Phase 3: Agent 循环 (gui_execute_task)

**目标**: gui_execute_task 能执行自然语言 GUI 任务。

1. 安装 pi-mono 依赖（`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@sinclair/typebox`）
2. agent/systemPrompt.ts — 专用 system prompt
3. agent/taskRunner.ts — 创建 pi-mono `Agent` 实例，注册 `AgentTool[]`，接入 hooks：
   - `transformContext` → memoryManager 截图裁剪 + 记忆注入
   - `beforeToolCall` → hotkeys 安全拦截
   - `afterToolCall` → auditLog 审计记录
   - `convertToLlm` → 消息格式过滤
   - `toolExecution: 'sequential'`（GUI 操作串行）
4. agent/memoryManager.ts — 三层记忆 + LLM 摘要压缩（独立 `complete()` 调用）
5. agent/stuckDetector.ts — 卡死检测
6. mcp/taskTools.ts — 注册 gui_execute_task（同步阻塞 + Mutex + AbortSignal + progress notification）
7. 进度通知：`agent.subscribe()` 事件 → `extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total, message } })`

**验收**: `gui_execute_task("打开 Finder")` 自动完成，返回步骤日志。

### Phase 4: SDK 导出

**目标**: 提供 SDK 入口。

1. lib.ts — SDK 工厂函数导出

### Phase 5: Electron 客户端改造

**目标**: 显示器选择 + 视觉模型配置接口。

按第 4 节执行。

### Phase 6: 集成测试 + 文档

1. 与 claude-code / nuwaxcode 的 MCP 集成验证
2. 跨平台基本验证
3. README.md

---

## 6. 测试策略

### 重点单元测试

| 模块 | 覆盖重点 |
|------|---------|
| coordinates/resolver | 所有坐标家族转换、Gemini yx 坐标顺序 swap、Retina/HiDPI、多屏偏移、边界 clamp |
| coordinates/modelProfiles | 模型名匹配、coordinateOrder 区分、fallback、环境变量覆盖 |
| desktop/screenshot | 统一缩放策略（逻辑分辨率 + 最长边 1920 上限）、JPEG quality 降级、metadata 完整性 |
| desktop/clipboard | CJK 检测、长文本路由、剪贴板备份恢复 |
| safety/* | 黑名单匹配、环形缓冲 |
| agent/memoryManager | 三层记忆预算触发、LLM 摘要调用、compose() 输出、截图丢弃策略 |
| agent/stuckDetector | 相同/不同截图判定 |
| config | 必填校验、默认值 |

### Mock 策略

- **nut.js**: mock 避免实际操作桌面
- **sharp**: mock resize/jpeg/toBuffer 链，验证调用参数
- **pi-mono**: mock `Agent` 类（subscribe 发预设事件序列）、mock `getModel`、mock `complete`（记忆摘要调用）
- 框架: Vitest，配置参考 nuwax-mcp-stdio-proxy

---

## 7. 风险与应对

| 风险 | 应对 |
|------|------|
| nut.js prebuilt binary 某平台不可用 | CI 验证三平台；备选: platform-specific CLI (screencapture, cliclick) |
| pi-mono 某 Provider 的 tool calling 不兼容 | Anthropic + OpenAI 是核心场景，其他验证后再加入 modelProfiles |
| macOS 权限弹窗阻塞首次使用 | `gui://permissions` Resource 报告状态；README 提供授权步骤 |
| Agent 循环 token 消耗过快 | 三层记忆 memoryManager + LLM 摘要压缩；截图保留最近 3 步；maxSteps=50；JPEG quality=75 |
| Linux Wayland 不支持 | v1 仅支持 X11，Wayland 为 v2 |
| sharp 与 Electron 版本冲突 (SDK 嵌入模式) | MCP Server 独立进程无此问题；嵌入模式需 electron-rebuild |

---

## 8. 依赖清单

| 依赖 | 用途 |
|------|------|
| `@modelcontextprotocol/sdk` ^1.27.1 | MCP Server |
| `@nut-tree/nut-js` ^4.2.0 | 桌面自动化 |
| `@mariozechner/pi-ai` | 多 Provider LLM 调用 |
| `@mariozechner/pi-agent-core` | Agent 循环 + tool calling |
| `@sinclair/typebox` | AgentTool 参数 schema 定义 |
| `sharp` ^0.33.0 | 截图 resize + JPEG 编码 |
| `clipboardy` ^4.0.0 | 跨平台剪贴板读写 |

---

## 9. 工作空间集成

### 9.1 pnpm-workspace 配置

项目根目录 `pnpm-workspace.yaml` 已配置 `crates/*` 为工作空间：

```yaml
packages:
  - 'crates/*'
```

`crates/agent-gui-server/` 创建后自动成为工作空间成员。

### 9.2 Electron 客户端依赖集成

在 `crates/agent-electron-client/package.json` 中添加依赖：

```json
{
  "dependencies": {
    "nuwax-mcp-stdio-proxy": "workspace:*",
    "agent-gui-server": "workspace:*"  // 新增
  }
}
```

### 9.3 打包资源配置

在 `crates/agent-electron-client/package.json` 的 `electron-builder.extraResources` 中添加：

```json
{
  "extraResources": [
    {
      "from": "resources/nuwax-mcp-stdio-proxy",
      "to": "nuwax-mcp-stdio-proxy"
    },
    {
      "from": "resources/agent-gui-server",  // 新增
      "to": "agent-gui-server"
    }
  ]
}
```

### 9.4 集成方式参考

与 `nuwax-mcp-stdio-proxy` 相同：
- 工作空间依赖：`workspace:*`
- 打包时复制到 `resources/` 目录
- 运行时通过子进程方式启动 MCP Server

---

## 参考文件

| 文件 | 参考内容 |
|------|---------|
| `specs/gui-agent/gui-agent.md` | Spec 规范文档（权威需求来源） |
| `crates/nuwax-mcp-stdio-proxy/package.json` | 工程约定: ES modules、依赖版本、build/test scripts |
| `crates/nuwax-mcp-stdio-proxy/src/index.ts` | CLI 入口模式 |
| `crates/nuwax-mcp-stdio-proxy/src/shared/proxy-server.ts` | MCP Server 创建模式 |
| `crates/agent-electron-client/src/main/services/computerServer.ts` | Electron 改造目标（新增路由） |
| `crates/agent-electron-client/src/shared/types/computerTypes.ts` | 类型扩展（新增 GuiVisionModelConfig） |
