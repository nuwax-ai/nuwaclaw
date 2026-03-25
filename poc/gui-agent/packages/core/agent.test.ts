import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GUIAgent, createGUIAgent, ActionType } from './agent';
import type { Tool, GUIAgentConfig, HookContext, AgentEvent, EventType } from './types';

// Mock tool for testing
const mockTool: Tool = {
  name: 'mock_tool',
  label: 'Mock Tool',
  description: 'A mock tool for testing',
  parameters: { type: 'object' },
  execute: vi.fn(async (callId, params, signal, onUpdate) => {
    onUpdate?.({ progress: 50, status: 'executing' });
    await new Promise((r) => setTimeout(r, 10));
    return {
      content: [{ type: 'text', text: `Mock result: ${JSON.stringify(params)}` }],
    };
  }),
};

const failingTool: Tool = {
  name: 'failing_tool',
  label: 'Failing Tool',
  description: 'A tool that always fails',
  parameters: { type: 'object' },
  execute: async () => {
    throw new Error('Tool execution failed');
  },
};

describe('GUIAgent', () => {
  let agent: GUIAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new GUIAgent({ tools: [mockTool, failingTool] });
  });

  afterEach(() => {
    agent.abort();
  });

  describe('constructor', () => {
    it('should register tools from config', () => {
      expect(agent.getTools()).toHaveLength(2);
      expect(agent.getTool('mock_tool')).toBeDefined();
      expect(agent.getTool('failing_tool')).toBeDefined();
    });

    it('should register event listener from config', () => {
      const onEvent = vi.fn();
      const a = new GUIAgent({ tools: [mockTool], onEvent });
      expect((a as any).eventListeners).toHaveLength(1);
    });
  });

  describe('registerTool', () => {
    it('should add new tool', () => {
      const newTool: Tool = {
        name: 'new_tool',
        label: 'New Tool',
        description: 'New tool',
        parameters: { type: 'object' },
        execute: async () => ({ content: [] }),
      };
      agent.registerTool(newTool);
      expect(agent.getTool('new_tool')).toBeDefined();
    });

    it('should replace existing tool with same name', () => {
      const replacement: Tool = {
        name: 'mock_tool',
        label: 'Replaced',
        description: 'Replaced tool',
        parameters: { type: 'object' },
        execute: async () => ({ content: [{ type: 'text', text: 'replaced' }] }),
      };
      agent.registerTool(replacement);
      expect(agent.getTool('mock_tool')?.label).toBe('Replaced');
    });
  });

  describe('executeTool', () => {
    it('should execute tool and return result', async () => {
      const result = await agent.executeTool('mock_tool', { foo: 'bar' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty('text');
    });

    it('should throw if tool not found', async () => {
      await expect(agent.executeTool('nonexistent', {})).rejects.toThrow('Tool not found');
    });

    it('should call progress callback', async () => {
      const onUpdate = vi.fn();
      await agent.executeTool('mock_tool', {}, onUpdate);
      expect(onUpdate).toHaveBeenCalledWith({ progress: 50, status: 'executing' });
    });

    it('should throw on tool error', async () => {
      await expect(agent.executeTool('failing_tool', {})).rejects.toThrow('Tool execution failed');
    });
  });

  describe('hooks', () => {
    it('should call beforeToolCall hook', async () => {
      const hook = vi.fn(async () => {});
      const a = new GUIAgent({
        tools: [mockTool],
        beforeToolCall: hook,
      });
      
      await a.executeTool('mock_tool', { test: 1 });
      
      expect(hook).toHaveBeenCalled();
      const ctx = hook.mock.calls[0][0] as HookContext;
      expect(ctx.toolName).toBe('mock_tool');
      expect(ctx.params).toEqual({ test: 1 });
    });

    it('should block execution when hook returns block: true', async () => {
      const hook = vi.fn(async () => ({ block: true, reason: 'Blocked for testing' }));
      const a = new GUIAgent({
        tools: [mockTool],
        beforeToolCall: hook,
      });
      
      await expect(a.executeTool('mock_tool', {})).rejects.toThrow('Blocked for testing');
    });

    it('should modify params when hook returns modified', async () => {
      const hook = vi.fn(async (ctx: HookContext) => ({
        modified: { ...ctx.params, modified: true },
      }));
      const a = new GUIAgent({
        tools: [mockTool],
        beforeToolCall: hook,
      });
      
      await a.executeTool('mock_tool', { original: true });
      
      expect(mockTool.execute).toHaveBeenCalledWith(
        expect.any(String),
        { original: true, modified: true },
        expect.any(AbortSignal),
        expect.any(Function)
      );
    });

    it('should call afterToolCall hook with result', async () => {
      const hook = vi.fn(async () => {});
      const a = new GUIAgent({
        tools: [mockTool],
        afterToolCall: hook,
      });
      
      await a.executeTool('mock_tool', {});
      
      expect(hook).toHaveBeenCalled();
      const ctx = hook.mock.calls[0][0] as HookContext;
      expect(ctx.result).toBeDefined();
    });
  });

  describe('events', () => {
    it('should emit tool_start event', async () => {
      const listener = vi.fn();
      agent.addEventListener(listener);
      
      await agent.executeTool('mock_tool', {});
      
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool_start' })
      );
    });

    it('should emit tool_end event', async () => {
      const listener = vi.fn();
      agent.addEventListener(listener);
      
      await agent.executeTool('mock_tool', {});
      
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool_end' })
      );
    });

    it('should emit tool_error event on failure', async () => {
      const listener = vi.fn();
      agent.addEventListener(listener);
      
      try {
        await agent.executeTool('failing_tool', {});
      } catch {}
      
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool_error' })
      );
    });

    it('should remove event listener', async () => {
      const listener = vi.fn();
      agent.addEventListener(listener);
      agent.removeEventListener(listener);
      
      await agent.executeTool('mock_tool', {});
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('execute (batch)', () => {
    it('should execute multiple actions in sequence', async () => {
      const results = await agent.execute([
        { tool: 'mock_tool', params: { a: 1 } },
        { tool: 'mock_tool', params: { b: 2 } },
      ]);
      
      expect(results).toHaveLength(2);
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });

    it('should emit agent_start and agent_end events', async () => {
      const listener = vi.fn();
      agent.addEventListener(listener);
      
      await agent.execute([{ tool: 'mock_tool', params: {} }]);
      
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent_start' })
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent_end' })
      );
    });
  });

  describe('abort', () => {
    it('should abort ongoing execution', async () => {
      const slowTool: Tool = {
        name: 'slow_tool',
        label: 'Slow',
        description: 'Slow tool',
        parameters: { type: 'object' },
        execute: async (callId, params, signal, onUpdate) => {
          await new Promise((r) => setTimeout(r, 1000));
          return { content: [] };
        },
      };
      
      const a = new GUIAgent({ tools: [slowTool] });
      
      const promise = a.executeTool('slow_tool', {});
      a.abort();
      
      // Should not hang
      await expect(promise).resolves.toBeDefined();
    });
  });
});

describe('createGUIAgent', () => {
  it('should create agent with default OSWorld tools', () => {
    const agent = createGUIAgent();
    const tools = agent.getTools();
    
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.find(t => t.name === 'screenshot')).toBeDefined();
    expect(tools.find(t => t.name === 'click')).toBeDefined();
    expect(tools.find(t => t.name === 'type_text')).toBeDefined();
  });

  it('should merge custom config', () => {
    const onEvent = vi.fn();
    const agent = createGUIAgent({ onEvent });
    
    expect((agent as any).eventListeners).toHaveLength(1);
  });
});

describe('ActionType', () => {
  it('should have all OSWorld action types', () => {
    expect(ActionType.CLICK).toBe('CLICK');
    expect(ActionType.TYPING).toBe('TYPING');
    expect(ActionType.HOTKEY).toBe('HOTKEY');
    expect(ActionType.MOVE_TO).toBe('MOVE_TO');
    expect(ActionType.DRAG_TO).toBe('DRAG_TO');
    expect(ActionType.SCROLL).toBe('SCROLL');
  });
});
