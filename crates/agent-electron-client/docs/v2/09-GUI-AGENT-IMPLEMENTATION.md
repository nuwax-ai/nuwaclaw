# NuwaClaw GUI Agent 实现方案

> 调研时间：2026-03-18  
> 调研项目：OSWorld, UI-TARS-desktop, ScreenAgent, Pi-Agent  
> 目标：独立且小巧的 GUI Agent 方案

---

## 一、调研结果对比

### 1.1 项目特性对比

| 项目 | 类型 | 核心特点 | 复杂度 | 适用性 |
|------|------|---------|--------|--------|
| **OSWorld** | 评测基准 | 完整 GUI 操作空间，跨平台 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **UI-TARS-desktop** | 生产 Agent | 多模态 + 视觉定位 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **ScreenAgent** | 模型训练 | VLM 微调，屏幕理解 | ⭐⭐⭐ | ⭐⭐ |
| **Pi-Agent** | Agent 框架 | 轻量级，事件驱动 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Agent-S** | 现有方案 | 已集成 | ⭐⭐⭐⭐ | ⭐⭐⭐ |

### 1.2 GUI 操作原语对比

| 操作类型 | OSWorld | UI-TARS | NuwaClaw 建议实现 |
|---------|---------|---------|-----------------|
| **鼠标移动** | MOVE_TO | - | ✅ `move_to(x, y)` |
| **点击** | CLICK | `click(point)` | ✅ `click(x, y, button?)` |
| **双击** | DOUBLE_CLICK | `left_double(point)` | ✅ `double_click(x, y)` |
| **右键** | RIGHT_CLICK | `right_single(point)` | ✅ `right_click(x, y)` |
| **拖拽** | DRAG_TO | `drag(start, end)` | ✅ `drag(x1, y1, x2, y2)` |
| **滚动** | SCROLL(dx, dy) | `scroll(point, direction)` | ✅ `scroll(dx, dy)` |
| **输入文本** | TYPING | `type(content)` | ✅ `type_text(text, speed?)` |
| **按键** | PRESS, KEY_DOWN, KEY_UP | - | ✅ `press(key)` |
| **快捷键** | HOTKEY | `hotkey(key)` | ✅ `hotkey(...keys)` |
| **截图** | - | screenshot() | ✅ `screenshot(region?)` |
| **等待** | WAIT | `wait()` | ✅ `wait(ms?)` |

---

## 二、NuwaClaw GUI Agent 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│           NuwaClaw Main Agent (ACP Engine)          │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │       GUI Agent (独立微服务/MCP Server)        │ │
│  │                                                 │ │
│  │  ┌─────────────┐       ┌──────────────────┐   │ │
│  │  │ GUI Tools   │──────▶│ Desktop Operator │   │ │
│  │  │             │       │                  │   │ │
│  │  │ - screenshot│       │ - pyautogui      │   │ │
│  │  │ - click     │       │ - robotjs        │   │ │
│  │  │ - type      │       │ - nut.js         │   │ │
│  │  │ - scroll    │       │                  │   │ │
│  │  └─────────────┘       └──────────────────┘   │ │
│  │         │                       │              │ │
│  │         ▼                       ▼              │ │
│  │  ┌─────────────────────────────────────────┐  │ │
│  │  │        Pi-Agent Core (轻量运行时)        │  │ │
│  │  │                                         │  │ │
│  │  │  - AgentState (状态管理)                │  │ │
│  │  │  - EventStream (事件流)                 │  │ │
│  │  │  - Hook System (权限控制)               │  │ │
│  │  │  - ToolExecutor (工具执行)              │  │ │
│  │  └─────────────────────────────────────────┘  │ │
│  │                     │                          │ │
│  │                     ▼                          │ │
│  │          ┌──────────────────────┐             │ │
│  │          │  VLM (视觉语言模型)  │             │ │
│  │          │                      │             │ │
│  │          │  - GPT-4V            │             │ │
│  │          │  - Claude Vision     │             │ │
│  │          │  - Gemini Vision     │             │ │
│  │          │  - 自定义 VLM         │             │ │
│  │          └──────────────────────┘             │ │
│  └───────────────────────────────────────────────┘ │
│                       ▲                            │
│                       │ MCP / IPC                  │
│                       │                            │
│            ┌──────────┴──────────┐                │
│            │  Main Agent Bridge  │                │
│            └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 GUI Tools (工具层)

