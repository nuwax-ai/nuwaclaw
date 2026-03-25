/**
 * NuwaClaw GUI Agent - Core Agent
 * 
 * 整合 Pi-Agent 架构（Hook + 事件流）和 OSWorld 标准操作
 */

import {
  GUIAgentConfig,
  Tool,
  Action,
  ActionType,
  ActionParameters,
  ToolResult,
  HookContext,
  EventType,
  AgentEvent,
  EventListener,
  ProgressUpdate,
  BeforeToolCallHook,
  AfterToolCallHook,
} from './types';

// Re-export types
export { ActionType };
export type { 
  Action, 
  ActionParameters, 
  ActionResult,
  Tool,
  ToolResult,
  GUIAgentConfig,
  HookContext,
  AgentEvent,
  EventListener,
  EventType,
  ProgressUpdate,
  BeforeToolCallHook,
  AfterToolCallHook,
};

/**
 * GUI Agent - 统一实现
 * 
 * 特性：
 * - Hook 系统：beforeToolCall / afterToolCall
 * - 事件流：agent_start → tool_start → tool_end → agent_end
 * - 流式进度：onUpdate 回调
 * - Python 桥接：调用 OSWorld 标准工具
 */
export class GUIAgent {
  private tools: Map<string, Tool> = new Map();
  private config: GUIAgentConfig;
  private abortController: AbortController | null = null;
  private eventListeners: EventListener[] = [];

  constructor(config: GUIAgentConfig) {
    this.config = config;
    
    // 注册工具
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }
    
    // 注册事件监听器
    if (config.onEvent) {
      this.eventListeners.push(config.onEvent);
    }
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: EventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * 发射事件
   */
  private emit(type: EventType, data: AgentEvent['data']): void {
    const event: AgentEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[GUIAgent] Event listener error:', err);
      }
    }
  }

  /**
   * 执行单个工具
   */
  async executeTool(
    name: string,
    params: ActionParameters,
    onUpdate?: (update: ProgressUpdate) => void
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const callId = `${name}-${Date.now()}`;
    this.abortController = new AbortController();
    
    // 构建上下文
    const context: HookContext = {
      toolName: name,
      params,
      callId,
      timestamp: Date.now(),
    };

    try {
      // 发射 tool_start 事件
      this.emit(EventType.TOOL_START, { toolName: name, params });

      // beforeToolCall Hook
      if (this.config.beforeToolCall) {
        const hookResult = await this.config.beforeToolCall(context);
        if (hookResult?.block) {
          throw new Error(hookResult.reason || 'Blocked by beforeToolCall hook');
        }
        if (hookResult?.modified) {
          context.params = hookResult.modified;
        }
      }

      // 执行工具（带进度回调）
      const result = await tool.execute(
        callId,
        context.params,
        this.abortController.signal,
        (update) => {
          this.emit(EventType.TOOL_UPDATE, { 
            toolName: name, 
            progress: update.progress,
            status: update.status,
          });
          onUpdate?.(update);
        }
      );

      context.result = result;

      // afterToolCall Hook
      if (this.config.afterToolCall) {
        const hookResult = await this.config.afterToolCall(context);
        if (hookResult?.result) {
          context.result = hookResult.result;
        }
      }

      // 发射 tool_end 事件
      this.emit(EventType.TOOL_END, { 
        toolName: name, 
        params, 
        result: context.result 
      });

      return context.result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      context.error = err;
      
      // 发射 tool_error 事件
      this.emit(EventType.TOOL_ERROR, { 
        toolName: name, 
        error: err.message 
      });
      
      throw err;
    }
  }

  /**
   * 批量执行操作
   */
  async execute(
    actions: Array<{ tool: string; params: ActionParameters }>
  ): Promise<ToolResult[]> {
    this.emit(EventType.AGENT_START, { 
      data: { actionCount: actions.length } 
    });

    const results: ToolResult[] = [];

    try {
      for (const action of actions) {
        if (this.abortController?.signal.aborted) {
          break;
        }
        const result = await this.executeTool(action.tool, action.params);
        results.push(result);
      }

      this.emit(EventType.AGENT_END, { 
        data: { results } 
      });

      return results;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit(EventType.AGENT_END, { 
        error: err.message 
      });
      throw err;
    }
  }

  /**
   * 取消执行
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 注册工具
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取所有工具
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}

/**
 * 创建 OSWorld 标准工具
 */
export function createOSWorldTools(): Tool[] {
  return [
    {
      name: 'screenshot',
      label: '📸 截取屏幕',
      description: '截取屏幕或指定区域，返回 base64 图片',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'object' },
          format: { type: 'string', enum: ['png', 'webp', 'jpeg'] },
        },
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 50, status: 'capturing' });
        // TODO: 调用 Python 桥接
        return {
          content: [{ type: 'text', text: '[screenshot result]' }],
        };
      },
    },
    {
      name: 'click',
      label: '🖱️ 点击',
      description: '点击屏幕指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          button: { type: 'string', enum: ['left', 'right', 'middle'] },
          num_clicks: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 50, status: 'clicking' });
        // TODO: 调用 Python 桥接
        return {
          content: [{ type: 'text', text: `[click at (${params.x}, ${params.y})]` }],
        };
      },
    },
    {
      name: 'type_text',
      label: '⌨️ 输入文本',
      description: '输入文本到当前位置',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 50, status: 'typing' });
        // TODO: 调用 Python 桥接
        return {
          content: [{ type: 'text', text: `[typed: ${params.text}]` }],
        };
      },
    },
    {
      name: 'hotkey',
      label: '🎹 快捷键',
      description: '按下快捷键组合',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' } },
        },
        required: ['keys'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 50, status: 'pressing hotkey' });
        // TODO: 调用 Python 桥接
        return {
          content: [{ type: 'text', text: `[hotkey: ${params.keys?.join('+')}]` }],
        };
      },
    },
    {
      name: 'locate_image',
      label: '🔍 定位图像',
      description: '在屏幕上定位指定图像',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['image'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 50, status: 'locating' });
        // TODO: 调用 Python 桥接
        return {
          content: [{ type: 'text', text: '[locate_image result]' }],
        };
      },
    },
  ];
}

/**
 * 快速创建 GUI Agent
 */
export function createGUIAgent(config?: Partial<GUIAgentConfig>): GUIAgent {
  return new GUIAgent({
    tools: createOSWorldTools(),
    ...config,
  });
}
