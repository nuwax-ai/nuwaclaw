/**
 * 单元测试: agentHelpers
 *
 * 测试引擎辅助函数:
 * - mapAgentCommand: 将命令映射到引擎类型
 * - resolveAgentEnv: 解析环境变量模板
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-log - must be at top level before imports
vi.mock('electron-log', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { mapAgentCommand, resolveAgentEnv } from './agentHelpers';
import type { ModelProviderConfig } from './unifiedAgent';

const mockLog = require('electron-log').default;

describe('agentHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapAgentCommand', () => {
    it('should map "nuwaxcode" to nuwaxcode engine', () => {
      expect(mapAgentCommand('nuwaxcode')).toBe('nuwaxcode');
    });

    it('should map "claude-code" to claude-code engine', () => {
      expect(mapAgentCommand('claude-code')).toBe('claude-code');
    });

    it('should map "claude-code-acp-ts" to claude-code engine', () => {
      expect(mapAgentCommand('claude-code-acp-ts')).toBe('claude-code');
    });

    it('should return null for unknown commands', () => {
      expect(mapAgentCommand('unknown-engine')).toBeNull();
      expect(mapAgentCommand('opencode')).toBeNull();
      expect(mapAgentCommand('')).toBeNull();
    });
  });

  describe('resolveAgentEnv', () => {
    it('should resolve all placeholders when modelProvider is provided', () => {
      const env = {
        API_KEY: '{MODEL_PROVIDER_API_KEY}',
        BASE_URL: '{MODEL_PROVIDER_BASE_URL}',
        MODEL: '{MODEL_PROVIDER_MODEL}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-test-key',
        base_url: 'https://api.example.com',
        model: 'claude-opus-4-20250514',
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        API_KEY: 'sk-test-key',
        BASE_URL: 'https://api.example.com',
        MODEL: 'claude-opus-4-20250514',
      });
    });

    it('should handle partial placeholders in a single value', () => {
      const env = {
        MESSAGE: 'Using model {MODEL_PROVIDER_MODEL} with key {MODEL_PROVIDER_API_KEY}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-key',
        base_url: 'https://api.example.com',
        model: 'claude-sonnet-4-20250514',
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        MESSAGE: 'Using model claude-sonnet-4-20250514 with key sk-key',
      });
    });

    it('should skip entries with unresolved placeholders when modelProvider is undefined', () => {
      const env = {
        API_KEY: '{MODEL_PROVIDER_API_KEY}',
        STATIC: 'unchanged',
      };

      const result = resolveAgentEnv(env, undefined);

      // MODEL_PROVIDER_* placeholders remain when modelProvider is undefined
      expect(result).not.toHaveProperty('API_KEY');
      expect(result).toHaveProperty('STATIC', 'unchanged');
    });

    it('should keep non-MODEL_PROVIDER placeholders as-is', () => {
      const env = {
        API_KEY: '{MODEL_PROVIDER_API_KEY}',
        CUSTOM: '{CUSTOM_VAR}', // Not a MODEL_PROVIDER_* placeholder
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-key',
        base_url: undefined,
        model: undefined,
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toHaveProperty('API_KEY', 'sk-key');
      // CUSTOM_VAR is not a MODEL_PROVIDER_* placeholder, so it's kept as-is
      expect(result).toHaveProperty('CUSTOM', '{CUSTOM_VAR}');
    });

    it('should replace undefined modelProvider values with empty string', () => {
      const env = {
        API_KEY: '{MODEL_PROVIDER_API_KEY}',
        BASE_URL: '{MODEL_PROVIDER_BASE_URL}',
        MODEL: '{MODEL_PROVIDER_MODEL}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-key',
        base_url: undefined,
        model: undefined,
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        API_KEY: 'sk-key',
        BASE_URL: '',
        MODEL: '',
      });
    });

    it('should handle empty values in modelProvider', () => {
      const env = {
        API_KEY: '{MODEL_PROVIDER_API_KEY}',
        BASE_URL: '{MODEL_PROVIDER_BASE_URL}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: '',
        base_url: '',
        model: 'claude-opus-4-20250514',
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        API_KEY: '',
        BASE_URL: '',
      });
    });

    it('should replace multiple occurrences of the same placeholder', () => {
      const env = {
        CONFIG: 'Key: {MODEL_PROVIDER_API_KEY}, Key again: {MODEL_PROVIDER_API_KEY}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-test',
        base_url: 'https://api.example.com',
        model: 'claude-opus-4-20250514',
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        CONFIG: 'Key: sk-test, Key again: sk-test',
      });
    });

    it('should handle mixed placeholders and static text', () => {
      const env = {
        URL: 'https://{MODEL_PROVIDER_BASE_URL}/v1/models/{MODEL_PROVIDER_MODEL}',
      };
      const modelProvider: ModelProviderConfig = {
        api_key: 'sk-key',
        base_url: 'api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
      };

      const result = resolveAgentEnv(env, modelProvider);

      expect(result).toEqual({
        URL: 'https://api.anthropic.com/v1/models/claude-3-5-sonnet-20241022',
      });
    });
  });
});