**参考：OSWorld ACTION_SPACE + UI-TARS BrowserGUIAgent**

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@nuwaclaw/agent';

export const guiTools: AgentTool[] = [
  {
    name: 'screenshot',
    label: '📸 截取屏幕',
    description: '截取屏幕或指定区域，返回 base64 图片',
    parameters: Type.Object({
      region: Type.Optional(Type.Object({
        x: Type.Number({ minimum: 0 }),
        y: Type.Number({ minimum: 0 }),
        width: Type.Number({ minimum: 1 }),
        height: Type.Number({ minimum: 1 }),
      })),
      format: Type.Optional(Type.Union([
        Type.Literal('png'),
        Type.Literal('jpeg'),
        Type.Literal('webp'),
      ])),
      quality: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    }),
    execute: async (callId, params, signal, onUpdate) => {
      onUpdate({ status: 'capturing', progress: 0 });
      
      const screenshot = await desktopCapturer.capture(params.region);
      
      // 压缩图片（借鉴 UI-TARS）
      if (params.format === 'webp' || params.quality) {
        const compressed = await imageCompressor.compress(screenshot.buffer, {
          format: params.format || 'webp',
          quality: params.quality || 80,
        });
        screenshot.buffer = compressed;
      }
      
      onUpdate({ status: 'capturing', progress: 100 });
      
      return {
        content: [{
          type: 'image',
          data: screenshot.base64,
          mimeType: `image/${params.format || 'png'}`,
        }],
        details: {
          width: screenshot.width,
          height: screenshot.height,
          size: screenshot.buffer.length,
          timestamp: Date.now(),
        },
      };
    },
  },
  
  {
    name: 'click',
    label: '👆 点击',
    description: '点击屏幕指定位置',
    parameters: Type.Object({
      x: Type.Number({ minimum: 0 }),
      y: Type.Number({ minimum: 0 }),
      button: Type.Optional(Type.Union([
        Type.Literal('left'),
        Type.Literal('right'),
        Type.Literal('middle'),
      ])),
      numClicks: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
    }),
    execute: async (callId, params, signal) => {
      // 权限检查（通过 Hook 系统）
      
      // 移动鼠标
      await robotjs.moveMouse(params.x, params.y);
      
      // 点击
      await robotjs.mouseClick(params.button || 'left', params.numClicks || 1);
      
      return {
        content: [{ type: 'text', text: `已点击 (${params.x}, ${params.y})` }],
        details: params,
      };
    },
  },
  
  {
    name: 'type_text',
    label: '⌨️ 输入文本',
    description: '输入文本（支持流式进度）',
    parameters: Type.Object({
      text: Type.String({ minLength: 1 }),
      typingSpeed: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
    }),
    execute: async (callId, params, signal, onUpdate) => {
      const chars = params.text.length;
      const speed = params.typingSpeed || 50; // ms per char
      
      for (let i = 0; i < chars; i++) {
        // 检查取消信号
        if (signal?.aborted) {
          throw new Error('Typing aborted by user');
        }
        
        // 输入字符
        await robotjs.typeString(params.text[i]);
        
        // 流式进度更新
        if (i % 10 === 0 || i === chars - 1) {
          onUpdate({
            progress: (i / chars) * 100,
            charsTyped: i + 1,
            totalChars: chars,
          });
        }
        
        // 延迟
        if (speed > 0) {
          await sleep(speed);
        }
      }
      
      return {
        content: [{ type: 'text', text: `已输入 ${chars} 个字符` }],
        details: { length: chars, speed },
      };
    },
  },
  
  {
    name: 'scroll',
    label: '📜 滚动',
    description: '滚动鼠标滚轮',
    parameters: Type.Object({
      dx: Type.Optional(Type.Number()),
      dy: Type.Number(),
    }),
    execute: async (callId, params, signal) => {
      await robotjs.scrollMouse(params.dx || 0, params.dy);
      
      return {
        content: [{ type: 'text', text: `已滚动 (${params.dx || 0}, ${params.dy})` }],
        details: params,
      };
    },
  },
  
  {
    name: 'hotkey',
    label: '⌨️ 快捷键',
    description: '按下组合键',
    parameters: Type.Object({
      keys: Type.Array(Type.String()),
    }),
    execute: async (callId, params, signal) => {
      await robotjs.keyTap(params.keys.join('+'));
      
      return {
        content: [{ type: 'text', text: `已按下 ${params.keys.join(' + ')}` }],
        details: { keys: params.keys },
      };
    },
  },
  
  {
    name: 'wait',
    label: '⏳ 等待',
    description: '等待指定时间或条件',
    parameters: Type.Object({
      ms: Type.Optional(Type.Number({ minimum: 0 })),
      condition: Type.Optional(Type.String()),
    }),
    execute: async (callId, params, signal, onUpdate) => {
      if (params.ms) {
        await sleep(params.ms);
      } else if (params.condition) {
        // 等待条件满足（轮询检查）
        const startTime = Date.now();
        while (Date.now() - startTime < 30000) { // 最多 30 秒
          if (signal?.aborted) {
            throw new Error('Wait aborted');
          }
          
          // 检查条件（例如：窗口出现、元素可见等）
          const satisfied = await checkCondition(params.condition);
          if (satisfied) {
            break;
          }
          
          onUpdate({ elapsed: Date.now() - startTime });
          await sleep(500);
        }
      }
      
      return {
        content: [{ type: 'text', text: '等待完成' }],
        details: params,
      };
    },
  },
];
```

#### 2.2.2 Pi-Agent Core (运行时)

**借鉴：Pi-Agent 事件系统 + Hook 机制**

```typescript
import { Agent, type AgentEvent } from '@nuwaclaw/pi-agent';

