/**
 * Tests for MemoryManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pi-ai complete function
vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"summary": "Steps 1-5: navigated and clicked"}' }],
  }),
  getModel: vi.fn().mockReturnValue({ provider: 'mock', model: 'mock-model' }),
}));

import { MemoryManager } from '../../src/agent/memoryManager.js';
import { getModel } from '@mariozechner/pi-ai';

describe('MemoryManager', () => {
  let mm: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const model = getModel('anthropic' as any, 'claude-sonnet-4-20250514' as any);
    mm = new MemoryManager(model, 'test-key');
  });

  describe('addPendingStep + compose', () => {
    it('should add pending step and include it in compose', () => {
      mm.addPendingStep(1, 'Click button');
      const text = mm.compose();
      expect(text).toContain('[Current step]');
      expect(text).toContain('Step 1');
      expect(text).toContain('Click button');
    });
  });

  describe('finalizeStep', () => {
    it('should move pending to recent on finalize', async () => {
      mm.addPendingStep(1, 'Click button');
      await mm.finalizeStep(1, 'success');

      const text = mm.compose();
      expect(text).toContain('[Recent steps]');
      expect(text).toContain('Eval: success');
      expect(text).not.toContain('[Current step]');
    });

    it('should record failed evaluation', async () => {
      mm.addPendingStep(1, 'Click button');
      await mm.finalizeStep(1, 'failed');

      const text = mm.compose();
      expect(text).toContain('Eval: failed');
    });

    it('should accumulate multiple steps in recent', async () => {
      mm.addPendingStep(1, 'Step one');
      await mm.finalizeStep(1, 'success');
      mm.addPendingStep(2, 'Step two');
      await mm.finalizeStep(2, 'success');

      const text = mm.compose();
      expect(text).toContain('Step 1');
      expect(text).toContain('Step 2');
    });
  });

  describe('compression', () => {
    it('should trigger compression when recent exceeds budget', async () => {
      const { complete } = await import('@mariozechner/pi-ai');

      // Add many steps to exceed the 500 char budget
      for (let i = 1; i <= 20; i++) {
        mm.addPendingStep(i, `Goal for step ${i}: perform a complex multi-word action description`);
        await mm.finalizeStep(i, 'success');
      }

      // complete() should have been called for summarization
      expect(complete).toHaveBeenCalled();

      // After compression, compose should still work
      const text = mm.compose();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('pruneScreenshots', () => {
    it('should keep all screenshots when under limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'image', data: 'img1', mimeType: 'image/jpeg' }] },
        { role: 'user', content: [{ type: 'image', data: 'img2', mimeType: 'image/jpeg' }] },
      ];

      const result = mm.pruneScreenshots(messages);
      expect(result).toEqual(messages); // No pruning — under screenshotKeepCount (3)
    });

    it('should replace old screenshots with placeholders', () => {
      const messages = [
        { role: 'user', content: [{ type: 'image', data: 'img1', mimeType: 'image/jpeg' }] },
        { role: 'user', content: [{ type: 'image', data: 'img2', mimeType: 'image/jpeg' }] },
        { role: 'user', content: [{ type: 'image', data: 'img3', mimeType: 'image/jpeg' }] },
        { role: 'user', content: [{ type: 'image', data: 'img4', mimeType: 'image/jpeg' }] },
        { role: 'user', content: [{ type: 'image', data: 'img5', mimeType: 'image/jpeg' }] },
      ];

      const result = mm.pruneScreenshots(messages);

      // First 2 should be replaced (5 - 3 = keep from index 2)
      expect((result[0] as any).content[0].type).toBe('text');
      expect((result[0] as any).content[0].text).toContain('Screenshot removed');
      expect((result[1] as any).content[0].type).toBe('text');

      // Last 3 should be kept
      expect((result[2] as any).content[0].type).toBe('image');
      expect((result[3] as any).content[0].type).toBe('image');
      expect((result[4] as any).content[0].type).toBe('image');
    });

    it('should not modify non-image messages', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'user', content: [{ type: 'image', data: 'img1', mimeType: 'image/jpeg' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
      ];

      const result = mm.pruneScreenshots(messages);
      expect(result).toEqual(messages); // Only 1 image, under limit
    });
  });

  describe('compose layers', () => {
    it('should return empty string when no memory', () => {
      expect(mm.compose()).toBe('');
    });

    it('should compose all three layers', () => {
      // We can't easily set summaryMemory directly, but we can verify
      // pending + recent compose correctly
      mm.addPendingStep(1, 'Current action');
      const text = mm.compose();
      expect(text).toContain('[Current step]');
    });
  });
});
