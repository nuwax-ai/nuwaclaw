/**
 * Unit tests for config.ts — required field validation, defaults, range checks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

// Suppress logger output during tests
vi.mock('../../src/utils/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all GUI_AGENT_* env vars
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('GUI_AGENT_')) delete process.env[key];
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // --- Required field validation ---

  it('throws ConfigError when API_KEY is missing', () => {
    expect(() => loadConfig()).toThrow('GUI_AGENT_API_KEY is required');
  });

  it('accepts API_KEY from env', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.apiKey).toBe('test-key');
  });

  it('accepts API_KEY from overrides', () => {
    const config = loadConfig({ apiKey: 'override-key' });
    expect(config.apiKey).toBe('override-key');
  });

  // --- Default values ---

  it('has correct defaults', () => {
    const config = loadConfig({ apiKey: 'test-key' });
    expect(config.provider).toBe('anthropic');
    expect(config.apiProtocol).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-20250514');
    expect(config.port).toBe(60008);
    expect(config.transport).toBe('http');
    expect(config.maxSteps).toBe(50);
    expect(config.stepDelayMs).toBe(1500);
    expect(config.stuckThreshold).toBe(3);
    expect(config.jpegQuality).toBe(75);
    expect(config.displayIndex).toBe(0);
    expect(config.coordinateMode).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
    expect(config.memoryProvider).toBeUndefined();
    expect(config.memoryModel).toBeUndefined();
    expect(config.logFile).toBeUndefined();
  });

  // --- Transport validation ---

  it('throws on invalid transport', () => {
    expect(() => loadConfig({ apiKey: 'test-key', transport: 'websocket' as any }))
      .toThrow('GUI_AGENT_TRANSPORT must be "http" or "stdio"');
  });

  it('accepts stdio transport', () => {
    const config = loadConfig({ apiKey: 'test-key', transport: 'stdio' });
    expect(config.transport).toBe('stdio');
  });

  // --- Numeric range validation ---

  it('throws when maxSteps exceeds range', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_MAX_STEPS = '999';
    expect(() => loadConfig()).toThrow('GUI_AGENT_MAX_STEPS must be between 1 and 200');
  });

  it('throws when maxSteps is below range', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_MAX_STEPS = '0';
    expect(() => loadConfig()).toThrow('GUI_AGENT_MAX_STEPS must be between 1 and 200');
  });

  it('throws when jpegQuality exceeds range', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_JPEG_QUALITY = '101';
    expect(() => loadConfig()).toThrow('GUI_AGENT_JPEG_QUALITY must be between 1 and 100');
  });

  it('throws when stepDelayMs exceeds range', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_STEP_DELAY_MS = '50000';
    expect(() => loadConfig()).toThrow('GUI_AGENT_STEP_DELAY_MS must be between 100 and 30000');
  });

  it('throws when port is invalid', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_PORT = '99999';
    expect(() => loadConfig()).toThrow('GUI_AGENT_PORT must be between 1 and 65535');
  });

  it('accepts valid numeric values', () => {
    const config = loadConfig({
      apiKey: 'test-key',
      maxSteps: 100,
      jpegQuality: 50,
      stepDelayMs: 2000,
      port: 8080,
    });
    expect(config.maxSteps).toBe(100);
    expect(config.jpegQuality).toBe(50);
    expect(config.stepDelayMs).toBe(2000);
    expect(config.port).toBe(8080);
  });

  // --- apiProtocol validation ---

  it('throws on invalid apiProtocol', () => {
    expect(() => loadConfig({ apiKey: 'test-key', apiProtocol: 'grpc' as any }))
      .toThrow('GUI_AGENT_API_PROTOCOL must be "anthropic" or "openai"');
  });

  it('accepts openai apiProtocol', () => {
    const config = loadConfig({ apiKey: 'test-key', apiProtocol: 'openai' });
    expect(config.apiProtocol).toBe('openai');
  });

  it('reads apiProtocol from env', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_API_PROTOCOL = 'openai';
    const config = loadConfig();
    expect(config.apiProtocol).toBe('openai');
  });

  it('overrides take precedence for apiProtocol', () => {
    process.env.GUI_AGENT_API_KEY = 'test-key';
    process.env.GUI_AGENT_API_PROTOCOL = 'openai';
    const config = loadConfig({ apiKey: 'test-key', apiProtocol: 'anthropic' });
    expect(config.apiProtocol).toBe('anthropic');
  });

  // --- coordinateMode validation ---

  it('throws on invalid coordinateMode', () => {
    expect(() => loadConfig({ apiKey: 'test-key', coordinateMode: 'foobar' as any }))
      .toThrow('GUI_AGENT_COORDINATE_MODE must be one of');
  });

  it('accepts valid coordinateMode', () => {
    const config = loadConfig({ apiKey: 'test-key', coordinateMode: 'normalized-1000' });
    expect(config.coordinateMode).toBe('normalized-1000');
  });

  it('treats "auto" coordinateMode as undefined (auto-detect)', () => {
    const config = loadConfig({ apiKey: 'test-key', coordinateMode: 'auto' as any });
    expect(config.coordinateMode).toBeUndefined();
  });

  // --- Environment variable overrides ---

  it('reads all env vars', () => {
    process.env.GUI_AGENT_API_KEY = 'env-key';
    process.env.GUI_AGENT_PROVIDER = 'openai';
    process.env.GUI_AGENT_MODEL = 'gpt-4o';
    process.env.GUI_AGENT_BASE_URL = 'https://example.com';
    process.env.GUI_AGENT_MEMORY_PROVIDER = 'anthropic';
    process.env.GUI_AGENT_MEMORY_MODEL = 'haiku';
    process.env.GUI_AGENT_LOG_FILE = '/tmp/gui.log';

    const config = loadConfig();
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4o');
    expect(config.baseUrl).toBe('https://example.com');
    expect(config.memoryProvider).toBe('anthropic');
    expect(config.memoryModel).toBe('haiku');
    expect(config.logFile).toBe('/tmp/gui.log');
  });

  // --- Overrides take precedence over env ---

  it('overrides take precedence over env vars', () => {
    process.env.GUI_AGENT_API_KEY = 'env-key';
    process.env.GUI_AGENT_MODEL = 'env-model';

    const config = loadConfig({ apiKey: 'override-key', model: 'override-model' });
    expect(config.apiKey).toBe('override-key');
    expect(config.model).toBe('override-model');
  });
});
