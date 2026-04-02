/**
 * Image search wrapper around nut.js template matcher.
 *
 * Uses nut.js screen.find() with configurable confidence threshold.
 * Temp file is written once and reused across poll iterations.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesktopError } from '../utils/errors.js';

export interface ImageSearchResult {
  found: boolean;
  region?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface WaitForImageResult extends ImageSearchResult {
  elapsed: number;
}

/**
 * Find an image on screen by template matching.
 */
export async function findImage(templateBase64: string, confidence: number = 0.9): Promise<ImageSearchResult> {
  try {
    const { screen, loadImage } = await import('@nut-tree-fork/nut-js');

    // Write template to temp file (async)
    const tmpFile = path.join(os.tmpdir(), `gui-agent-template-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fs.writeFile(tmpFile, Buffer.from(templateBase64, 'base64'));

    try {
      const templateImage = await loadImage(tmpFile);

      // Set confidence on the screen finder
      screen.config.confidence = confidence;

      const result = await screen.find(templateImage);
      return {
        found: true,
        region: {
          x: result.left,
          y: result.top,
          width: result.width,
          height: result.height,
        },
        confidence,
      };
    } catch {
      return { found: false };
    } finally {
      try { await fs.unlink(tmpFile); } catch { /* ignore */ }
    }
  } catch (err) {
    if (err instanceof DesktopError) throw err;
    throw new DesktopError('imageSearch.findImage', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Find an image using an already-written temp file path.
 * Used internally by waitForImage to avoid re-writing the file on each poll.
 */
async function findImageFromFile(tmpFile: string, confidence: number): Promise<ImageSearchResult> {
  const { screen, loadImage } = await import('@nut-tree-fork/nut-js');
  const templateImage = await loadImage(tmpFile);
  screen.config.confidence = confidence;

  try {
    const result = await screen.find(templateImage);
    return {
      found: true,
      region: {
        x: result.left,
        y: result.top,
        width: result.width,
        height: result.height,
      },
      confidence,
    };
  } catch {
    return { found: false };
  }
}

/**
 * Wait for an image to appear on screen with timeout.
 * Writes the template to a temp file once and reuses it across polls.
 */
export async function waitForImage(
  templateBase64: string,
  timeout: number = 10000,
  confidence: number = 0.9,
): Promise<WaitForImageResult> {
  const start = Date.now();
  const pollInterval = 500;

  // Write temp file once, reuse across polls
  const tmpFile = path.join(os.tmpdir(), `gui-agent-wait-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await fs.writeFile(tmpFile, Buffer.from(templateBase64, 'base64'));

  try {
    while (Date.now() - start < timeout) {
      try {
        const result = await findImageFromFile(tmpFile, confidence);
        if (result.found) {
          return { ...result, elapsed: Date.now() - start };
        }
      } catch {
        // Individual poll failure is non-fatal
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return { found: false, elapsed: Date.now() - start };
  } finally {
    try { await fs.unlink(tmpFile); } catch { /* ignore */ }
  }
}