export class NuwaClawGUIAgent {
  private agent: Agent;
  
  constructor(config: {
    vlmModel: ModelConfig;
    tools?: AgentTool[];
    permissions?: PermissionConfig;
  }) {
    this.agent = new Agent({
      initialState: {
        systemPrompt: `你是 NuwaClaw 的 GUI 操作专家。
        
支持的操作：
- screenshot: 截取屏幕
- click: 点击
- type_text: 输入文本
- scroll: 滚动
- hotkey: 快捷键
- wait: 等待

每次操作前：
1. 先截图观察当前状态
2. 分析需要操作的元素位置
3. 执行操作
4. 再次截图验证结果

注意：
- 操作前需要用户确认（可通过配置跳过）
- 支持撤销操作
- 失败时自动重试（最多 3 次）`,
        model: config.vlmModel,
        tools: config.tools || guiTools,
      },
    });
    
    // 设置权限控制 Hook
    this.agent.setBeforeToolCall(async (context, signal) => {
      // 检查是否需要用户确认
      if (this.needsConfirmation(context.toolCall.name)) {
        const confirmed = await this.showConfirmationDialog(context);
        if (!confirmed) {
          return {
            block: true,
            reason: '用户拒绝操作',
          };
        }
      }
      
      // 记录审计日志
      this.logAction(context);
      
      return undefined; // 继续执行
    });
    
    // 设置结果处理 Hook
    this.agent.setAfterToolCall(async (context, signal) => {
      // 截图后自动添加标记
      if (context.toolName === 'screenshot' && !context.isError) {
        // 在图片上标记可点击元素（借鉴 UI-TARS）
        const markedImage = await this.markClickableElements(context.result);
        return {
          content: [{ type: 'image', ...markedImage }],
        };
      }
      
      // 失败时自动重试
      if (context.isError && this.shouldRetry(context)) {
        return this.retryToolCall(context);
      }
      
      return undefined;
    });
  }
  
  async execute(instruction: string): Promise<void> {
    return this.agent.prompt(instruction);
  }
  
  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.agent.subscribe(listener);
  }
  
  abort(): void {
    this.agent.abort();
  }
}
```

#### 2.2.3 MCP Server 集成

**将 GUI Agent 打包为 MCP Server**

```typescript
// mcp-servers/gui-agent/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NuwaClawGUIAgent } from '@nuwaclaw/gui-agent';

const server = new Server({
  name: 'nuwaclaw-gui-agent',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

const guiAgent = new NuwaClawGUIAgent({
  vlmModel: {
    provider: 'anthropic',
    id: 'claude-3-5-sonnet-20241022',
  },
});

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: guiTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  };
});

// 执行工具
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  const tool = guiTools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  
  const result = await tool.execute(
    generateCallId(),
    args,
    undefined,
    (update) => {
      // 发送进度更新（通过 MCP 通知）
      server.notification({
        method: 'notifications/progress',
        params: update,
      });
    },
  );
  
  return {
    content: result.content.map(c => {
      if (c.type === 'text') {
        return { type: 'text', text: c.text };
      } else if (c.type === 'image') {
        return {
          type: 'image',
          data: c.data,
          mimeType: c.mimeType,
        };
      }
    }),
  };
});

