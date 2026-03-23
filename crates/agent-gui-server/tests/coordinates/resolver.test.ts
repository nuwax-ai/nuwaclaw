/**
 * T2.1 — CoordinateResolver unit tests
 *
 * Covers: 4 coordinate modes × Gemini yx swap × Retina/HiDPI × multi-display offset × boundary clamp
 */

import { describe, it, expect } from 'vitest';
import { resolveCoordinate, type ScreenshotMeta, type DisplayInfo } from '../../src/coordinates/resolver.js';
import type { ModelProfile } from '../../src/coordinates/modelProfiles.js';

// --- Helpers ---

const primaryDisplay: DisplayInfo = { origin: { x: 0, y: 0 }, bounds: { width: 1920, height: 1080 } };
const secondaryDisplay: DisplayInfo = { origin: { x: -2560, y: 0 }, bounds: { width: 2560, height: 1440 } };
const retinaMeta: ScreenshotMeta = { imageWidth: 1440, imageHeight: 900, logicalWidth: 1440, logicalHeight: 900 };
const fullHdMeta: ScreenshotMeta = { imageWidth: 1920, imageHeight: 1080, logicalWidth: 1920, logicalHeight: 1080 };

const xyProfile = (mode: ModelProfile['coordinateMode']): ModelProfile => ({ coordinateMode: mode, coordinateOrder: 'xy' });
const geminiProfile: ModelProfile = { coordinateMode: 'normalized-999', coordinateOrder: 'yx' };

// --- Tests ---

