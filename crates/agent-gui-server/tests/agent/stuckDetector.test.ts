/**
 * Tests for StuckDetector.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StuckDetector } from '../../src/agent/stuckDetector.js';
import sharp from 'sharp';

/** Create a solid-color 64x64 image as base64 */
async function createSolidImage(r: number, g: number, b: number): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

describe('StuckDetector', () => {
  let detector: StuckDetector;

  beforeEach(() => {
    detector = new StuckDetector(3, 0.05);
  });

  it('should not report stuck on first check', async () => {
    const img = await createSolidImage(128, 128, 128);
    const result = await detector.check(img);
    expect(result.stuck).toBe(false);
    expect(result.consecutiveSimilar).toBe(0);
  });

  it('should not report stuck with different images', async () => {
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ] as const;

    for (const [r, g, b] of colors) {
      const img = await createSolidImage(r, g, b);
      const result = await detector.check(img);
      expect(result.stuck).toBe(false);
    }
  });

  it('should report stuck after threshold consecutive identical images', async () => {
    const img = await createSolidImage(100, 100, 100);

    // First check — no previous to compare
    let result = await detector.check(img);
    expect(result.stuck).toBe(false);

    // 2nd check — consecutiveSimilar = 1
    result = await detector.check(img);
    expect(result.consecutiveSimilar).toBe(1);
    expect(result.stuck).toBe(false);

    // 3rd check — consecutiveSimilar = 2
    result = await detector.check(img);
    expect(result.consecutiveSimilar).toBe(2);
    expect(result.stuck).toBe(false);

    // 4th check — consecutiveSimilar = 3 >= threshold
    result = await detector.check(img);
    expect(result.consecutiveSimilar).toBe(3);
    expect(result.stuck).toBe(true);
  });

  it('should reset consecutive count when a different image appears', async () => {
    const imgA = await createSolidImage(100, 100, 100);
    const imgB = await createSolidImage(200, 50, 50);

    await detector.check(imgA);
    await detector.check(imgA); // consecutiveSimilar = 1
    await detector.check(imgA); // consecutiveSimilar = 2

    // Different image breaks the streak
    const result = await detector.check(imgB);
    expect(result.consecutiveSimilar).toBe(0);
    expect(result.stuck).toBe(false);
  });

  it('should reset state via reset()', async () => {
    const img = await createSolidImage(100, 100, 100);

    await detector.check(img);
    await detector.check(img);
    await detector.check(img);

    detector.reset();

    const result = await detector.check(img);
    expect(result.consecutiveSimilar).toBe(0);
    expect(result.stuck).toBe(false);
  });

  it('should respect custom threshold', async () => {
    const customDetector = new StuckDetector(2, 0.05);
    const img = await createSolidImage(50, 50, 50);

    await customDetector.check(img);
    await customDetector.check(img); // consecutiveSimilar = 1
    const result = await customDetector.check(img); // consecutiveSimilar = 2 >= threshold=2
    expect(result.stuck).toBe(true);
  });
});
