/**
 * Claude Agent SDK loader for Electron
 *
 * Dynamically imports @anthropic-ai/claude-agent-sdk (ESM) from CJS context.
 * References LobsterAI's claudeSdk.ts + claudeSettings.ts pattern.
 */

import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import log from 'electron-log';

// ==================== Types ====================

/**
 * The full SDK module type.
 * We define it locally so we don't need the SDK installed at compile time
 * for type-checking (it's loaded at runtime via dynamic import).
 */
export interface ClaudeSdkModule {
  query: (params: { prompt: string; options?: Record<string, unknown> }) => Promise<AsyncIterable<unknown>>;
  tool: (...args: unknown[]) => unknown;
  createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => unknown;
}

export interface PermissionResult {
  behavior: 'allow' | 'deny';
}

// ==================== Path Resolution ====================

const CLAUDE_SDK_PATH_PARTS = ['@anthropic-ai', 'claude-agent-sdk'];

/**
 * Resolve the project root directory, accounting for CJS output in dist/.
 */
function getProjectRoot(): string {
  const appPath = app.getAppPath();
  // In dev, appPath may end with dist/ or dist/main
  if (appPath.endsWith('dist') || appPath.endsWith('dist/main')) {
    return join(appPath, '..');
  }
  return appPath;
}

/**
 * Resolve path to the SDK's ESM entry (sdk.mjs).
 * - Packaged: app.asar.unpacked/node_modules/...
 * - Dev: project_root/node_modules/...
 */
export function getClaudeSdkPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      ...CLAUDE_SDK_PATH_PARTS,
      'sdk.mjs',
    );
  }

  return join(
    getProjectRoot(),
    'node_modules',
    ...CLAUDE_SDK_PATH_PARTS,
    'sdk.mjs',
  );
}

/**
 * Resolve path to the SDK's CLI entry (cli.js).
 * Passed to `pathToClaudeCodeExecutable` so the SDK can fork() itself.
 */
export function getClaudeCodeCliPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      ...CLAUDE_SDK_PATH_PARTS,
      'cli.js',
    );
  }

  return join(
    getProjectRoot(),
    'node_modules',
    ...CLAUDE_SDK_PATH_PARTS,
    'cli.js',
  );
}

// ==================== SDK Loader ====================

let claudeSdkPromise: Promise<ClaudeSdkModule> | null = null;

/**
 * Dynamically load the Claude Agent SDK.
 *
 * Uses `new Function('specifier', 'return import(specifier)')` to bypass
 * the CJS → ESM restriction (tsc compiles import() to require() in CJS mode).
 * Result is cached as a singleton.
 */
export function loadClaudeSdk(): Promise<ClaudeSdkModule> {
  if (!claudeSdkPromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<ClaudeSdkModule>;

    const sdkPath = getClaudeSdkPath();
    const sdkUrl = pathToFileURL(sdkPath).href;
    const sdkExists = existsSync(sdkPath);

    log.info('[ClaudeAgentSDK] Loading SDK', {
      sdkPath,
      sdkUrl,
      sdkExists,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });

    claudeSdkPromise = dynamicImport(sdkUrl).catch((error) => {
      log.error('[ClaudeAgentSDK] Failed to load SDK', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        sdkPath,
        sdkExists,
      });
      claudeSdkPromise = null;
      throw error;
    });
  }

  return claudeSdkPromise;
}
