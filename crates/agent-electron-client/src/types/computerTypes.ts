/**
 * Computer API 共享类型（对齐 rcoder /computer/* API）
 *
 * 这些类型在主进程（unifiedAgent、computerServer、main）和渲染端（electron.d.ts）共用，
 * 集中定义在此文件中避免重复和漂移。
 */

// 对应 rcoder HttpResult<T> 响应包装
export interface HttpResult<T = unknown> {
  code: string;       // "0000" = 成功，其他为错误码
  message: string;    // 状态描述
  data: T | null;     // 实际数据
  tid: string | null; // trace ID（Electron 端始终为 null）
  success: boolean;   // code === "0000"
}

// 对应 rcoder ComputerChatRequest
export interface ComputerChatRequest {
  user_id: string;
  project_id?: string;
  prompt: string;
  session_id?: string;
  model_provider?: {
    provider: string;
    api_key?: string;
    base_url?: string;
    model?: string;
  };
  request_id?: string;
  system_prompt?: string;
  agent_config?: Record<string, unknown>;
}

// 对应 rcoder ChatResponse（HttpResult.data 的内容，不含 success）
export interface ComputerChatResponse {
  project_id: string;
  session_id: string;
  error?: string | null;
  request_id?: string;
  need_fallback?: boolean | null;
  fallback_reason?: string | null;
}

// 对应 rcoder UnifiedSessionMessage（SSE 进度事件）
// 字段名使用 camelCase 对齐 rcoder #[serde(rename_all = "camelCase")]
export interface UnifiedSessionMessage {
  sessionId: string;
  messageType: 'sessionPromptStart' | 'sessionPromptEnd' | 'agentSessionUpdate' | 'heartbeat';
  subType: string;
  data: unknown;
  timestamp: string;
}

// 对应 rcoder ComputerAgentStatusResponse
export interface ComputerAgentStatusResponse {
  user_id: string;
  project_id: string;
  is_alive: boolean;
  session_id?: string | null;
  status?: string | null;
  last_activity?: string | null;
  created_at?: string | null;
}

// 对应 rcoder ComputerAgentStopResponse
export interface ComputerAgentStopResponse {
  success: boolean;
  message: string;
  user_id: string;
  project_id: string;
}

// 对应 rcoder ComputerAgentCancelResponse
export interface ComputerAgentCancelResponse {
  success: boolean;
  session_id: string;
}
