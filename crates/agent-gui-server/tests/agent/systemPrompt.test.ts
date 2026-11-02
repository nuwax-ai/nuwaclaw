/**
 * Unit tests for agent/systemPrompt.ts — buildSystemPrompt.
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('includes the task text', () => {
    const prompt = buildSystemPrompt('Open Finder', '');
    expect(prompt).toContain('Open Finder');
  });

  it('includes all 7 tool names', () => {
    const prompt = buildSystemPrompt('test', '');
    expect(prompt).toContain('computer_screenshot');
    expect(prompt).toContain('computer_click');
    expect(prompt).toContain('computer_type');
    expect(prompt).toContain('computer_scroll');
    expect(prompt).toContain('computer_hotkey');
    expect(prompt).toContain('computer_wait');
    expect(prompt).toContain('computer_done');
  });

  it('includes memory section when memory text is provided', () => {
    const prompt = buildSystemPrompt('task', 'Step 1: clicked button\nStep 2: typed text');
    expect(prompt).toContain('Previous Actions Memory');
    expect(prompt).toContain('Step 1: clicked button');
    expect(prompt).toContain('Step 2: typed text');
  });

  it('does not include memory section when memory text is empty', () => {
    const prompt = buildSystemPrompt('task', '');
    expect(prompt).not.toContain('Previous Actions Memory');
  });

  it('contains workflow guidance', () => {
    const prompt = buildSystemPrompt('task', '');
    expect(prompt).toContain('Workflow');
    expect(prompt).toContain('screenshot');
  });

  it('contains guidelines about popups and errors', () => {
    const prompt = buildSystemPrompt('task', '');
    expect(prompt).toContain('dialog');
    expect(prompt).toContain('popup');
  });

  it('includes CJK task text correctly', () => {
    const prompt = buildSystemPrompt('打开访达并创建新文件夹', '');
    expect(prompt).toContain('打开访达并创建新文件夹');
  });
});
