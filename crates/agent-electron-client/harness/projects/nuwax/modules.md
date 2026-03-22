# Nuwax 模块开发规范

> 适用于 Nuwax Agent OS 的各个功能模块

---

## 模块概览

```
src/
├── pages/
│   ├── AppDev/        # AppDev Web IDE 模块
│   ├── Chat/          # 聊天模块
│   ├── Workflow/      # 工作流模块
│   ├── Agent/         # Agent 管理模块
│   ├── Skills/        # Skills 市场模块
│   └── Settings/      # 设置模块
```

---

## 1. AppDev Web IDE 模块

### 核心功能
- 项目文件树管理
- 开发服务器管理
- AI 聊天对话（SSE 实时通信）
- 工具调用执行

### 核心文件
```
pages/AppDev/
├── index.tsx                    # 主入口
├── components/
│   ├── FileTree/                # 文件树组件
│   │   ├── index.tsx
│   │   ├── FileTree.tsx
│   │   └── types.ts
│   ├── Editor/                  # 编辑器组件
│   ├── Terminal/               # 终端组件
│   └── ChatPanel/              # AI 聊天面板
├── hooks/
│   ├── useAppDevFileManagement.ts  # 文件管理
│   ├── useAppDevServer.ts          # 服务器管理
│   └── useAppDevChat.ts            # 聊天对话
└── services/
    └── appDevService.ts        # API 服务
```

### SSE 通信规范

```typescript
// utils/sseManager.ts
/**
 * SSE 连接管理器
 * 
 * 功能：
 * - 自动重连机制
 * - 连接状态监控
 * - 消息分发处理
 * - 错误恢复策略
 */
export class SSEManager {
  // 连接
  connect(url: string): void;
  disconnect(): void;
  
  // 消息处理
  onMessage(callback: (data: SSEMessage) => void): void;
  onError(callback: (error: Error) => void): void;
  onOpen(callback: () => void): void;
}
```

### 消息类型

```typescript
// types/sse.ts
export enum SSEMessageType {
  AGENT_THOUGHT_CHUNK = 'agent_thought_chunk',   // AI 思考过程
  AGENT_MESSAGE_CHUNK = 'agent_message_chunk',   // AI 回复内容
  TOOL_CALL = 'tool_call',                       // 工具调用
  PROMPT_END = 'prompt_end',                     // 会话结束
  ERROR = 'error',                              // 错误
}

/**
 * SSE 消息结构
 */
export interface SSEMessage {
  type: SSEMessageType;
  sessionId: string;
  data?: string;
  timestamp: number;
}
```

### AppDev 约束

- ✅ 必须使用 `sseManager.ts` 管理 SSE 连接
- ✅ 消息类型必须定义在 `types/sse.ts`
- ✅ 文件操作必须通过 `useAppDevFileManagement` Hook
- ❌ 禁止直接使用 EventSource
- ❌ 禁止在组件内直接操作文件

---

## 2. Chat 聊天模块

### 核心功能
- 多会话管理
- 消息流式显示
- AI 思考过程展示
- 工具调用状态

### 核心文件
```
pages/Chat/
├── index.tsx
├── components/
│   ├── ChatList/           # 会话列表
│   ├── ChatWindow/         # 聊天窗口
│   ├── MessageItem/        # 消息项
│   └── ThinkingProcess/    # 思考过程
├── hooks/
│   ├── useChatList.ts     # 会话列表
│   └── useChatMessage.ts  # 消息处理
└── services/
    └── chatService.ts
```

### 消息类型定义

```typescript
// types/chat.ts
export interface ChatMessage {
  id: string;
  type: 'ai' | 'user' | 'button' | 'section' | 'thinking' | 'tool_call';
  content?: string;
  sessionId?: string;
  isStreaming?: boolean;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolParams?: Record<string, unknown>;
    thinking?: string;
  };
}
```

### Chat 约束

- ✅ 消息必须有类型定义
- ✅ 流式消息必须显示 Loading 状态
- ✅ AI 思考过程必须可折叠
- ✅ 工具调用必须显示状态

---

## 3. Workflow 工作流模块

### 核心功能
- 工作流画布（AntV X6）
- 节点拖拽
- 连线管理
- 工作流执行

