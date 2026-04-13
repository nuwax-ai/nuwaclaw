/**
 * Agent loop engine using pi-mono Agent class.
 *
 * Creates a pi-mono Agent instance configured with GUI tools,
 * hooks for safety/audit/memory, and manages the task lifecycle.
 * Does NOT hand-write the loop — pi-mono handles that internally.
 */

import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult, AgentEvent } from '@mariozechner/pi-agent-core';
import type { ImageContent, TextContent, Message, Model, Api } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';

import type { GuiAgentConfig } from '../config.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { MemoryManager } from './memoryManager.js';
import { StuckDetector } from './stuckDetector.js';
import { resolveCoordinate, type ScreenshotMeta, type DisplayInfo } from '../coordinates/resolver.js';
import { getModelProfile } from '../coordinates/modelProfiles.js';
import { captureScreenshot, type ScreenshotResult } from '../desktop/screenshot.js';
import * as mouse from '../desktop/mouse.js';
import * as desktopKeyboard from '../desktop/keyboard.js';
import { getDisplay } from '../desktop/display.js';
import { validateHotkey } from '../safety/hotkeys.js';
import { AuditLog } from '../safety/auditLog.js';
import { logInfo, logDebug, logError, logWarn } from '../utils/logger.js';

export interface StepRecord {
  stepId: number;
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs: number;
}

export interface TaskResult {
  success: boolean;
  result?: string;
  finalScreenshot?: string;
  steps: StepRecord[];
  error?: string;
}

export interface ProgressInfo {
  step: number;
  total: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  message?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a pi-mono Model instance.
 * Built-in providers (anthropic/openai/google) without custom baseUrl use getModel().
 * Custom providers or those with baseUrl get a manually constructed Model object.
 */
export function createModel(
  provider: string,
  apiProtocol: 'anthropic' | 'openai',
  modelId: string,
  baseUrl?: string,
): Model<Api> {
  const builtinProviders = ['anthropic', 'openai', 'google'];
  if (builtinProviders.includes(provider) && !baseUrl) {
    return getModel(provider as any, modelId as any);
  }

  const api = apiProtocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  } as Model<Api>;
}

