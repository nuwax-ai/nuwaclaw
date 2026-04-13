/**
 * T2.2 — modelProfiles unit tests
 *
 * Covers: 7 model rules + fallback + coordinateOrder + override
 */

import { describe, it, expect } from 'vitest';
import { getModelProfile } from '../../src/coordinates/modelProfiles.js';

describe('getModelProfile', () => {
  describe('model matching', () => {
    it('claude models → image-absolute, xy', () => {
      const profile = getModelProfile('claude-sonnet-4-20250514');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('claude-opus → image-absolute, xy', () => {
      const profile = getModelProfile('claude-opus-4-1');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('gpt-4o → image-absolute, xy', () => {
      const profile = getModelProfile('gpt-4o-2024-05-13');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('gpt-5 → image-absolute, xy', () => {
      const profile = getModelProfile('gpt-5-turbo');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('gemini → normalized-999, yx', () => {
      const profile = getModelProfile('gemini-2.5-pro');
      expect(profile.coordinateMode).toBe('normalized-999');
      expect(profile.coordinateOrder).toBe('yx');
    });

    it('gemini-2.5-flash → normalized-999, yx', () => {
      const profile = getModelProfile('gemini-2.5-flash');
      expect(profile.coordinateMode).toBe('normalized-999');
      expect(profile.coordinateOrder).toBe('yx');
    });

    it('ui-tars → normalized-1000, xy', () => {
      const profile = getModelProfile('ui-tars-1.0');
      expect(profile.coordinateMode).toBe('normalized-1000');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('qwen2.5-vl → image-absolute, xy', () => {
      const profile = getModelProfile('qwen2.5-vl-7b');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('qwen-vl → image-absolute, xy', () => {
      const profile = getModelProfile('qwen-vl-plus');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('cogagent → image-absolute, xy', () => {
      const profile = getModelProfile('cogagent-18b');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('seeclick → normalized-0-1, xy', () => {
      const profile = getModelProfile('seeclick-v2');
      expect(profile.coordinateMode).toBe('normalized-0-1');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('showui → normalized-0-1, xy', () => {
      const profile = getModelProfile('showui-large');
      expect(profile.coordinateMode).toBe('normalized-0-1');
      expect(profile.coordinateOrder).toBe('xy');
    });
  });

  describe('fallback', () => {
    it('unknown model → image-absolute, xy', () => {
      const profile = getModelProfile('some-unknown-model');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });

    it('empty string → image-absolute, xy', () => {
      const profile = getModelProfile('');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('xy');
    });
  });

  describe('coordinateOrder', () => {
    it('only Gemini has yx order', () => {
      const models = [
        'claude-sonnet-4-20250514', 'gpt-4o', 'ui-tars-1.0',
        'qwen2.5-vl-7b', 'cogagent-18b', 'seeclick-v2', 'showui-large',
      ];
      for (const model of models) {
        expect(getModelProfile(model).coordinateOrder).toBe('xy');
      }
      expect(getModelProfile('gemini-2.5-pro').coordinateOrder).toBe('yx');
    });
  });

  describe('override mode', () => {
    it('overrides coordinateMode but keeps coordinateOrder', () => {
      const profile = getModelProfile('gemini-2.5-pro', 'image-absolute');
      expect(profile.coordinateMode).toBe('image-absolute');
      expect(profile.coordinateOrder).toBe('yx'); // Gemini order preserved
    });

    it('overrides coordinateMode for Claude', () => {
      const profile = getModelProfile('claude-sonnet-4-20250514', 'normalized-1000');
      expect(profile.coordinateMode).toBe('normalized-1000');
      expect(profile.coordinateOrder).toBe('xy');
    });
  });

  describe('case insensitivity', () => {
    it('matches case-insensitively', () => {
      const profile = getModelProfile('Claude-Sonnet-4-20250514');
      expect(profile.coordinateMode).toBe('image-absolute');
    });

    it('matches GEMINI uppercase', () => {
      const profile = getModelProfile('GEMINI-2.5-PRO');
      expect(profile.coordinateMode).toBe('normalized-999');
      expect(profile.coordinateOrder).toBe('yx');
    });
  });
});
