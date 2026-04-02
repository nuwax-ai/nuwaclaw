/**
 * 共享引擎类型定义
 *
 * 从 unifiedAgent.ts 提取，避免 engineWarmup.ts ↔ unifiedAgent.ts 的循环 import。
 */

export type AgentEngineType = "nuwaxcode" | "claude-code";

export interface AgentConfig {
  engine: AgentEngineType;
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
}
