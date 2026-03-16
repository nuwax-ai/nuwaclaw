/**
 * Tests for systemPrompt — prompt generation with platform adaptation
 */

import { describe, it, expect } from 'vitest';
import { generateGuiAgentSystemPrompt } from './systemPrompt';

describe('generateGuiAgentSystemPrompt', () => {
  const baseParams = {
    port: 60010,
    token: 'test-token-uuid',
    platform: 'darwin' as NodeJS.Platform,
  };

  it('returns a non-empty string', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('contains the port in the base URL', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('http://127.0.0.1:60010');
  });

  it('contains the Bearer token in auth header', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('Authorization: Bearer test-token-uuid');
  });

  it('wraps content in <gui-agent> tags', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toMatch(/^<gui-agent>/);
    expect(result).toMatch(/<\/gui-agent>$/);
  });

  it('includes all endpoint curl examples', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('/gui/screenshot');
    expect(result).toContain('/gui/input');
    expect(result).toContain('/gui/displays');
    expect(result).toContain('/gui/cursor');
    expect(result).toContain('/gui/permissions');
    expect(result).toContain('/gui/health');
  });

  it('includes coordinate system documentation', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('Coordinate System');
    expect(result).toContain('Origin (0,0)');
  });

  it('includes workflow steps', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('Workflow');
    expect(result).toContain('Take a screenshot');
  });

  // Platform adaptation
  describe('platform-specific modifier key', () => {
    it('uses Cmd for macOS', () => {
      const result = generateGuiAgentSystemPrompt({ ...baseParams, platform: 'darwin' });
      expect(result).toContain('Primary modifier key: **Cmd**');
      expect(result).toContain('"cmd"');
      expect(result).toContain('Platform: macOS');
    });

    it('uses Ctrl for Windows', () => {
      const result = generateGuiAgentSystemPrompt({ ...baseParams, platform: 'win32' });
      expect(result).toContain('Primary modifier key: **Ctrl**');
      expect(result).toContain('"ctrl"');
      expect(result).toContain('Platform: Windows');
    });

    it('uses Ctrl for Linux', () => {
      const result = generateGuiAgentSystemPrompt({ ...baseParams, platform: 'linux' });
      expect(result).toContain('Primary modifier key: **Ctrl**');
      expect(result).toContain('"ctrl"');
      expect(result).toContain('Platform: Linux');
    });
  });

  it('uses the correct port in all curl examples', () => {
    const result = generateGuiAgentSystemPrompt({ ...baseParams, port: 12345 });
    // All URLs should use the custom port
    expect(result).toContain('http://127.0.0.1:12345');
    expect(result).not.toContain('http://127.0.0.1:60010');
  });

  it('includes all input action types', () => {
    const result = generateGuiAgentSystemPrompt(baseParams);
    expect(result).toContain('mouse_move');
    expect(result).toContain('mouse_click');
    expect(result).toContain('mouse_double_click');
    expect(result).toContain('mouse_drag');
    expect(result).toContain('mouse_scroll');
    expect(result).toContain('keyboard_type');
    expect(result).toContain('keyboard_press');
    expect(result).toContain('keyboard_hotkey');
  });
});
