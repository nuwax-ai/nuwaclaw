/**
 * chat() 的长期记忆步骤（从 AcpEngine.chat 提取）：
 * - recordUserMessageToMemory：把纯净用户输入写入 MemoryService
 * - buildMemoryEnhancedPrompt：检索记忆上下文并包装进 prompt
 *
 * 两者都对 memoryService 未初始化 / 记忆关闭 / 空输入做静默降级，
 * 失败仅记日志、不阻断 chat 主流程。
 */

import log from "electron-log";
import { memoryService } from "../../memory";
import type { ModelProviderConfig } from "@shared/types/computerTypes";
import type { AgentConfig, AgentEngineType } from "../types";
import { buildModelConfig } from "../utils/buildModelConfig";

export interface RecordUserMessageArgs {
  sessionId: string;
  requestId?: string;
  /** 纯净用户输入（仅 original_user_prompt，不回退到 prompt） */
  pureUserPrompt: string;
  enableMemory: boolean;
  modelProvider?: ModelProviderConfig;
  engineName: AgentEngineType;
  config: AgentConfig;
  logTag: string;
}

export function recordUserMessageToMemory(args: RecordUserMessageArgs): void {
  const {
    sessionId,
    requestId,
    pureUserPrompt,
    enableMemory,
    modelProvider,
    engineName,
    config,
    logTag,
  } = args;

  // 如果 original_user_prompt 为空，打印错误日志
  if (!pureUserPrompt) {
    log.error(
      `${logTag} original_user_prompt is empty; skipping memory handling`,
      {
        session_id: sessionId,
        request_id: requestId,
      },
    );
  }

  if (!memoryService.isInitialized() || !enableMemory || !pureUserPrompt) {
    return;
  }

  try {
    const modelConfig = {
      ...buildModelConfig(engineName, config),
      model: modelProvider?.default_model || config.model || "",
      apiProtocol: modelProvider?.api_protocol || config.apiProtocol,
    };
    memoryService.handleMessage(
      sessionId,
      { role: "user", content: pureUserPrompt },
      modelConfig,
    );
  } catch (error) {
    log.warn(`${logTag} Failed to record user message to memory:`, error);
  }
}

export interface BuildMemoryEnhancedPromptArgs {
  /** 发送给引擎的完整 prompt（可能已含服务端模板） */
  prompt: string;
  /** 纯净用户输入，用作记忆检索 query */
  pureUserPrompt: string;
  enableMemory: boolean;
  logTag: string;
}

/** 检索记忆上下文；命中则返回包装后的 prompt，否则原样返回 */
export async function buildMemoryEnhancedPrompt(
  args: BuildMemoryEnhancedPromptArgs,
): Promise<string> {
  const { prompt, pureUserPrompt, enableMemory, logTag } = args;

  if (!memoryService.isInitialized() || !enableMemory || !pureUserPrompt) {
    return prompt;
  }

  try {
    // 使用纯净用户输入进行记忆搜索
    const promptForMemory = pureUserPrompt.trim();
    log.debug(
      `${logTag} Memory search query: "${promptForMemory.slice(0, 100)}"`,
    );

    const memoryContext =
      await memoryService.getInjectionContext(promptForMemory);
    if (memoryContext && memoryContext.trim()) {
      log.info(
        `${logTag} Injected memory context (${memoryContext.length} chars)`,
      );
      return `<memory-context>
Known information about the user (use as reference when answering):
${memoryContext}
</memory-context>

User question: ${prompt}`;
    }
  } catch (error) {
    log.warn(`${logTag} Failed to inject memory context:`, error);
  }
  return prompt;
}
