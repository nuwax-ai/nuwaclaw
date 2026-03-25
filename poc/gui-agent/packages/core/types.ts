/**
 * NuwaClaw GUI Agent - Unified Types
 * 
 * 整合 OSWorld 标准 + Pi-Agent 架构的类型定义
 */

// ==================== OSWorld 标准操作类型 ====================

/** OSWorld 16 种操作原语 */
export enum ActionType {
  // 鼠标操作
  MOVE_TO = 'MOVE_TO',
  CLICK = 'CLICK',
  MOUSE_DOWN = 'MOUSE_DOWN',
  MOUSE_UP = 'MOUSE_UP',
  RIGHT_CLICK = 'RIGHT_CLICK',
  DOUBLE_CLICK = 'DOUBLE_CLICK',
  DRAG_TO = 'DRAG_TO',
  SCROLL = 'SCROLL',
  
  // 键盘操作
  TYPING = 'TYPING',
  PRESS = 'PRESS',
  KEY_DOWN = 'KEY_DOWN',
  KEY_UP = 'KEY_UP',
  HOTKEY = 'HOTKEY',
  
  // 控制操作
  WAIT = 'WAIT',
  FAIL = 'FAIL',
  DONE = 'DONE',
  
  // 扩展操作
  SCREENSHOT = 'SCREENSHOT',
  LOCATE_IMAGE = 'LOCATE_IMAGE',
  GET_MOUSE_POSITION = 'GET_MOUSE_POSITION',
}

/** 操作参数 */
export interface ActionParameters {
  // 鼠标
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  num_clicks?: number;
  dx?: number;
  dy?: number;
  
  // 键盘
  text?: string;
  key?: string;
  keys?: string[];
  
  // 截图
  region?: { x: number; y: number; width: number; height: number };
  format?: 'png' | 'webp' | 'jpeg';
  confidence?: number;
  
  // 其他
  duration?: number;
}

/** 标准化操作 */
export interface Action {
  action_type: ActionType;
  parameters: ActionParameters;
}

/** 操作结果 */
export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// ==================== Pi-Agent 架构类型 ====================

/** 工具定义 */
export interface Tool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    callId: string,
    params: ActionParameters,
    signal?: AbortSignal,
    onUpdate?: (update: ProgressUpdate) => void
  ) => Promise<ToolResult>;
}

/** 工具执行结果 */
export interface ToolResult {
  content: ContentPart[];
  details?: Record<string, unknown>;
}

/** 内容部分 */
export type ContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

/** 进度更新 */
export interface ProgressUpdate {
  progress?: number;
  status?: string;
  data?: unknown;
}

/** 操作结果（Python 返回） */
export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// ==================== Hook 系统 ====================

/** Hook 上下文 */
export interface HookContext {
  toolName: string;
  params: ActionParameters;
  result?: ToolResult;
  error?: Error;
  callId: string;
  timestamp: number;
}

/** Hook 返回值 */
export interface HookResult {
  block?: boolean;
  reason?: string;
  modified?: ActionParameters;
  result?: ToolResult;
}

/** beforeToolCall Hook */
export type BeforeToolCallHook = (
  context: HookContext
) => Promise<HookResult | void>;

/** afterToolCall Hook */
export type AfterToolCallHook = (
  context: HookContext
) => Promise<HookResult | void>;

// ==================== 事件系统 ====================

/** 事件类型 */
export enum EventType {
  AGENT_START = 'agent_start',
  AGENT_END = 'agent_end',
  TOOL_START = 'tool_start',
  TOOL_UPDATE = 'tool_update',
  TOOL_END = 'tool_end',
  TOOL_ERROR = 'tool_error',
}

/** Agent 事件 */
export interface AgentEvent {
  type: EventType;
  timestamp: number;
  data: {
    toolName?: string;
    params?: ActionParameters;
    result?: ToolResult;
    error?: string;
    progress?: number;
    [key: string]: unknown;
  };
}

/** 事件监听器 */
export type EventListener = (event: AgentEvent) => void;

// ==================== Agent 配置 ====================

/** GUI Agent 配置 */
export interface GUIAgentConfig {
  /** 注册的工具 */
  tools: Tool[];
  
  /** beforeToolCall Hook */
  beforeToolCall?: BeforeToolCallHook;
  
  /** afterToolCall Hook */
  afterToolCall?: AfterToolCallHook;
  
  /** 事件监听器 */
  onEvent?: EventListener;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 最大重试次数 */
  maxRetries?: number;
  
  /** Python 桥接配置 */
  pythonBridge?: {
    enabled: boolean;
    command?: string;
    args?: string[];
  };
}

// ==================== JSON-RPC 桥接 ====================

/** JSON-RPC 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Python 桥接方法 */
export type PythonBridgeMethod = 
  | 'execute_action'
  | 'screenshot'
  | 'locate_image'
  | 'get_mouse_position'
  | 'start_recording'
  | 'stop_recording'
  | 'play_recording';
