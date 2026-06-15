/**
 * Computer API 共享类型（对齐 rcoder /computer/* API）
 *
 * 这些类型在主进程（unifiedAgent、computerServer、main）和渲染端（electron.d.ts）共用，
 * 集中定义在此文件中避免重复和漂移。
 */

// 对应 rcoder HttpResult<T> 响应包装
export interface HttpResult<T = unknown> {
  code: string; // "0000" = 成功，其他为错误码
  message: string; // 状态描述
  data: T | null; // 实际数据
  tid: string | null; // trace ID（Electron 端始终为 null）
  success: boolean; // code === "0000"
}

// 对应 rcoder ChatContextServerConfig（MCP 服务器配置）
export interface ChatContextServerConfig {
  source?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** tool_approval_rules 中的 action 取值 */
export type ToolApprovalAction = "ask" | "allow" | "deny";

/**
 * 单条工具审批规则。
 * - patterns: glob 通配符列表，任一命中即触发（大小写不敏感）
 * - action: ask=要求审批 / allow=自动放行 / deny=直接拒绝
 * - tool_kind: ACP ToolKind 过滤（默认 "Execute"）
 */
export interface ToolApprovalRule {
  patterns: string[];
  action: ToolApprovalAction;
  tool_kind?: string;
}

/** 平台下载信息（platforms map 的值） */
export interface PlatformEntry {
  url: string;
  sha256?: string;
  size?: number;
}

/** 自动重载配置 */
export interface AutoReloadConfig {
  enabled?: boolean;
  stability_check_ms?: number;
  stability_retries?: number;
  force?: boolean;
}

// 对应 rcoder ChatAgentConfig
export interface ChatAgentConfig {
  agent_server?: {
    agent_id?: string;
    agent_mode?: "ask" | "yolo";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    metadata?: Record<string, string>;
    /** 工具审批策略规则，按数组顺序匹配，首条命中生效 */
    tool_approval_rules?: ToolApprovalRule[];
    /** Agent 版本号 (semver 格式，如 "1.2.0") */
    version?: string;
    /** 多平台下载地址，key 为 {os}-{arch} 格式（如 "linux-x86_64"） */
    platforms?: Record<string, PlatformEntry>;
  };
  context_servers?: Record<string, ChatContextServerConfig>;
  /** 自动重载配置（DevComputer 调试场景） */
  auto_reload?: AutoReloadConfig;
  // 注意：resource_limits 仅 rcoder (Docker) 使用，electron client 运行在宿主机，不需要
}

// 对应 rcoder ModelProviderConfig
export interface ModelProviderConfig {
  /** 提供商名称 (如: anthropic, openai, qwen 等) */
  provider: string;
  /** API 密钥 */
  api_key?: string;
  /** API 基础 URL */
  base_url?: string;
  /** 默认模型名称 */
  model?: string;
  /** 默认模型名称 (别名) */
  default_model?: string;
  /** 模型接口协议类型 (anthropic/openai)，默认为 openai */
  api_protocol?: string;
  /** 模型配置 ID */
  id?: string;
  /** 模型配置名称 */
  name?: string;
  /** 是否需要 OpenAI 认证 */
  requires_openai_auth?: boolean;
}

// 对应 rcoder ComputerChatRequest
export interface ComputerChatRequest {
  user_id: string;
  project_id?: string;
  prompt: string;
  session_id?: string;
  model_provider?: ModelProviderConfig;
  request_id?: string;
  system_prompt?: string;
  user_prompt?: string;
  agent_config?: ChatAgentConfig;
  attachments?: unknown[];
  data_source_attachments?: string[];
  // 注意：pod_id, tenant_id, space_id, isolation_type 仅 rcoder (Docker) 使用，electron client 不需要
  // 记忆相关字段
  original_user_prompt?: string; // 原始用户提示词（纯净用户输入，不含系统提示）
  open_long_memory?: boolean; // 是否开启长期记忆（默认 false）
}

// 对应 rcoder ChatResponse（HttpResult.data 的内容，不含 success）
export interface ComputerChatResponse {
  project_id: string;
  session_id: string;
  error?: string | null;
  request_id?: string;
  is_new_session?: boolean;
  need_fallback?: boolean | null;
  fallback_reason?: string | null;
  /** Agent 版本号 */
  agent_version?: string | null;
  /** 是否触发了 agent 二进制热重载（DevComputer 调试模式） */
  reloaded?: boolean | null;
}

// 对应 rcoder UnifiedSessionMessage（SSE 进度事件）
// 字段名使用 camelCase 对齐 rcoder #[serde(rename_all = "camelCase")]
export interface UnifiedSessionMessage {
  sessionId: string;
  acpSessionId?: string; // ACP protocol session ID (UUID), used for SSE push
  messageType:
    | "sessionPromptStart"
    | "sessionPromptEnd"
    | "agentSessionUpdate"
    | "heartbeat"
    | "acpRequestPermission";
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

// GUI Agent 视觉模型配置
export interface GuiVisionModelConfig {
  /** 视觉模型提供商 (anthropic, openai, google, zhipu, qwen, deepseek, minimax, 或自定义) */
  provider: string;
  /** API 协议类型: anthropic (x-api-key + /v1/messages) 或 openai (Bearer + /chat/completions) */
  apiProtocol: "anthropic" | "openai";
  /** 视觉模型名称 (预设模型或自定义模型 ID) */
  model: string;
  /** API Key (可选，未设置时使用全局 API Key) */
  apiKey?: string;
  /** API 基础 URL (可选，自定义提供商必填) */
  baseUrl?: string;
  /** 目标显示器索引 */
  displayIndex: number;
  /** 坐标模式 (auto=根据模型自动匹配, image-absolute, normalized-1000, normalized-999, normalized-0-1) */
  coordinateMode: string;
  /** 记忆模型提供商 (可选，默认同 provider) */
  memoryProvider?: string;
  /** 记忆模型名称 (可选，默认同 model) */
  memoryModel?: string;
  /** 每步延迟 (ms) */
  stepDelayMs?: number;
  /** 最大步数 */
  maxSteps?: number;
  /** JPEG 质量 */
  jpegQuality?: number;
}

// GUI Agent 显示器信息
export interface GuiDisplayInfo {
  index: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

// =============================================================================
// Agent 安装管理类型（对齐 rcoder /agent-mgmt/* API）
// =============================================================================

/** 安装操作类型 */
export type InstallAction = "installed" | "updated" | "skipped";

/** Agent 安装状态 */
export type AgentInstallStatus =
  | "available"
  | "broken"
  | "not_installed"
  | "unknown";

/** Agent 安装类型 */
export type AgentInstallType = "builtin" | "binary" | "npm" | "url" | "unknown";

/** /agent-mgmt/agents/install-from-url 请求 */
export interface InstallFromUrlRequest {
  project_id?: string;
  user_id?: string;
  // 注意：pod_id, tenant_id, space_id, isolation_type 仅 rcoder (Docker) 使用，electron client 不需要
  agent: {
    agent_id: string;
    command: string;
    args?: string[];
    version?: string;
  };
  platforms: Record<string, PlatformEntry>;
  force?: boolean;
}

/** /agent-mgmt/agents/install-from-url 响应（所有安装端点通用） */
export interface InstallAgentResponse {
  agent_id: string;
  status: AgentInstallStatus;
  binary_path: string;
  file_type: string;
  file_size: number;
  file_count?: number;
  version?: string;
  source_url?: string;
  action?: InstallAction;
  installed: boolean;
  previous_version?: string;
  platform?: string;
}

/** /agent-mgmt/agents/list 请求 */
export interface ListAgentsRequest {
  project_id?: string;
  user_id?: string;
}

/** Agent 信息（列表响应中的单条记录） */
export interface AgentInfo {
  agent_id: string;
  install_type: AgentInstallType;
  status: AgentInstallStatus;
  version?: string;
  binary_path?: string;
  installed_at?: number;
}

/** /agent-mgmt/agents/list 响应 */
export interface ListAgentsResponse {
  system_info: { os: string; arch: string; platform: string };
  agents: AgentInfo[];
  total: number;
  install_dir: string;
}

/** /agent-mgmt/agents/check 请求 */
export interface CheckAgentRequest {
  project_id?: string;
  user_id?: string;
  agent_id: string;
  version?: string;
}

/** /agent-mgmt/agents/check 响应 */
export interface CheckAgentResponse {
  system_info: { os: string; arch: string; platform: string };
  agent: {
    agent_id: string;
    install_type: AgentInstallType;
    installed: boolean;
    status: AgentInstallStatus;
    version?: string;
    version_check_supported: boolean;
    static_checks: {
      file_exists: boolean;
      executable: boolean;
      in_path: boolean;
    };
  };
}

/** /agent-mgmt/agents/uninstall 请求 */
export interface UninstallAgentRequest {
  project_id?: string;
  user_id?: string;
  agent_id: string;
  version?: string;
}

/** /agent-mgmt/agents/uninstall 响应 */
export interface UninstallAgentResponse {
  agent_id: string;
  uninstalled: boolean;
  install_type: AgentInstallType;
  removed_versions: string[];
}
