/**
 * Unified configuration: parse GUI_AGENT_* environment variables,
 * validate, and return a type-safe GuiAgentConfig object.
 *
 * Missing required fields throw ConfigError immediately (Fail Fast).
 */

import { ConfigError } from './utils/errors.js';
import { logInfo } from './utils/logger.js';
import type { CoordinateMode } from './coordinates/modelProfiles.js';

const VALID_COORDINATE_MODES: readonly string[] = ['image-absolute', 'normalized-1000', 'normalized-999', 'normalized-0-1'];

export interface GuiAgentConfig {
  /** LLM provider (e.g. 'anthropic', 'openai', 'google', 'zhipu', 'qwen', 'deepseek') */
  provider: string;
  /** API protocol: 'anthropic' (x-api-key + /v1/messages) or 'openai' (Bearer + /chat/completions) */
  apiProtocol: 'anthropic' | 'openai';
  /** LLM model name */
  model: string;
  /** API key for the LLM provider */
  apiKey: string;
  /** Optional base URL for the LLM API */
  baseUrl?: string;

  /** Memory model provider (defaults to main provider) */
  memoryProvider?: string;
  /** Memory model name (defaults to main model) */
  memoryModel?: string;

  /** Override coordinate mode (auto-detected from model if empty) */
  coordinateMode?: CoordinateMode;
  /** Target display index */
  displayIndex: number;

  /** JPEG quality for screenshots (1-100) */
  jpegQuality: number;
  /** Maximum steps per task */
  maxSteps: number;
  /** Delay between steps in ms */
  stepDelayMs: number;
  /** Consecutive similar screenshots to trigger stuck detection */
  stuckThreshold: number;

  /** MCP server transport mode */
  transport: 'http' | 'stdio';
  /** HTTP server port */
  port: number;

  /** Optional log file path */
  logFile?: string;
}

function parseIntRange(name: string, value: string | undefined, min: number, max: number, defaultVal: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got: ${value}`);
  }
  return n;
}

export function loadConfig(overrides?: Partial<GuiAgentConfig>): GuiAgentConfig {
  const env = process.env;

  const apiKey = overrides?.apiKey ?? env.GUI_AGENT_API_KEY;
  if (!apiKey) {
    throw new ConfigError('GUI_AGENT_API_KEY is required');
  }

  const transport = (overrides?.transport ?? env.GUI_AGENT_TRANSPORT ?? 'http') as 'http' | 'stdio';
  if (transport !== 'http' && transport !== 'stdio') {
    throw new ConfigError(`GUI_AGENT_TRANSPORT must be "http" or "stdio", got: ${transport}`);
  }

  const apiProtocol = (overrides?.apiProtocol ?? env.GUI_AGENT_API_PROTOCOL ?? 'anthropic') as 'anthropic' | 'openai';
  if (apiProtocol !== 'anthropic' && apiProtocol !== 'openai') {
    throw new ConfigError(`GUI_AGENT_API_PROTOCOL must be "anthropic" or "openai", got: ${apiProtocol}`);
  }

  const rawCoordinateMode = overrides?.coordinateMode ?? env.GUI_AGENT_COORDINATE_MODE;
  // 'auto' means auto-detect from model name (via modelProfiles), treat as undefined
  const effectiveCoordinateMode = rawCoordinateMode === 'auto' ? undefined : rawCoordinateMode;
  if (effectiveCoordinateMode && !VALID_COORDINATE_MODES.includes(effectiveCoordinateMode)) {
    throw new ConfigError(`GUI_AGENT_COORDINATE_MODE must be one of: auto, ${VALID_COORDINATE_MODES.join(', ')}, got: ${rawCoordinateMode}`);
  }

  const config: GuiAgentConfig = {
    provider: overrides?.provider ?? env.GUI_AGENT_PROVIDER ?? 'anthropic',
    apiProtocol,
    model: overrides?.model ?? env.GUI_AGENT_MODEL ?? 'claude-sonnet-4-20250514',
    apiKey,
    baseUrl: overrides?.baseUrl ?? env.GUI_AGENT_BASE_URL,

    memoryProvider: overrides?.memoryProvider ?? env.GUI_AGENT_MEMORY_PROVIDER,
    memoryModel: overrides?.memoryModel ?? env.GUI_AGENT_MEMORY_MODEL,

    coordinateMode: effectiveCoordinateMode as CoordinateMode | undefined,
    displayIndex: parseIntRange('GUI_AGENT_DISPLAY_INDEX', overrides?.displayIndex?.toString() ?? env.GUI_AGENT_DISPLAY_INDEX, 0, 15, 0),

    jpegQuality: parseIntRange('GUI_AGENT_JPEG_QUALITY', overrides?.jpegQuality?.toString() ?? env.GUI_AGENT_JPEG_QUALITY, 1, 100, 75),
    maxSteps: parseIntRange('GUI_AGENT_MAX_STEPS', overrides?.maxSteps?.toString() ?? env.GUI_AGENT_MAX_STEPS, 1, 200, 50),
    stepDelayMs: parseIntRange('GUI_AGENT_STEP_DELAY_MS', overrides?.stepDelayMs?.toString() ?? env.GUI_AGENT_STEP_DELAY_MS, 100, 30000, 1500),
    stuckThreshold: parseIntRange('GUI_AGENT_STUCK_THRESHOLD', overrides?.stuckThreshold?.toString() ?? env.GUI_AGENT_STUCK_THRESHOLD, 1, 20, 3),

    transport,
    port: parseIntRange('GUI_AGENT_PORT', overrides?.port?.toString() ?? env.GUI_AGENT_PORT, 1, 65535, 60008),

    logFile: overrides?.logFile ?? env.GUI_AGENT_LOG_FILE,
  };

  logInfo(`Config loaded: provider=${config.provider}, model=${config.model}, transport=${config.transport}, port=${config.port}`);
  return config;
}
