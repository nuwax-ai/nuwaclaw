/**
 * Tests for taskRunner — mock-based unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all desktop and external dependencies
vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"summary": "compressed memory"}' }],
  }),
  getModel: vi.fn().mockReturnValue({ provider: 'mock', model: 'mock' }),
}));

vi.mock('@mariozechner/pi-agent-core', () => {
  const subscribers: Array<(event: any) => void> = [];
  let aborted = false;

  return {
    Agent: vi.fn().mockImplementation((config: any) => ({
      state: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Task completed successfully' }],
            stopReason: 'end',
          },
        ],
      },
      subscribe: vi.fn((fn: any) => {
        subscribers.push(fn);
        return () => {};
      }),
      prompt: vi.fn(async () => {
        // Simulate one turn
        for (const sub of subscribers) {
          sub({
            type: 'turn_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
            toolResults: [{ toolName: 'computer_done', isError: false }],
          });
        }
      }),
      abort: vi.fn(() => { aborted = true; }),
      setSystemPrompt: vi.fn(),
    })),
  };
});

vi.mock('../../src/desktop/screenshot.js', () => ({
  captureScreenshot: vi.fn().mockResolvedValue({
    image: 'base64screenshot',
    mimeType: 'image/jpeg',
    imageWidth: 1920,
    imageHeight: 1080,
    logicalWidth: 1920,
    logicalHeight: 1080,
    physicalWidth: 1920,
    physicalHeight: 1080,
    scaleFactor: 1,
    displayIndex: 0,
  }),
}));

vi.mock('../../src/desktop/mouse.js', () => ({
  click: vi.fn(),
  doubleClick: vi.fn(),
  moveTo: vi.fn(),
  drag: vi.fn(),
  scroll: vi.fn(),
  getPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
}));

vi.mock('../../src/desktop/keyboard.js', () => ({
  typeText: vi.fn(),
  pressKey: vi.fn(),
  hotkey: vi.fn(),
}));

vi.mock('../../src/desktop/display.js', () => ({
  getDisplay: vi.fn().mockResolvedValue({
    index: 0,
    label: 'Main',
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    isPrimary: true,
    origin: { x: 0, y: 0 },
  }),
}));

vi.mock('../../src/coordinates/modelProfiles.js', () => ({
  getModelProfile: vi.fn().mockReturnValue({
    coordinateMode: 'image-absolute' as const,
    coordinateOrder: 'xy',
  }),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    raw: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(32 * 32 * 3)),
  }),
}));

import { createTaskRunner, createModel } from '../../src/agent/taskRunner.js';
import { AuditLog } from '../../src/safety/auditLog.js';
import type { GuiAgentConfig } from '../../src/config.js';

function createTestConfig(): GuiAgentConfig {
  return {
    provider: 'anthropic',
    apiProtocol: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: 'test-key',
    port: 60008,
    maxSteps: 50,
    stepDelayMs: 0,
    stuckThreshold: 3,
    jpegQuality: 75,
    displayIndex: 0,
    transport: 'http' as const,
    coordinateMode: 'image-absolute' as const,
  };
}

describe('createTaskRunner', () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLog = new AuditLog();
  });

  it('should return run and abort functions', () => {
    const runner = createTaskRunner(createTestConfig(), auditLog);
    expect(typeof runner.run).toBe('function');
    expect(typeof runner.abort).toBe('function');
  });

  it('should complete a task successfully', async () => {
    const runner = createTaskRunner(createTestConfig(), auditLog);
    const controller = new AbortController();
    const progressCalls: any[] = [];

    const result = await runner.run(
      'Open Finder',
      controller.signal,
      (info) => progressCalls.push(info),
    );

    expect(result.success).toBe(true);
    expect(result.finalScreenshot).toBe('base64screenshot');
    expect(result.steps.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle abort signal', async () => {
    const { Agent } = await import('@mariozechner/pi-agent-core');
    const mockAgent = (Agent as any).mockImplementation((config: any) => ({
      state: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'aborted' }],
            stopReason: 'aborted',
          },
        ],
      },
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn(async () => {}),
      abort: vi.fn(),
      setSystemPrompt: vi.fn(),
    }));

    const runner = createTaskRunner(createTestConfig(), auditLog);
    const controller = new AbortController();

    const result = await runner.run(
      'Open Finder',
      controller.signal,
      () => {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Task was aborted');
  });

  it('should handle errors in task execution', async () => {
    const { Agent } = await import('@mariozechner/pi-agent-core');
    (Agent as any).mockImplementation(() => ({
      state: { messages: [] },
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn(async () => { throw new Error('API connection failed'); }),
      abort: vi.fn(),
      setSystemPrompt: vi.fn(),
    }));

    const runner = createTaskRunner(createTestConfig(), auditLog);
    const controller = new AbortController();

    const result = await runner.run(
      'Open Finder',
      controller.signal,
      () => {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('API connection failed');
  });

  it('should enforce maxSteps', async () => {
    const { Agent } = await import('@mariozechner/pi-agent-core');
    let agentAborted = false;

    (Agent as any).mockImplementation((agentConfig: any) => {
      const subs: any[] = [];
      return {
        state: {
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'aborted' },
          ],
        },
        subscribe: vi.fn((fn: any) => { subs.push(fn); return () => {}; }),
        prompt: vi.fn(async () => {
          // Simulate maxSteps+1 turns to trigger abort
          for (let i = 0; i < 5; i++) {
            for (const sub of subs) {
              sub({
                type: 'turn_end',
                message: { role: 'assistant', content: [] },
                toolResults: [{ toolName: 'computer_screenshot', isError: false }],
              });
            }
          }
        }),
        abort: vi.fn(() => { agentAborted = true; }),
        setSystemPrompt: vi.fn(),
      };
    });

    const config = createTestConfig();
    config.maxSteps = 3;

    const runner = createTaskRunner(config, auditLog);
    const controller = new AbortController();

    const result = await runner.run('Open Finder', controller.signal, () => {});

    expect(agentAborted).toBe(true);
  });
});

describe('createModel', () => {
  it('uses getModel for built-in anthropic provider without baseUrl', () => {
    const model = createModel('anthropic', 'anthropic', 'claude-sonnet-4-20250514');
    // getModel is mocked to return { provider: 'mock', model: 'mock' }
    expect(model).toEqual({ provider: 'mock', model: 'mock' });
  });

  it('uses getModel for built-in openai provider without baseUrl', () => {
    const model = createModel('openai', 'openai', 'gpt-4o');
    expect(model).toEqual({ provider: 'mock', model: 'mock' });
  });

  it('uses getModel for built-in google provider without baseUrl', () => {
    const model = createModel('google', 'openai', 'gemini-2.5-pro');
    expect(model).toEqual({ provider: 'mock', model: 'mock' });
  });

  it('constructs manual Model for custom provider', () => {
    const model = createModel('zhipu', 'openai', 'glm-4v-plus', 'https://open.bigmodel.cn/api/paas/v4');
    expect(model.id).toBe('glm-4v-plus');
    expect(model.name).toBe('glm-4v-plus');
    expect(model.api).toBe('openai-completions');
    expect(model.provider).toBe('zhipu');
    expect(model.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('constructs manual Model for built-in provider with custom baseUrl', () => {
    const model = createModel('anthropic', 'anthropic', 'claude-sonnet-4-20250514', 'https://proxy.example.com');
    expect(model.id).toBe('claude-sonnet-4-20250514');
    expect(model.api).toBe('anthropic-messages');
    expect(model.baseUrl).toBe('https://proxy.example.com');
  });

  it('maps anthropic protocol to anthropic-messages api', () => {
    const model = createModel('custom', 'anthropic', 'my-model', 'https://custom.api.com');
    expect(model.api).toBe('anthropic-messages');
  });

  it('maps openai protocol to openai-completions api', () => {
    const model = createModel('custom', 'openai', 'my-model', 'https://custom.api.com');
    expect(model.api).toBe('openai-completions');
  });
});
