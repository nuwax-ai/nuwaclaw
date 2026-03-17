/**
 * NuwaClaw GUI Agent - PoC 运行时
 * 借鉴 Pi-Agent 的核心设计
 */

import type {
  Tool,
  AgentEvent,
  AgentConfig,
  ToolResult,
  BeforeToolCallContext,
  AfterToolCallContext,
} from './types.js';

/**
 * 生成唯一 ID
 */
function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Agent 状态
 */
export interface AgentState {
  isRunning: boolean;
  currentTool: string | null;
  error: string | null;
  executedActions: number;
}

/**
 * NuwaClaw GUI Agent - PoC 版本
 */
export class GUIAgent {
  private tools: Map<string, Tool<any, any>>;
  private state: AgentState;
  private abortController?: AbortController;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.tools = new Map();
    this.state = {
      isRunning: false,
      currentTool: null,
      error: null,
      executedActions: 0,
    };

    // 注册工具
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * 发送事件
   */
  private emit(event: AgentEvent): void {
    this.config.onEvent?.(event);
  }

  /**
   * 执行单个工具
   */
  async executeTool(toolName: string, params: any): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `工具 ${toolName} 不存在` }],
        details: {},
        isError: true,
      };
    }

    const callId = generateCallId();
    const signal = this.abortController?.signal;

    try {
      this.state.currentTool = toolName;
      this.emit({ type: 'tool_execution_start', toolName, callId, params });

      // 1. beforeToolCall Hook
      if (this.config.beforeToolCall) {
        const context: BeforeToolCallContext = { toolName, callId, params };
        const beforeResult = await this.config.beforeToolCall(context, signal);

        if (beforeResult?.block) {
          const result: ToolResult = {
            content: [{ type: 'text', text: beforeResult.reason || '操作被阻止' }],
            details: {},
            isError: true,
          };
          this.emit({ type: 'tool_execution_end', toolName, callId, result, isError: true });
          this.state.currentTool = null;
          return result;
        }
      }

      // 2. 执行工具
      const result = await tool.execute(callId, params, signal, (partialResult) => {
        this.emit({ type: 'tool_execution_update', toolName, callId, partialResult });
      });

      // 3. afterToolCall Hook
      if (this.config.afterToolCall) {
        const context: AfterToolCallContext = {
          toolName,
          callId,
          params,
          result,
          isError: result.isError || false,
        };
        const afterResult = await this.config.afterToolCall(context, signal);

        if (afterResult) {
          // 应用覆盖
          if (afterResult.content) result.content = afterResult.content;
          if (afterResult.details) result.details = afterResult.details;
          if (afterResult.isError !== undefined) result.isError = afterResult.isError;
        }
      }

      this.emit({
        type: 'tool_execution_end',
        toolName,
        callId,
        result,
        isError: result.isError || false,
      });

      this.state.executedActions++;
      this.state.currentTool = null;

      return result;
    } catch (error) {
      const result: ToolResult = {
        content: [{ type: 'text', text: `执行失败: ${error instanceof Error ? error.message : String(error)}` }],
        details: {},
        isError: true,
      };

      this.emit({ type: 'tool_execution_end', toolName, callId, result, isError: true });
      this.state.currentTool = null;
      this.state.error = error instanceof Error ? error.message : String(error);

      return result;
    }
  }

  /**
   * 执行一系列操作（简单编排）
   */
  async execute(actions: Array<{ tool: string; params: any }>): Promise<ToolResult[]> {
    this.state.isRunning = true;
    this.state.error = null;
    this.abortController = new AbortController();

    this.emit({ type: 'agent_start' });

    const results: ToolResult[] = [];

    try {
      for (const action of actions) {
        if (this.abortController.signal.aborted) {
          throw new Error('Agent aborted');
        }

        const result = await this.executeTool(action.tool, action.params);
        results.push(result);

        if (result.isError) {
          console.warn(`工具 ${action.tool} 执行失败，继续...`);
        }
      }

      this.emit({ type: 'agent_end', success: true });
      return results;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'agent_end', success: false, error: this.state.error });
      return results;
    } finally {
      this.state.isRunning = false;
      this.abortController = undefined;
    }
  }

  /**
   * 取消执行
   */
  abort(): void {
    this.abortController?.abort();
    this.state.isRunning = false;
  }
}
