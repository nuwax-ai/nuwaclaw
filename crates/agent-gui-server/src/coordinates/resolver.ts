/**
 * CoordinateResolver: model coordinates → logical coordinates → global coordinates.
 *
 * Pure function, zero I/O, highly testable.
 * Implements the 4-step conversion pipeline.
 */

import { type CoordinateMode, type CoordinateOrder, type ModelProfile } from './modelProfiles.js';
import { logWarn } from '../utils/logger.js';

export interface ScreenshotMeta {
  /** Width of the screenshot image sent to the LLM */
  imageWidth: number;
  /** Height of the screenshot image sent to the LLM */
  imageHeight: number;
  /** Logical width of the display */
  logicalWidth: number;
  /** Logical height of the display */
  logicalHeight: number;
}

export interface DisplayInfo {
  /** Global origin of this display (in logical coordinates) */
  origin: { x: number; y: number };
  /** Display bounds (in logical coordinates) */
  bounds: { width: number; height: number };
  /** Display scale factor (1 for standard, 2 for Retina/HiDPI) */
  scaleFactor?: number;
}

export interface ResolvedCoordinate {
  /** Global X coordinate (for nut.js) */
  globalX: number;
  /** Global Y coordinate (for nut.js) */
  globalY: number;
  /** Local X within the display */
  localX: number;
  /** Local Y within the display */
  localY: number;
  /** Normalized X (0-1) */
  normalizedX: number;
  /** Normalized Y (0-1) */
  normalizedY: number;
}

/**
 * Resolve model coordinates to global screen coordinates.
 *
 * 4-step pipeline:
 * 1. Coordinate order correction (yx swap for Gemini)
 * 2. Normalize to 0-1 based on coordinateMode
 * 3. Logical coordinate = norm × logicalWidth/Height
 * 4. Physical coordinate = logical × scaleFactor (for Retina/HiDPI)
 * 5. Global offset = physical + display.origin × scaleFactor
 */
export function resolveCoordinate(
  modelX: number,
  modelY: number,
  profile: ModelProfile,
  meta: ScreenshotMeta,
  display: DisplayInfo,
): ResolvedCoordinate {
  // Step 1: Coordinate order correction
  let rawX: number;
  let rawY: number;
  if (profile.coordinateOrder === 'yx') {
    rawX = modelY;
    rawY = modelX;
  } else {
    rawX = modelX;
    rawY = modelY;
  }

  // Step 2: Normalize to 0-1
  const normalizedX = normalize(rawX, profile.coordinateMode, meta.imageWidth);
  const normalizedY = normalize(rawY, profile.coordinateMode, meta.imageHeight);

  // Step 3: Logical coordinates
  const localX = Math.round(normalizedX * meta.logicalWidth);
  const localY = Math.round(normalizedY * meta.logicalHeight);

  // Step 4: Convert to physical coordinates (for Retina/HiDPI displays)
  // nut.js uses physical pixels, not logical points
  const scaleFactor = display.scaleFactor ?? 1;
  const physicalX = localX * scaleFactor;
  const physicalY = localY * scaleFactor;

  // Step 5: Global offset (in physical coordinates)
  let globalX = physicalX + display.origin.x * scaleFactor;
  let globalY = physicalY + display.origin.y * scaleFactor;

  // Boundary clamp (in physical coordinates)
  const minX = display.origin.x * scaleFactor;
  const minY = display.origin.y * scaleFactor;
  const maxX = (display.origin.x + display.bounds.width) * scaleFactor - 1;
  const maxY = (display.origin.y + display.bounds.height) * scaleFactor - 1;

  if (globalX < minX || globalX > maxX || globalY < minY || globalY > maxY) {
    logWarn(`Coordinate out of bounds: (${globalX}, ${globalY}) clamped to display [${minX}-${maxX}, ${minY}-${maxY}]`);
    globalX = Math.max(minX, Math.min(maxX, globalX));
    globalY = Math.max(minY, Math.min(maxY, globalY));
  }

  return { globalX, globalY, localX, localY, normalizedX, normalizedY };
}

function normalize(value: number, mode: CoordinateMode, imageDimension: number): number {
  switch (mode) {
    case 'image-absolute':
      return imageDimension > 0 ? value / imageDimension : 0;
    case 'normalized-1000':
      return value / 1000;
    case 'normalized-999':
      return value / 999;
    case 'normalized-0-1':
      return value;
  }
}
