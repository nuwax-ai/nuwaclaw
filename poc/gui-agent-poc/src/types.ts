/**
 * NuwaClaw GUI Agent - PoC 核心类型定义
 * 借鉴 Pi-Agent 的类型设计
 */

import type { Static, TSchema } from '@sinclair/typebox';

// ========== 工具结果 ==========

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export type Content = TextContent | ImageContent;

export interface ToolResult<TDetails = any> {
  content: Content[];
  details: TDetails;
  isError?: boolean;
}

// ========== 工具定义 ==========

export type ToolUpdateCallback<TDetails = any> = (partialResult: Partial<ToolResult<TDetails>>) => void;

export interface Tool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  execute: (
    callId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback<TDetails>,
  ) => Promise<ToolResult<TDetails>>;
}

// ========== Agent 事件 ==========

export type AgentEvent =
  // Agent 生命周期
  | { type: 'agent_start' }
  | { type: 'agent_end'; success: boolean; error?: string }
  // Turn 生命周期
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  // Message 生命周期
  | { type: 'message_start'; role: 'user' | 'assistant'; content: string }
  | { type: 'message_end'; role: 'user' | 'assistant'; content: string }
  // Tool 生命周期
  | { type: 'tool_execution_start'; toolName: string; callId: string; params: any }
  | { type: 'tool_execution_update'; toolName: string; callId: string; partialResult: any }
  | { type: 'tool_execution_end'; toolName: string; callId: string; result: ToolResult; isError: boolean };

// ========== Hook 系统 ==========

export interface BeforeToolCallContext {
  toolName: string;
  callId: string;
  params: any;
}

export interface AfterToolCallContext {
  toolName: string;
  callId: string;
  params: any;
  result: ToolResult;
  isError: boolean;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: Content[];
  details?: any;
  isError?: boolean;
}

export type BeforeToolCallHook = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

export type AfterToolCallHook = (
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined>;

// ========== Agent 配置 ==========

export interface AgentConfig {
  tools: Tool<any, any>[];
  beforeToolCall?: BeforeToolCallHook;
  afterToolCall?: AfterToolCallHook;
  onEvent?: (event: AgentEvent) => void;
}
