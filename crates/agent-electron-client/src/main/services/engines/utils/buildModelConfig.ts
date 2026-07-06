/**
 * ModelConfig 共享 builder
 *
 * 统一从引擎名称 + 配置对象构建 ModelConfig，消除 6 处 copy-paste。
 * 新增引擎类型（如 codex-cli）只需改此一处。
 */

import type { ModelConfig } from "../../memory/types";
import type { AgentConfig, AgentEngineType } from "../types";

/**
 * 从引擎名称推断 provider：
 * - claude-code → "anthropic"
 * - 其他（nuwaxcode / codex-cli 等）→ "openai"
 */
export function inferProvider(engineName: string): "anthropic" | "openai" {
  return engineName.includes("claude") ? "anthropic" : "openai";
}

/** 从引擎名称 + AgentConfig 构建 MemoryService 所需的 ModelConfig */
export function buildModelConfig(
  engineName: string,
  config: Pick<AgentConfig, "model" | "apiKey" | "baseUrl" | "apiProtocol">,
): ModelConfig {
  return {
    provider: inferProvider(engineName),
    model: config.model || "",
    apiKey: config.apiKey || "",
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol,
  };
}