export function createTaskRunner(
  config: GuiAgentConfig,
  auditLog: AuditLog,
) {
  let currentAgent: Agent | null = null;

  async function run(
    taskText: string,
    signal: AbortSignal,
    onProgress: (info: ProgressInfo) => void,
  ): Promise<TaskResult> {
    const steps: StepRecord[] = [];
    let stepCount = 0;
    let latestScreenshot: ScreenshotResult | null = null;
    let taskResult: string | undefined;
    let pendingMemoryWork: Promise<void> = Promise.resolve();

    // Build model instances
    const model = createModel(config.provider, config.apiProtocol, config.model, config.baseUrl);
    const memoryModel = createModel(
      config.memoryProvider ?? config.provider,
      config.apiProtocol,
      config.memoryModel ?? config.model,
      config.baseUrl,
    );
    const memoryManager = new MemoryManager(memoryModel, config.apiKey ?? '');
    const stuckDetector = new StuckDetector(config.stuckThreshold);
    const profile = getModelProfile(config.model, config.coordinateMode as any);
    const displayInfo = await getDisplay(config.displayIndex);

    // Build coordinate resolve helper
    function resolveXY(x: number, y: number, meta: ScreenshotMeta) {
      const di: DisplayInfo = {
        origin: displayInfo.origin,
        bounds: { width: displayInfo.width, height: displayInfo.height },
        scaleFactor: displayInfo.scaleFactor,
      };
      return resolveCoordinate(x, y, profile, meta, di);
    }

    function getScreenshotMeta(): ScreenshotMeta {
      if (latestScreenshot) {
        return {
          imageWidth: latestScreenshot.imageWidth,
          imageHeight: latestScreenshot.imageHeight,
          logicalWidth: latestScreenshot.logicalWidth,
          logicalHeight: latestScreenshot.logicalHeight,
        };
      }
      return {
        imageWidth: displayInfo.width,
        imageHeight: displayInfo.height,
        logicalWidth: displayInfo.width,
        logicalHeight: displayInfo.height,
      };
    }

    // --- Define AgentTool[] ---
    const guiTools: AgentTool[] = [
      {
        name: 'computer_screenshot',
        label: 'Screenshot',
        description: 'Capture the current screen',
        parameters: Type.Object({}),
        execute: async (_toolCallId, _params, _signal) => {
          const shot = await captureScreenshot(config.displayIndex, config.jpegQuality);
          latestScreenshot = shot;
          return {
            content: [{ type: 'image' as const, data: shot.image, mimeType: shot.mimeType }],
            details: { imageWidth: shot.imageWidth, imageHeight: shot.imageHeight },
          };
        },
      },
      {
        name: 'computer_click',
        label: 'Click',
        description: 'Click at coordinates (x, y)',
        parameters: Type.Object({
          x: Type.Number({ description: 'X coordinate' }),
          y: Type.Number({ description: 'Y coordinate' }),
          button: Type.Optional(Type.String({ description: 'Mouse button: left, right, middle' })),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { x: number; y: number; button?: string };
          const { globalX, globalY } = resolveXY(params.x, params.y, getScreenshotMeta());
          await mouse.click(globalX, globalY, params.button as any);
          await delay(config.stepDelayMs);
          return {
            content: [{ type: 'text' as const, text: `Clicked (${globalX}, ${globalY})` }],
            details: {},
          };
        },
      },
      {
        name: 'computer_type',
        label: 'Type',
        description: 'Type text at the current cursor position',
        parameters: Type.Object({
          text: Type.String({ description: 'Text to type' }),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { text: string };
          await desktopKeyboard.typeText(params.text);
          await delay(config.stepDelayMs);
          return {
            content: [{ type: 'text' as const, text: `Typed ${params.text.length} characters` }],
            details: {},
          };
        },
      },
      {
        name: 'computer_scroll',
        label: 'Scroll',
        description: 'Scroll at coordinates (x, y)',
        parameters: Type.Object({
          x: Type.Number({ description: 'X coordinate' }),
          y: Type.Number({ description: 'Y coordinate' }),
          deltaY: Type.Number({ description: 'Vertical scroll amount (positive=down)' }),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { x: number; y: number; deltaY: number };
          const { globalX, globalY } = resolveXY(params.x, params.y, getScreenshotMeta());
          await mouse.scroll(globalX, globalY, params.deltaY);
          await delay(config.stepDelayMs);
          return {
            content: [{ type: 'text' as const, text: `Scrolled at (${globalX}, ${globalY}), dy=${params.deltaY}` }],
            details: {},
          };
        },
      },
      {
        name: 'computer_hotkey',
        label: 'Hotkey',
        description: 'Press a key combination',
        parameters: Type.Object({
          keys: Type.Array(Type.String(), { description: 'Keys to press together' }),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { keys: string[] };
          // Safety check is done in beforeToolCall hook
          await desktopKeyboard.hotkey(params.keys);
          await delay(config.stepDelayMs);
          return {
            content: [{ type: 'text' as const, text: `Hotkey: ${params.keys.join('+')}` }],
            details: {},
          };
        },
      },
      {
        name: 'computer_wait',
        label: 'Wait',
        description: 'Wait for a specified duration',
        parameters: Type.Object({
          ms: Type.Number({ description: 'Duration in milliseconds' }),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { ms: number };
          const waitMs = Math.min(params.ms, 10000); // Cap at 10s
          await delay(waitMs);
          return {
            content: [{ type: 'text' as const, text: `Waited ${waitMs}ms` }],
            details: {},
          };
        },
      },
      {
        name: 'computer_done',
        label: 'Done',
        description: 'Signal that the task is complete. Provide a result description.',
        parameters: Type.Object({
          result: Type.String({ description: 'Task completion result description' }),
        }),
        execute: async (_toolCallId, rawParams, _signal) => {
          const params = rawParams as { result: string };
          taskResult = params.result;
          return {
            content: [{ type: 'text' as const, text: params.result }],
            details: { done: true },
          };
        },
      },
    ];

    // --- Create Agent ---
    const agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(taskText, memoryManager.compose()),
        model,
        thinkingLevel: 'off',
        tools: guiTools,
        messages: [],
      },
      toolExecution: 'sequential',
      transformContext: async (messages, _signal) => {
        return memoryManager.pruneScreenshots(messages) as any;
      },
      convertToLlm: (messages) =>
        (messages as any[]).filter(m => ['user', 'assistant', 'toolResult'].includes(m.role)) as Message[],
      beforeToolCall: async ({ toolCall, args }) => {
        if (toolCall.name === 'computer_hotkey') {
          const typedArgs = args as { keys: string[] };
          const validation = validateHotkey(typedArgs.keys);
          if (validation.blocked) {
            return { block: true, reason: `Blocked dangerous hotkey: ${validation.reason}` };
          }
        }
        return undefined;
      },
      afterToolCall: async ({ toolCall, args, result, isError }) => {
        auditLog.record({ tool: toolCall.name, args: args as Record<string, unknown>, success: !isError });
        return undefined;
      },
      getApiKey: (_provider: string) => config.apiKey,
    });

    currentAgent = agent;

    // --- Subscribe to events ---
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      // Record pending step when tool execution starts (visible to LLM during execution)
      if (event.type === 'tool_execution_start') {
        const toolName = (event as any).toolCall?.name ?? 'unknown';
        memoryManager.addPendingStep(stepCount + 1, toolName);
      }

      if (event.type === 'turn_end') {
        stepCount++;

        // Record step
        const toolResults = event.toolResults || [];
        for (const tr of toolResults) {
          steps.push({
            stepId: stepCount,
            tool: tr.toolName,
            args: (tr as any).args ?? {},
            success: !tr.isError,
            durationMs: (tr as any).durationMs ?? 0,
          });
        }

        // Memory management (async, queued)
        const goal = toolResults.map(tr => tr.toolName).join(', ') || 'LLM response';
        const evaluation = toolResults.some(tr => tr.isError) ? 'failed' as const : 'success' as const;
        pendingMemoryWork = memoryManager.finalizeStep(stepCount, evaluation)
          .then(() => {
            agent.setSystemPrompt(buildSystemPrompt(taskText, memoryManager.compose()));
          })
          .catch(err => {
            logError(`Memory finalize failed: ${err}`);
          });

        // Stuck detection (async, fire-and-forget)
        if (latestScreenshot) {
          stuckDetector.check(latestScreenshot.image).then(({ stuck }) => {
            if (stuck) {
              logWarn(`Agent appears stuck after ${stepCount} steps, aborting`);
              agent.abort();
            }
          }).catch(err => {
            logError(`Stuck detector error: ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        // Progress notification
        onProgress({
          step: stepCount,
          total: config.maxSteps,
          status: 'running',
          message: `Step ${stepCount}: ${goal}`,
        });

        // Max steps check
        if (stepCount >= config.maxSteps) {
          logWarn(`Max steps (${config.maxSteps}) reached, aborting`);
          agent.abort();
        }
      }
    });

    // --- Handle external abort ---
    const abortHandler = () => agent.abort();
    signal.addEventListener('abort', abortHandler);

    try {
      // Capture initial screenshot
      const initialShot = await captureScreenshot(config.displayIndex, config.jpegQuality);
      latestScreenshot = initialShot;

      // Start the agent loop
      logInfo(`Starting task: ${taskText.substring(0, 100)}`);
      await agent.prompt(taskText, [
        { type: 'image' as const, data: initialShot.image, mimeType: initialShot.mimeType },
      ]);

      // Wait for pending memory work
      await pendingMemoryWork;

      // Determine result
      const lastMessage = agent.state.messages[agent.state.messages.length - 1];
      const stopReason = lastMessage && 'stopReason' in lastMessage ? (lastMessage as any).stopReason : undefined;

      if (stopReason === 'aborted') {
        onProgress({ step: stepCount, total: config.maxSteps, status: 'aborted' });
        return {
          success: false,
          error: 'Task was aborted',
          steps,
          finalScreenshot: latestScreenshot?.image,
        };
      }

      if (stopReason === 'error') {
        onProgress({ step: stepCount, total: config.maxSteps, status: 'error', message: 'Agent stopped with error (possible context overflow)' });
        return {
          success: false,
          error: 'Agent stopped with error (possible context overflow)',
          steps,
          finalScreenshot: latestScreenshot?.image,
        };
      }

      onProgress({ step: stepCount, total: config.maxSteps, status: 'done' });
      return {
        success: true,
        result: taskResult ?? extractTextResult(lastMessage),
        steps,
        finalScreenshot: latestScreenshot?.image,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logError(`Task execution error: ${errorMsg}`);
      onProgress({ step: stepCount, total: config.maxSteps, status: 'error', message: errorMsg });
      return {
        success: false,
        error: errorMsg,
        steps,
        finalScreenshot: latestScreenshot?.image,
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
      unsubscribe();
      currentAgent = null;
    }
  }

  function abort(): void {
    currentAgent?.abort();
  }

  return { run, abort };
}

function extractTextResult(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const msg = message as any;
  if (Array.isArray(msg.content)) {
    const text = msg.content.find((c: any) => c.type === 'text');
    return text?.text;
  }
  return undefined;
}