// 启动服务器
const transport = new StdioServerTransport();
server.connect(transport);
```

#### 2.2.4 Main Agent 集成

**在 NuwaClaw 主 Agent 中调用**

```typescript
// nuwaclaw-agent/src/core/gui-bridge.ts
import type { AgentTool } from '@nuwaclaw/agent';

export const guiBridgeTools: AgentTool[] = [
  {
    name: 'gui_execute',
    label: '🖥️ 执行 GUI 操作',
    description: '委托 GUI Agent 执行屏幕操作',
    parameters: Type.Object({
      instruction: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    execute: async (callId, params, signal, onUpdate) => {
      onUpdate({ status: 'delegating', instruction: params.instruction });
      
      // 通过 MCP 调用 GUI Agent
      const mcpClient = getMCPClient('nuwaclaw-gui-agent');
      
      const result = await mcpClient.callTool('execute', {
        instruction: params.instruction,
        timeout: params.timeout || 60000,
      });
      
      return {
        content: [{ type: 'text', text: result.summary }],
        details: {
          actions: result.actions,
          screenshots: result.screenshots,
          duration: result.duration,
        },
      };
    },
  },
  
  {
    name: 'gui_screenshot',
    label: '📸 获取屏幕截图',
    description: '从 GUI Agent 获取当前屏幕截图',
    parameters: Type.Object({
      region: Type.Optional(Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        width: Type.Number(),
        height: Type.Number(),
      })),
    }),
    execute: async (callId, params, signal) => {
      const mcpClient = getMCPClient('nuwaclaw-gui-agent');
      
      const result = await mcpClient.callTool('screenshot', params);
      
      return {
        content: [result.image],
        details: result.details,
      };
    },
  },
];
```

---

## 三、实施路线图

### Phase 1: 核心实现（1-2 周）

**目标：MVP 可用**

- [ ] **GUI Tools 实现**
  - [ ] screenshot（截图 + 压缩）
  - [ ] click（点击 + 坐标验证）
  - [ ] type_text（输入 + 流式进度）
  - [ ] scroll（滚动）
  - [ ] hotkey（快捷键）
  - [ ] wait（等待）

- [ ] **Desktop Operator 实现**
  - [ ] 跨平台鼠标/键盘控制（robotjs / nut.js）
  - [ ] 屏幕捕获（desktopCapturer）
  - [ ] 图片压缩（ImageCompressor）

- [ ] **Pi-Agent Core 集成**
  - [ ] Agent 类封装
  - [ ] 事件系统（4 级生命周期）
  - [ ] Hook 系统（权限 + 审计）

### Phase 2: MCP 集成（1 周）

**目标：独立微服务化**

- [ ] **MCP Server 打包**
  - [ ] 工具注册
  - [ ] 进度通知
  - [ ] 错误处理

- [ ] **配置管理**
  - [ ] VLM 模型配置
  - [ ] 权限策略配置
  - [ ] 性能参数配置

- [ ] **测试**
  - [ ] 单元测试
  - [ ] 集成测试
  - [ ] E2E 测试（OSWorld benchmark）

### Phase 3: Main Agent 集成（1 周）

**目标：与 NuwaClaw 主 Agent 协同**

- [ ] **Bridge Tools**
  - [ ] gui_execute
  - [ ] gui_screenshot

- [ ] **权限控制 UI**
  - [ ] 确认对话框
  - [ ] 审计日志查看
  - [ ] 撤销操作

- [ ] **配置界面**
  - [ ] VLM 模型选择
  - [ ] 权限级别设置
  - [ ] 性能调优

### Phase 4: 优化与增强（持续）

**目标：生产级稳定性**

- [ ] **性能优化**
  - [ ] 图片压缩优化
  - [ ] 操作延迟优化
  - [ ] 内存管理

- [ ] **错误恢复**
  - [ ] 自动重试
  - [ ] 操作回滚
  - [ ] 状态恢复

- [ ] **高级功能**
  - [ ] 元素识别（OCR + 视觉定位）
  - [ ] 录制回放
  - [ ] 脚本生成

---

## 四、关键技术细节

### 4.1 跨平台实现

```typescript
// 选择合适的底层库
const desktopOperator = {
  // 方案 A: robotjs (Node.js 原生)
  mouse: {
    move: (x, y) => robotjs.moveMouse(x, y),
    click: (button) => robotjs.mouseClick(button),
    scroll: (dx, dy) => robotjs.scrollMouse(dx, dy),
  },
  keyboard: {
    type: (text) => robotjs.typeString(text),
    tap: (key) => robotjs.keyTap(key),
    hotkey: (...keys) => robotjs.keyTap(keys.join('+')),
  },
  screen: {
    capture: (region) => desktopCapturer.capture(region),
  },
  
  // 方案 B: nut.js (更现代，支持 Promise)
  // ...
};
```

### 4.2 图片压缩（借鉴 UI-TARS）

```typescript
import sharp from 'sharp';

