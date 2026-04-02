/**
 * gui_execute_task MCP tool handler.
 *
 * Provides a high-level "execute a GUI task via natural language" tool
 * backed by the pi-mono Agent loop. Uses a Mutex to ensure only one
 * GUI task runs at a time.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { GuiAgentConfig } from '../config.js';
import { AuditLog } from '../safety/auditLog.js';
import { createTaskRunner, type ProgressInfo } from '../agent/taskRunner.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';

export const TASK_TOOLS = [
  {
    name: 'gui_execute_task',
    description:
      'Execute a GUI automation task described in natural language. ' +
      'The agent will analyze screenshots and perform mouse/keyboard actions to complete the task. ' +
      'Only one task can run at a time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Natural language description of the GUI task to execute',
        },
        maxSteps: {
          type: 'number',
          description: 'Override max steps for this task (default: server config)',
        },
      },
      required: ['task'],
    },
  },
];

/** Mutex — only one GUI task at a time, second caller waits in queue */
let mutexPromise: Promise<void> = Promise.resolve();

export async function handleTaskTool(
  name: string,
  args: Record<string, unknown>,
  config: GuiAgentConfig,
  auditLog: AuditLog,
  extra?: { signal?: AbortSignal; sendNotification?: (notification: { method: string; params: unknown }) => Promise<void> },
): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean } | null> {
  if (name !== 'gui_execute_task') {
    return null; // Not handled by this module
  }

  const taskText = args.task as string;
  if (!taskText || typeof taskText !== 'string') {
    return { content: [{ type: 'text', text: 'Error: task parameter is required and must be a string' }], isError: true };
  }

  // Mutex — wait for previous task to complete (queue, not reject)
  let releaseMutex: () => void;
  const prevMutex = mutexPromise;
  mutexPromise = new Promise<void>((resolve) => { releaseMutex = resolve; });

  // Check if cancelled while waiting for mutex
  if (extra?.signal?.aborted) {
    releaseMutex!();
    return { content: [{ type: 'text', text: 'Task cancelled before start' }], isError: true };
  }

  await prevMutex;

  // Check cancellation again after acquiring mutex
  if (extra?.signal?.aborted) {
    releaseMutex!();
    return { content: [{ type: 'text', text: 'Task cancelled before start' }], isError: true };
  }

  // Build config override
  const taskConfig = { ...config };
  if (args.maxSteps !== undefined) {
    taskConfig.maxSteps = Math.min(Math.max(Number(args.maxSteps), 1), 200);
  }

  const runner = createTaskRunner(taskConfig, auditLog);

  // Create AbortController that merges external signal
  const taskAbortController = new AbortController();
  if (extra?.signal) {
    extra.signal.addEventListener('abort', () => taskAbortController.abort(), { once: true });
  }

  // Stable progress token for this task — MCP protocol requires same token for all updates
  const progressToken = `gui_task_${Date.now()}`;

  // Progress callback — sends MCP notifications
  const onProgress = async (info: ProgressInfo) => {
    if (extra?.sendNotification) {
      try {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: info.step,
            total: info.total,
            message: info.message,
          },
        });
      } catch {
        // Progress notification failure is non-fatal
      }
    }
  };

  try {
    logInfo(`gui_execute_task started: "${taskText.substring(0, 100)}"`);
    const result = await runner.run(taskText, taskAbortController.signal, onProgress);

    // Build response
    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

    // Add text result
    content.push({
      type: 'text',
      text: JSON.stringify({
        success: result.success,
        result: result.result,
        error: result.error,
        stepsCompleted: result.steps.length,
        steps: result.steps.map(s => ({
          stepId: s.stepId,
          tool: s.tool,
          success: s.success,
        })),
      }, null, 2),
    });

    // Add final screenshot if available
    if (result.finalScreenshot) {
      content.push({
        type: 'image',
        data: result.finalScreenshot,
        mimeType: 'image/jpeg',
      });
    }

    logInfo(`gui_execute_task completed: success=${result.success}, steps=${result.steps.length}`);
    return { content, isError: !result.success };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`gui_execute_task error: ${errorMsg}`);
    return { content: [{ type: 'text', text: `Error: ${errorMsg}` }], isError: true };
  } finally {
    releaseMutex!();
  }
}