describe('resolveCoordinate', () => {
  describe('image-absolute mode', () => {
    it('converts absolute pixel coordinates on 1920x1080', () => {
      const result = resolveCoordinate(960, 540, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(960);
      expect(result.globalY).toBe(540);
      expect(result.normalizedX).toBeCloseTo(0.5, 2);
      expect(result.normalizedY).toBeCloseTo(0.5, 2);
    });

    it('handles top-left corner (0, 0)', () => {
      const result = resolveCoordinate(0, 0, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(0);
      expect(result.globalY).toBe(0);
    });

    it('handles bottom-right corner', () => {
      const result = resolveCoordinate(1920, 1080, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      // 1920/1920 * 1920 = 1920, clamped to bounds.width-1 = 1919
      expect(result.globalX).toBe(1919);
      expect(result.globalY).toBe(1079);
    });
  });

  describe('normalized-1000 mode', () => {
    it('converts 500, 500 → center of display', () => {
      const result = resolveCoordinate(500, 500, xyProfile('normalized-1000'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(960);
      expect(result.globalY).toBe(540);
    });

    it('converts 0, 0 → top-left', () => {
      const result = resolveCoordinate(0, 0, xyProfile('normalized-1000'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(0);
      expect(result.globalY).toBe(0);
    });

    it('converts 1000, 1000 → bottom-right (clamped)', () => {
      const result = resolveCoordinate(1000, 1000, xyProfile('normalized-1000'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(1919);
      expect(result.globalY).toBe(1079);
    });
  });

  describe('normalized-999 mode', () => {
    it('converts 499, 499 → approximate center', () => {
      const result = resolveCoordinate(499, 499, xyProfile('normalized-999'), fullHdMeta, primaryDisplay);
      // 499/999 ≈ 0.4995 → 0.4995 * 1920 ≈ 959
      expect(result.globalX).toBeGreaterThanOrEqual(958);
      expect(result.globalX).toBeLessThanOrEqual(960);
    });
  });

  describe('normalized-0-1 mode', () => {
    it('converts 0.5, 0.5 → center', () => {
      const result = resolveCoordinate(0.5, 0.5, xyProfile('normalized-0-1'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(960);
      expect(result.globalY).toBe(540);
    });

    it('converts 0, 0 → top-left', () => {
      const result = resolveCoordinate(0, 0, xyProfile('normalized-0-1'), fullHdMeta, primaryDisplay);
      expect(result.globalX).toBe(0);
      expect(result.globalY).toBe(0);
    });
  });

  describe('Gemini yx coordinate order swap', () => {
    it('swaps yx to xy before normalization', () => {
      // Gemini outputs [y, x] = [499, 200] → should become rawX=200, rawY=499
      const result = resolveCoordinate(499, 200, geminiProfile, fullHdMeta, primaryDisplay);
      // rawX = 200 (from modelY), rawY = 499 (from modelX)
      // normX = 200/999 ≈ 0.2002, normY = 499/999 ≈ 0.4995
      // localX = 0.2002 * 1920 ≈ 384, localY = 0.4995 * 1080 ≈ 539
      expect(result.normalizedX).toBeCloseTo(200 / 999, 3);
      expect(result.normalizedY).toBeCloseTo(499 / 999, 3);
      expect(result.globalX).toBeGreaterThanOrEqual(383);
      expect(result.globalX).toBeLessThanOrEqual(385);
    });

    it('Gemini center point [500, 500] should still map to center', () => {
      // [y=500, x=500] → swap → rawX=500, rawY=500
      const result = resolveCoordinate(500, 500, geminiProfile, fullHdMeta, primaryDisplay);
      expect(result.normalizedX).toBeCloseTo(500 / 999, 3);
      expect(result.normalizedY).toBeCloseTo(500 / 999, 3);
    });
  });

  describe('Retina display (scaleFactor absorbed at screenshot level)', () => {
    // Retina: physical 2880x1800, scaleFactor=2, logical 1440x900
    // After screenshot pipeline: imageWidth=1440, imageHeight=900 (already logical)
    // logicalWidth=1440, logicalHeight=900
    it('converts center on Retina display (image-absolute)', () => {
      const result = resolveCoordinate(720, 450, xyProfile('image-absolute'), retinaMeta, {
        origin: { x: 0, y: 0 },
        bounds: { width: 1440, height: 900 },
      });
      expect(result.globalX).toBe(720);
      expect(result.globalY).toBe(450);
      expect(result.normalizedX).toBeCloseTo(0.5, 2);
      expect(result.normalizedY).toBeCloseTo(0.5, 2);
    });
  });

  describe('HiDPI Windows (scaleFactor=1.5)', () => {
    // Physical 2880x1620, scaleFactor=1.5, logical 1920x1080
    // Screenshot pipeline outputs imageWidth=1920, imageHeight=1080
    const hidpiMeta: ScreenshotMeta = { imageWidth: 1920, imageHeight: 1080, logicalWidth: 1920, logicalHeight: 1080 };

    it('converts absolute coords on HiDPI display', () => {
      const result = resolveCoordinate(960, 540, xyProfile('image-absolute'), hidpiMeta, primaryDisplay);
      expect(result.globalX).toBe(960);
      expect(result.globalY).toBe(540);
    });
  });

  describe('multi-display offset', () => {
    it('applies negative origin offset for secondary display on left', () => {
      // Secondary display at origin (-2560, 0), 2560x1440
      const meta: ScreenshotMeta = { imageWidth: 1920, imageHeight: 1080, logicalWidth: 2560, logicalHeight: 1440 };
      const result = resolveCoordinate(960, 540, xyProfile('image-absolute'), meta, secondaryDisplay);
      // normX = 960/1920 = 0.5, localX = 0.5 * 2560 = 1280
      // globalX = 1280 + (-2560) = -1280
      expect(result.localX).toBe(1280);
      expect(result.globalX).toBe(-1280);
      expect(result.localY).toBe(720);
      expect(result.globalY).toBe(720);
    });

    it('primary display has zero offset', () => {
      const result = resolveCoordinate(100, 100, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      expect(result.localX).toBe(result.globalX);
      expect(result.localY).toBe(result.globalY);
    });
  });

  describe('boundary clamp', () => {
    it('clamps coordinates exceeding display bounds', () => {
      // Send coordinates beyond the display
      const result = resolveCoordinate(2500, 1500, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      // normX = 2500/1920 ≈ 1.302, localX = 1.302 * 1920 ≈ 2500 → clamped to 1919
      expect(result.globalX).toBe(1919);
      expect(result.globalY).toBe(1079);
    });

    it('clamps negative coordinates', () => {
      const result = resolveCoordinate(-100, -100, xyProfile('image-absolute'), fullHdMeta, primaryDisplay);
      // normX = -100/1920 < 0, localX < 0 → clamped to 0
      expect(result.globalX).toBe(0);
      expect(result.globalY).toBe(0);
    });
  });
});