export class ImageCompressor {
  async compress(
    buffer: Buffer,
    options: { format: 'webp' | 'jpeg'; quality: number },
  ): Promise<Buffer> {
    return sharp(buffer)
      .toFormat(options.format, { quality: options.quality })
      .toBuffer();
  }
}

// 使用
const compressed = await compressor.compress(screenshot, {
  format: 'webp',
  quality: 80,
});
// 通常可减少 70-90% 体积
```

### 4.3 坐标归一化

```typescript
// 借鉴 UI-TARS 的坐标处理
export function normalizeCoordinates(
  coords: { x: number; y: number },
  screenWidth: number,
  screenHeight: number,
): { normalized: { x: number; y: number }; absolute: { x: number; y: number } } {
  return {
    normalized: {
      x: coords.x / 1000, // 归一化到 [0, 1]
      y: coords.y / 1000,
    },
    absolute: {
      x: (coords.x / 1000) * screenWidth,
      y: (coords.y / 1000) * screenHeight,
    },
  };
}
```

---

## 五、测试与验证

### 5.1 OSWorld Benchmark 测试

```bash
# 运行 OSWorld 评测
cd OSWorld
python run.py --agent nuwaclaw --max_steps 50 --test_set mini
```

### 5.2 单元测试

```typescript
describe('NuwaClawGUIAgent', () => {
  it('should take screenshot', async () => {
    const agent = new NuwaClawGUIAgent(config);
    const result = await agent.execute('截取屏幕');
    
    expect(result.content[0].type).toBe('image');
    expect(result.details.width).toBeGreaterThan(0);
  });
  
  it('should click with confirmation', async () => {
    const agent = new NuwaClawGUIAgent(config);
    
    // Mock confirmation dialog
    mockConfirmation(true);
    
    const result = await agent.execute('点击 (100, 100)');
    expect(result.content[0].text).toContain('已点击');
  });
});
```

---

## 六、总结

### 6.1 核心优势

1. **独立且小巧**：基于 Pi-Agent 轻量运行时
2. **借鉴业界最佳实践**：OSWorld 操作空间 + UI-TARS 视觉定位
3. **灵活集成**：支持 MCP / IPC / 直接调用
4. **完善的安全机制**：Hook 权限控制 + 审计日志
5. **生产级可靠性**：错误恢复 + 自动重试

### 6.2 与现有方案对比

| 特性 | Agent-S (现有) | NuwaClaw GUI Agent (新) |
|------|----------------|------------------------|
| **架构** | 集成式 | 独立微服务 |
| **模型** | 共享 | 独立 VLM 配置 |
| **权限** | 简单 | 完善的 Hook 系统 |
| **事件** | 基础 | 4 级生命周期 |
| **测试** | 手动 | OSWorld benchmark |
| **复用性** | 低 | 高（MCP Server） |

### 6.3 关键决策

✅ **推荐采用：Pi-Agent + OSWorld 操作空间 + UI-TARS 视觉定位**

**理由：**
1. Pi-Agent 最轻量，事件系统完善
2. OSWorld 操作空间最标准化
3. UI-TARS 图片压缩和坐标处理最成熟
4. 可独立演进，不影响主 Agent

---

**下一步行动：**

1. ✅ 在 `worktree/docs/gpui-research` 分支创建 PoC
2. ✅ 实现核心 GUI Tools（screenshot/click/type）
3. ✅ 集成 Pi-Agent 运行时
4. ✅ 打包为 MCP Server
5. ✅ 与主 Agent 集成测试

---

**参考资源：**
- OSWorld: https://github.com/xlang-ai/OSWorld
- UI-TARS-desktop: https://github.com/bytedance/UI-TARS-desktop
- Pi-Agent: `/Users/apple/workspace/pi-mono/packages/agent`
- Pi-Agent 深度研究: `/Users/apple/workspace/pi-mono/PI-AGENT-DEEP-RESEARCH.md`
