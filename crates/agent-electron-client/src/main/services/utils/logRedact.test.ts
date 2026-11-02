/**
 * 单元测试: logRedact
 *
 * 测试日志脱敏逻辑
 */

import { describe, it, expect } from 'vitest';
import { redactForLog, redactStringForLog } from './logRedact';

describe('logRedact', () => {
  describe('redactForLog', () => {
    describe('基本脱敏', () => {
      it('should mask api_key', () => {
        const input = { api_key: 'ak-1234567890abcdef' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.api_key).toBe('ak-12345...');
        expect(result.api_key).not.toContain('90abcdef');
      });

      it('should mask token', () => {
        const input = { token: 'my-secret-token-12345' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.token).toContain('...');
        expect(result.token).not.toContain('secret');
      });

      it('should mask password (long value shows prefix)', () => {
        const input = { password: 'supersecretpassword' };
        const result = redactForLog(input) as Record<string, string>;
        // 长值显示前缀 + "..."
        expect(result.password).toContain('...');
        expect(result.password).not.toContain('secretpassword');
      });

      it('should mask short values as ***', () => {
        const input = { api_key: 'short' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.api_key).toBe('***');
      });
    });

    describe('模式匹配', () => {
      it('should match *_API_KEY pattern', () => {
        const input = { CUSTOM_API_KEY: 'ak-custom-key-12345678' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.CUSTOM_API_KEY).toContain('...');
      });

      it('should match *_TOKEN pattern', () => {
        const input = { SESSION_TOKEN: 'session-token-abcdefg' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.SESSION_TOKEN).toContain('...');
      });

      it('should match *_SECRET pattern', () => {
        const input = { APP_SECRET: 'app-secret-value' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.APP_SECRET).toContain('...');
      });
    });

    describe('特殊键名', () => {
      it('should mask anthropic_api_key', () => {
        const input = { anthropic_api_key: 'sk-ant-1234567890' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.anthropic_api_key).toContain('...');
      });

      it('should mask openai_api_key', () => {
        const input = { openai_api_key: 'sk-openai-1234567890' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.openai_api_key).toContain('...');
      });

      it('should mask amap_maps_api_key', () => {
        const input = { amap_maps_api_key: 'amap-key-12345678' };
        const result = redactForLog(input) as Record<string, string>;
        expect(result.amap_maps_api_key).toContain('...');
      });
    });

    describe('非字符串值处理', () => {
      it('should handle null value', () => {
        const input = { api_key: null };
        const result = redactForLog(input) as Record<string, null>;
        expect(result.api_key).toBeNull();
      });

      it('should handle undefined value (treated as *** for sensitive key)', () => {
        const input = { api_key: undefined };
        const result = redactForLog(input) as Record<string, unknown>;
        // 敏感键的 undefined 值被替换为 '***'
        expect(result.api_key).toBe('***');
      });

      it('should handle number value as ***', () => {
        const input = { api_key: 12345 };
        const result = redactForLog(input) as Record<string, unknown>;
        expect(result.api_key).toBe('***');
      });

      it('should handle boolean value as ***', () => {
        const input = { api_key: true };
        const result = redactForLog(input) as Record<string, unknown>;
        expect(result.api_key).toBe('***');
      });

      it('should handle nested object', () => {
        const input = { env: { api_key: 'nested-key-12345678' } };
        const result = redactForLog(input) as Record<string, unknown>;
        const env = result.env as Record<string, string>;
        expect(env.api_key).toContain('...');
      });
    });

    describe('数组和嵌套', () => {
      it('should handle array', () => {
        const input = [
          { api_key: 'key1-12345678' },
          { api_key: 'key2-12345678' },
        ];
        const result = redactForLog(input) as Array<Record<string, string>>;
        expect(result[0].api_key).toContain('...');
        expect(result[1].api_key).toContain('...');
      });

      it('should handle deeply nested object', () => {
        const input = {
          level1: {
            level2: {
              api_key: 'deep-key-12345678',
            },
          },
        };
        const result = redactForLog(input) as Record<string, unknown>;
        const level1 = result.level1 as Record<string, unknown>;
        const level2 = level1.level2 as Record<string, string>;
        expect(level2.api_key).toContain('...');
      });
    });

    describe('不修改原对象', () => {
      it('should not modify original object', () => {
        const input = { api_key: 'original-key-12345678' };
        const originalValue = input.api_key;
        redactForLog(input);
        expect(input.api_key).toBe(originalValue);
      });
    });

    describe('非敏感键保留', () => {
      it('should preserve non-sensitive keys', () => {
        const input = {
          user_id: 'user123',
          project_id: 'proj456',
          api_key: 'secret-key-12345678',
        };
        const result = redactForLog(input) as Record<string, unknown>;
        expect(result.user_id).toBe('user123');
        expect(result.project_id).toBe('proj456');
        expect(result.api_key).toContain('...');
      });
    });

    describe('原始类型', () => {
      it('should return null as-is', () => {
        expect(redactForLog(null)).toBeNull();
      });

      it('should return undefined as-is', () => {
        expect(redactForLog(undefined)).toBeUndefined();
      });

      it('should return string as-is', () => {
        expect(redactForLog('hello')).toBe('hello');
      });

      it('should return number as-is', () => {
        expect(redactForLog(42)).toBe(42);
      });
    });
  });

  describe('redactStringForLog', () => {
    describe('JSON 键值对', () => {
      it('should mask api_key in JSON string', () => {
        const input = '{"api_key": "ak-1234567890abcdef"}';
        const result = redactStringForLog(input);
        expect(result).toContain('ak-12345...');
        expect(result).not.toContain('90abcdef');
      });

      it('should mask ANTHROPIC_API_KEY in JSON string', () => {
        const input = '{"ANTHROPIC_API_KEY": "sk-ant-1234567890"}';
        const result = redactStringForLog(input);
        expect(result).toContain('...');
      });

      it('should be case-insensitive', () => {
        const input = '{"API_KEY": "ak-1234567890"}';
        const result = redactStringForLog(input);
        expect(result).toContain('...');
      });
    });

    describe('URL 参数', () => {
      it('should mask ak= in URL', () => {
        const input = 'https://example.com/api?ak=my-secret-key';
        const result = redactStringForLog(input);
        expect(result).toContain('ak=***');
        expect(result).not.toContain('my-secret-key');
      });
    });

    describe('API key 前缀', () => {
      it('should mask ak- prefix', () => {
        const input = 'key: ak-1234567890abcdef';
        const result = redactStringForLog(input);
        expect(result).toBe('key: ak-12345678...');
      });

      it('should mask sk- prefix', () => {
        const input = 'key: sk-1234567890abcdef';
        const result = redactStringForLog(input);
        expect(result).toBe('key: sk-12345678...');
      });

      it('should mask sak- prefix', () => {
        const input = 'key: sak-1234567890abcdef';
        const result = redactStringForLog(input);
        // sak- 前缀保留 4 字符（sak-）+ 8 字符 = 12 字符
        expect(result).toBe('key: sak-12345678...');
      });

      it('should mask pk- prefix', () => {
        const input = 'key: pk-1234567890abcdef';
        const result = redactStringForLog(input);
        expect(result).toBe('key: pk-12345678...');
      });

      it('should mask Bearer token', () => {
        const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        const result = redactStringForLog(input);
        expect(result).toContain('Bearer eyJhbGci...');
        expect(result).not.toContain('IkpXVCJ9');
      });
    });

    describe('边界情况', () => {
      it('should handle non-string input', () => {
        expect(redactStringForLog(null as any)).toBe('null');
        expect(redactStringForLog(undefined as any)).toBe('undefined');
        expect(redactStringForLog(123 as any)).toBe('123');
      });

      it('should handle empty string', () => {
        expect(redactStringForLog('')).toBe('');
      });

      it('should handle string without sensitive data', () => {
        const input = '{"user_id": "123", "name": "test"}';
        expect(redactStringForLog(input)).toBe(input);
      });

      it('should handle short API key (<=8 chars)', () => {
        const input = 'key: ak-short';
        // 短 key 不匹配 ak-[a-zA-Z0-9]{8} 模式
        expect(redactStringForLog(input)).toBe('key: ak-short');
      });
    });

    describe('多个匹配', () => {
      it('should mask multiple keys', () => {
        const input = '{"api_key": "ak-1111111111", "token": "sk-2222222222"}';
        const result = redactStringForLog(input);
        // api_key 被 JSON 键匹配处理，保留 min(8, floor(12/2))=6 字符
        expect(result).toContain('ak-111...');
        // token 被 sk- 前缀正则匹配，保留 sk- 后 8 字符
        expect(result).toContain('sk-22222222...');
      });
    });
  });
});
