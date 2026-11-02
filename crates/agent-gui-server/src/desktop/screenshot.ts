/**
 * Screenshot pipeline: capture → scale → JPEG → base64
 *
 * 1. nut.js screen.capture() at physical resolution
 * 2. sharp resize to logical resolution (absorb scaleFactor)
 * 3. If longest edge > 1920, proportionally scale to 1920
 * 4. JPEG encode with configurable quality
 * 5. Return base64 + metadata
 */

import sharp from 'sharp';
import { getDisplay } from './display.js';
import { DesktopError } from '../utils/errors.js';
import { logInfo, logDebug } from '../utils/logger.js';

const MAX_LONGEST_EDGE = 1920;
const MAX_JPEG_BYTES = 1_500_000; // 1.5 MB hard limit for LLM input
const QUALITY_RETRY_STEPS = [60, 45, 30]; // Fallback quality levels

export interface ScreenshotResult {
  /** Base64-encoded JPEG image */
  image: string;
  mimeType: 'image/jpeg';
  /** Byte size of the JPEG */
  imageBytes: number;
  /** Width of the final image sent to LLM */
  imageWidth: number;
  /** Height of the final image sent to LLM */
  imageHeight: number;
  /** Logical display width */
  logicalWidth: number;
  /** Logical display height */
  logicalHeight: number;
  /** Physical capture width */
  physicalWidth: number;
  /** Physical capture height */
  physicalHeight: number;
  /** Display scale factor */
  scaleFactor: number;
  /** Which display was captured */
  displayIndex: number;
}

export async function captureScreenshot(displayIndex: number, jpegQuality: number = 75): Promise<ScreenshotResult> {
  try {
    const display = await getDisplay(displayIndex);
    const { screen } = await import('@nut-tree-fork/nut-js');

    // Capture raw RGBA buffer at physical resolution
    const { Region } = await import('@nut-tree-fork/nut-js');
    const region = new Region(display.origin.x, display.origin.y, display.width, display.height);

    const captured = await screen.grabRegion(region);
    const physicalWidth = captured.width;
    const physicalHeight = captured.height;
    const rawBuffer = captured.data;

    // Logical resolution (absorb scaleFactor)
    const scaleFactor = display.scaleFactor;
    let logicalWidth = Math.round(physicalWidth / scaleFactor);
    let logicalHeight = Math.round(physicalHeight / scaleFactor);

    // Target dimensions: start with logical
    let targetWidth = logicalWidth;
    let targetHeight = logicalHeight;

    // If longest edge > MAX, proportionally scale down
    const longestEdge = Math.max(targetWidth, targetHeight);
    if (longestEdge > MAX_LONGEST_EDGE) {
      const scale = MAX_LONGEST_EDGE / longestEdge;
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    // Resize + JPEG encode
    const sharpInstance = sharp(rawBuffer, {
      raw: { width: physicalWidth, height: physicalHeight, channels: 4 },
    }).resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

    let jpegBuffer = await sharpInstance.clone().jpeg({ quality: jpegQuality }).toBuffer();

    // Quality degradation retry — if bytes exceed limit, retry with lower quality
    if (jpegBuffer.length > MAX_JPEG_BYTES) {
      for (const retryQuality of QUALITY_RETRY_STEPS) {
        if (retryQuality >= jpegQuality) continue; // Skip if not lower than current
        logDebug(`Screenshot ${jpegBuffer.length} bytes exceeds ${MAX_JPEG_BYTES}, retrying with quality=${retryQuality}`);
        jpegBuffer = await sharpInstance.clone().jpeg({ quality: retryQuality }).toBuffer();
        if (jpegBuffer.length <= MAX_JPEG_BYTES) break;
      }
    }

    const base64 = jpegBuffer.toString('base64');

    logDebug(`Screenshot: ${physicalWidth}x${physicalHeight} → ${targetWidth}x${targetHeight}, ${jpegBuffer.length} bytes`);

    return {
      image: base64,
      mimeType: 'image/jpeg',
      imageBytes: jpegBuffer.length,
      imageWidth: targetWidth,
      imageHeight: targetHeight,
      logicalWidth,
      logicalHeight,
      physicalWidth,
      physicalHeight,
      scaleFactor,
      displayIndex,
    };
  } catch (err) {
    if (err instanceof DesktopError) throw err;
    throw new DesktopError('captureScreenshot', err instanceof Error ? err : new Error(String(err)));
  }
}
