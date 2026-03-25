# NuwaClaw GUI Agent - Unified

> 整合 OSWorld 标准 + Pi-Agent 架构的高可用 GUI Agent 方案

## 设计目标

- **标准化**：遵循 OSWorld 16 种操作原语，与生态兼容
- **轻量级**：TypeScript 核心框架，易于集成到 Electron
- **可扩展**：Hook 系统 + 事件流，支持自定义行为
- **生产就绪**：VLM 集成、MCP 桥接、跨平台支持

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      GUI Agent Unified                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Core TS   │  │   Tools     │  │    VLM Integration  │  │
│  │   Agent     │  │  (Python)   │  │    (GLM-4V/Qwen)    │  │
│  │  Hook/Event │  │  OSWorld    │  │                     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │              │
│         └────────────────┼────────────────────┘              │
│                          ▼                                   │
│              ┌─────────────────────┐                         │
│              │    MCP Server       │                         │
│              │   (Python Bridge)   │                         │
│              └──────────┬──────────┘                         │
│                         ▼                                    │
│              ┌─────────────────────┐                         │
│              │   Electron/Main     │                         │
│              │   NuwaClaw Client   │                         │
│              └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
poc/gui-agent/
├── packages/
│   ├── core/           # TypeScript 核心 Agent 框架
│   │   ├── agent.ts    # Agent 运行时（Hook + 事件流）
│   │   ├── tools.ts    # 工具注册和执行
│   │   ├── types.ts    # 类型定义
│   │   └── index.ts    # 入口
│   │
│   ├── tools/          # OSWorld 标准工具（Python）
│   │   ├── nuwaclaw_osworld_agent.py  # 16 种操作原语
│   │   ├── image_locator.py           # 图像定位
│   │   ├── action_recorder.py         # 操作录制回放
│   │   └── platform_support.py        # 跨平台支持
│   │
│   ├── vlm/            # VLM 集成（Python）
│   │   └── vlm_integration.py         # GLM-4V/Qwen-VL
│   │
│   └── mcp-server/     # MCP Server 桥接（Python）
│       ├── mcp_server.py              # MCP 协议实现
│       └── mcp_package.json           # MCP 配置
│
├── examples/           # 测试和示例
├── docs/               # 文档
└── pyproject.toml      # Python 依赖
```

## 整合方案

### 从 Pi-Agent 借鉴

- ✅ `beforeToolCall` / `afterToolCall` Hook 系统
- ✅ 4 级事件流：`agent_start → tool_start → tool_end → agent_end`
- ✅ `onUpdate` 流式进度
- ✅ TypeScript 轻量实现（~400 行核心代码）

### 从 OSWorld 借鉴

- ✅ 16 种标准操作原语
- ✅ VLM 集成（GLM-4V、Qwen-VL）
- ✅ MCP Server 桥接
- ✅ 图像定位（OpenCV）
- ✅ 操作录制回放
- ✅ 跨平台支持（Win/Mac/Linux）

## 快速开始

### 1. 安装 Python 依赖

```bash
cd poc/gui-agent
pip install -e .
```

### 2. 安装 TypeScript 依赖

```bash
cd packages/core
npm install
```

### 3. 运行测试

```bash
# Python 工具测试
cd examples
python test_agent.py

# TypeScript Agent 测试
cd packages/core
npm run dev
```

## 使用示例

### TypeScript Agent（带 Hook）

```typescript
import { GUIAgent } from '@nuwaclaw/gui-agent';

const agent = new GUIAgent({
  // Hook: 权限控制
  beforeToolCall: async (ctx) => {
    if (ctx.toolName === 'click' && isDangerousPosition(ctx.params)) {
      return { block: true, reason: '需要用户确认' };
    }
  },
  
  // Hook: 结果处理
  afterToolCall: async (ctx) => {
    if (ctx.toolName === 'screenshot') {
      return { content: [markImage(ctx.result)] };
    }
  },
  
  // 事件监听
  onEvent: (event) => {
    console.log(event.type, event.data);
  },
});

// 执行操作
await agent.executeTool('click', { x: 100, y: 200 });
```

### Python 工具（OSWorld 标准）

```python
from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType

agent = OSWorldGUIAgent()

# 点击
action = Action(
    action_type=ActionType.CLICK,
    parameters={"x": 100, "y": 200}
)
result = agent.execute(action)
```

### MCP Server 桥接

```bash
# 启动 MCP Server
cd packages/mcp-server
python mcp_server.py
```

## 下一步

1. **统一类型定义**：TypeScript 和 Python 使用相同的类型 schema
2. **JSON-RPC 桥接**：Core TS ↔ Python Tools 通信
3. **Electron 集成**：作为 NuwaClaw Client 的 MCP 工具
4. **测试覆盖**：补充单元测试和集成测试

## 参考

- [OSWorld 项目](https://github.com/xlang-ai/OSWorld)
- [Pi-Agent 架构](./docs/PI_AGENT_README.md)
- [OSWorld 实现](./docs/OSWORLD_README.md)
