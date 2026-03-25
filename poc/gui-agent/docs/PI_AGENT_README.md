# NuwaClaw GUI Agent - PoC

> 概念验证：基于 Pi-Agent 架构的轻量级 GUI Agent

## 快速开始

```bash
# 安装依赖
npm install

# 运行测试
npm run dev
```

## 核心概念

### 1. 工具定义（借鉴 OSWorld）

```typescript
const screenshotTool: Tool = {
  name: 'screenshot',
  label: '📸 截取屏幕',
  description: '截取屏幕或指定区域，返回 base64 图片',
  parameters: Type.Object({
    region: Type.Optional(...),
    format: Type.Optional(...),
  }),
  execute: async (callId, params, signal, onUpdate) => {
    // 执行逻辑
    onUpdate?.({ progress: 50 }); // 流式进度
    return { content: [...], details: {...} };
  },
};
```

### 2. Agent 运行时（借鉴 Pi-Agent）

```typescript
const agent = new GUIAgent({
  tools: [screenshotTool, clickTool, typeTextTool],
  
  // Hook: 权限控制
  beforeToolCall: async (context) => {
    if (isDangerous(context)) {
      return { block: true, reason: '需要用户确认' };
    }
  },
  
  // Hook: 结果处理
  afterToolCall: async (context) => {
    if (context.toolName === 'screenshot') {
      return { content: [markedImage] };
    }
  },
  
  // 事件监听
  onEvent: (event) => {
    console.log(event.type); // agent_start, tool_execution_end, etc.
  },
});
```

### 3. 执行方式

```typescript
// 单个工具
const result = await agent.executeTool('screenshot', { format: 'webp' });

// 批量执行
const results = await agent.execute([
  { tool: 'screenshot', params: { format: 'webp' } },
  { tool: 'click', params: { x: 100, y: 200 } },
  { tool: 'type_text', params: { text: 'Hello' } },
]);

// 取消执行
agent.abort();
```

## 核心特性

| 特性 | 说明 | 状态 |
|------|------|------|
| **工具定义** | TypeBox 类型安全 | ✅ |
| **Hook 系统** | beforeToolCall / afterToolCall | ✅ |
| **事件流** | 4 级生命周期 | ✅ |
| **流式进度** | onUpdate callback | ✅ |
| **取消机制** | AbortSignal | ✅ |
| **图片压缩** | Sharp + WebP | ✅ |
| **跨平台** | robotjs / nut.js | 🔧 Mock |

## 测试结果示例

```
============================================================
NuwaClaw GUI Agent - PoC 测试
============================================================

📝 测试 1: 截图工具
----------------------------------------
[HOOK] beforeToolCall: screenshot
  参数: { "format": "webp", "quality": 80 }

[2026-03-18T01:40:00.000Z] 🔧 开始执行工具: screenshot
[2026-03-18T01:40:00.100Z] ⏳ 进度更新: {"status":"capturing","progress":50}
[2026-03-18T01:40:00.200Z] ✅ 工具执行完成: screenshot

结果:
  类型: image
  详情: { size: 45678, format: 'webp', quality: 80 }
```

## 与 Pi-Agent 对比

| 特性 | Pi-Agent | NuwaClaw GUI Agent PoC |
|------|----------|------------------------|
| **代码量** | ~500 行 | ~300 行 |
| **事件系统** | ✅ 4 级 | ✅ 4 级 |
| **Hook 系统** | ✅ 完整 | ✅ 完整 |
| **工具执行** | ✅ sequential/parallel | ✅ sequential |
| **流式更新** | ✅ onUpdate | ✅ onUpdate |
| **消息管道** | ✅ convertToLlm | 🔧 简化 |

## 下一步

- [ ] 集成真实 robotjs（替换 Mock）
- [ ] 添加更多工具（scroll, hotkey, wait）
- [ ] 实现 parallel 工具执行
- [ ] 打包为 MCP Server
- [ ] 集成 VLM 模型

## 参考

- [Pi-Agent 深度研究](../../../../pi-mono/PI-AGENT-DEEP-RESEARCH.md)
- [OSWorld ACTION_SPACE](../../OSWorld/desktop_env/actions.py)
- [UI-TARS BrowserGUIAgent](../../UI-TARS-desktop/multimodal/agent-tars/core/src/environments/local/browser/browser-gui-agent.ts)
