/**
 * 共享引擎类型定义
 *
 * 从 unifiedAgent.ts 提取，避免 acp/、engineWarmup.ts、agentHelpers.ts
 * 与 unifiedAgent.ts 之间的循环 import。
 * unifiedAgent.ts 会 re-export 本文件的全部类型，外部调用方 import 路径不变。
 */

export type AgentEngineType = "nuwaxcode" | "claude-code" | "codex-cli";

export interface AgentConfig {
  engine: AgentEngineType;
  /** Custom agent command (when engine type is unknown, use this as the binary command) */
  customEngineCommand?: string;
  /** Custom agent args (from agent_server.args, appended to spawn args) */
  customEngineArgs?: string[];
  /** agent_server.agent_id，用于自定义引擎在 ACP 握手前展示 */
  customAgentId?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  apiProtocol?: string; // 'anthropic' or 'openai' - API protocol to use
  workspaceDir: string;
  hostname?: string;
  port?: number;
  timeout?: number;
  engineBinaryPath?: string;
  env?: Record<string, string>;
  mcpServers?: Record<
    string,
    | { command: string; args: string[]; env?: Record<string, string> }
    | { url: string; type?: "http" | "sse" }
  >;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  systemPrompt?: string;
  purpose?: "engine";
  /** @internal Sandbox strictness mode injected by UnifiedAgentService for warmup compatibility check. */
  __sandboxMode?: string;
}

// ==================== Session Types ====================

export type AcpSessionStatus = "idle" | "pending" | "active" | "terminating";

export interface SdkSession {
  id: string;
  parentID?: string;
  title?: string;
  time?: { created: number; updated?: number };
  [key: string]: unknown;
}

export interface SessionStatus {
  [sessionId: string]: {
    status: string;
    [key: string]: unknown;
  };
}

// ==================== Message Types (replacing SDK types) ====================

export type MessageRole = "user" | "system" | "assistant";

export type PartType =
  | "text"
  | "reasoning"
  | "file"
  | "tool"
  | "step_start"
  | "step_finish"
  | "snapshot"
  | "patch";

export interface BasePart {
  type: PartType;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  thinking: string;
}

export interface FilePart extends BasePart {
  type: "file";
  uri?: string;
  mimeType?: string;
}

export interface ToolPart extends BasePart {
  type: "tool";
  toolCallId: string;
  name: string;
  kind?: string;
  status?: string;
  input?: string;
  output?: string;
  content?: string;
}

export interface StepStartPart extends BasePart {
  type: "step_start";
  stepId: string;
  title?: string;
}

export interface StepFinishPart extends BasePart {
  type: "step_finish";
  stepId: string;
  title?: string;
  result?: unknown;
}

export interface SnapshotPart extends BasePart {
  type: "snapshot";
  snapshotId: string;
}

export interface PatchPart extends BasePart {
  type: "patch";
  patchId: string;
  filePath?: string;
}

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart;

export interface BaseMessage {
  role: MessageRole;
  content: Part[];
}

export interface UserMessage extends BaseMessage {
  role: "user";
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant";
}

export type Message = UserMessage | AssistantMessage;

export interface TextPartInput {
  type: "text";
  text: string;
}

export interface FilePartInput {
  type: "file";
  uri?: string;
  mimeType?: string;
}

export interface FileDiff {
  filePath: string;
  oldContent?: string;
  newContent?: string;
  hunks?: unknown[];
}

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

// ==================== Prompt / Provider Types ====================

export interface PromptOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  noReply?: boolean;
  system?: string;
  tools?: Record<string, boolean>;
  messageID?: string;
  mcpInitPolicy?: "blocking" | "non_blocking";
  mcpInitTimeoutMs?: number;
}

export interface CommandOptions {
  agent?: string;
  model?: string;
  messageID?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ProviderInfo {
  id: string;
  name?: string;
  models?: Array<{ id: string; name?: string }>;
  [key: string]: unknown;
}