### 核心文件
```
pages/Workflow/
├── index.tsx
├── components/
│   ├── WorkflowCanvas/     # 画布组件
│   │   ├── index.tsx
│   │   ├── Canvas.tsx
│   │   ├── Toolbar.tsx
│   │   └── types.ts
│   ├── NodePanel/          # 节点面板
│   └── PropertyPanel/      # 属性面板
├── hooks/
│   ├── useWorkflow.ts      # 工作流管理
│   └── useWorkflowNodes.ts # 节点管理
└── services/
    └── workflowService.ts
```

### AntV X6 使用规范

```typescript
// types/workflow.ts
import { Graph, Model, Node, Edge } from '@antv/x6';

/**
 * 工作流节点定义
 */
export interface WorkflowNode extends Node.Metadata {
  id: string;
  type: 'start' | 'end' | 'action' | 'condition' | 'agent';
  data: {
    label: string;
    icon?: string;
    config?: Record<string, unknown>;
  };
}

/**
 * 工作流边定义
 */
export interface WorkflowEdge extends Edge.Metadata {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'straight' | 'orthogonal' | 'bezier';
}

/**
 * 工作流图数据
 */
export interface WorkflowGraphData extends Model.ToJSON {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
```

### Workflow 约束

- ✅ 节点必须定义类型和数据结构
- ✅ 使用 `useWorkflow` Hook 管理画布状态
- ✅ 画布配置必须抽离成常量
- ✅ 节点/边样式必须统一

---

## 4. Agent 管理模块

### 核心功能
- Agent 创建/编辑
- Agent 技能配置
- Agent 运行时监控

### 核心文件
```
pages/Agent/
├── index.tsx
├── components/
│   ├── AgentCard/          # Agent 卡片
│   ├── AgentForm/          # Agent 表单
│   ├── AgentConfig/        # 技能配置
│   └── AgentRuntime/      # 运行时监控
├── hooks/
│   ├── useAgentList.ts
│   └── useAgentRuntime.ts
└── services/
    └── agentService.ts
```

---

## 5. Skills 市场模块

### 核心功能
- Skill 列表
- Skill 安装/卸载
- Skill 市场

### 核心文件
```
pages/Skills/
├── index.tsx
├── components/
│   ├── SkillCard/         # Skill 卡片
│   ├── SkillDetail/       # Skill 详情
│   └── SkillInstall/     # 安装弹窗
├── hooks/
│   ├── useSkillList.ts
│   └── useSkillInstall.ts
└── services/
    └── skillService.ts
```

---

## 通用组件规范

### 组件目录
```
src/components/
├── Basic/              # 基础组件
│   ├── Button/
│   ├── Input/
│   └── Modal/
├── Business/           # 业务组件
│   ├── AgentCard/
│   └── WorkflowCanvas/
└── Desktop/            # 桌面组件
    ├── TitleBar/
    └── StatusBar/
```

### 命名规范
```
MyComponent/
├── index.ts            # 导出
├── MyComponent.tsx     # 主组件
├── MyComponent.less    # 样式
└── useMyComponent.ts  # 关联 Hook（可选）
```

---

## API 服务规范

### 目录结构
```
src/services/
├── types.ts           # API 类型定义
├── request.ts         # 请求封装
├── appDev.ts          # AppDev API
├── chat.ts            # Chat API
├── workflow.ts        # Workflow API
├── agent.ts           # Agent API
└── skill.ts           # Skill API
```

### 请求封装

```typescript
// services/request.ts
/**
 * API 请求封装
 * 
 * 基于 umi-request，统一处理：
 * - 请求拦截
 * - 响应拦截
 * - 错误处理
 * - Token 刷新
 */
import { extend } from 'umi-request';

const request = extend({
  prefix: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 响应拦截 - 处理错误
request.interceptors.response.use((response) => {
  return response;
});

export default request;
```

### API 模板

```typescript
// services/appDev.ts
import request from './request';
import type { ApiResponse, PaginationParams } from './types';

/**
 * 获取 AppDev 列表
 * @param params - 分页参数
 */
export async function getAppDevList(params: PaginationParams) {
  return request<ApiResponse<AppDev[]>>('/app-dev/list', {
    method: 'GET',
    params,
  });
}

/**
 * 创建 AppDev
 * @param data - 创建数据
 */
export async function createAppDev(data: CreateAppDevDTO) {
  return request<ApiResponse<AppDev>>('/app-dev/create', {
    method: 'POST',
    data,
  });
}
```
