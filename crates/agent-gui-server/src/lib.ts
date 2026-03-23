/**
 * SDK entry point — programmatic API for embedding the GUI Agent MCP Server.
 */

export { createGuiAgentServer, type GuiAgentServer } from './mcp/server.js';
export { loadConfig, type GuiAgentConfig } from './config.js';
export type { ScreenshotResult } from './desktop/screenshot.js';
export type { DisplayDescriptor } from './desktop/display.js';
export type { TaskResult, ProgressInfo, StepRecord } from './agent/taskRunner.js';
