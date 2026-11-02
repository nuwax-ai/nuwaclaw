/**
 * Display information provider.
 *
 * Uses platform-specific APIs for accurate scaleFactor and multi-display support:
 * - macOS: CoreGraphics via child_process (system_profiler or screen capture metadata)
 * - Windows/Linux: nut.js fallback with scaleFactor detection
 *
 * Falls back to nut.js single-display when platform APIs are unavailable.
 */

import { DesktopError } from '../utils/errors.js';
import { getPlatform } from '../utils/platform.js';
import { logInfo, logDebug, logWarn } from '../utils/logger.js';

export interface DisplayDescriptor {
  index: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
  origin: { x: number; y: number };
}

/**
 * List all connected displays with accurate metadata.
 */
export async function listDisplays(): Promise<DisplayDescriptor[]> {
  try {
    const platform = getPlatform();

    if (platform === 'macos') {
      return await listDisplaysMacOS();
    }

    // Windows/Linux: use nut.js with scaleFactor detection
    return await listDisplaysFallback();
  } catch (err) {
    logWarn(`Platform-specific display detection failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
    return await listDisplaysFallback();
  }
}

/**
 * macOS: Use system_profiler to enumerate displays with scaleFactor.
 */
async function listDisplaysMacOS(): Promise<DisplayDescriptor[]> {
  const { execSync } = await import('child_process');

  try {
    const output = execSync(
      'system_profiler SPDisplaysDataType -json',
      { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const data = JSON.parse(output);
    const displays: DisplayDescriptor[] = [];

    const gpus = data.SPDisplaysDataType || [];
    for (const gpu of gpus) {
      const ndrvs = gpu.spdisplays_ndrvs || [];
      for (const disp of ndrvs) {
        // Parse resolution string like "1440 x 900 @ 60.00Hz" or "2560 x 1440"
        const resStr: string = disp._spdisplays_resolution || disp.spdisplays_resolution || '';
        const retinaStr: string = disp.spdisplays_retina || '';
        const isRetina = retinaStr.toLowerCase().includes('yes');

        // Parse pixel resolution
        const pixelRes: string = disp._spdisplays_pixels || disp.spdisplays_pixels || '';
        let physicalWidth = 0;
        let physicalHeight = 0;
        const pixMatch = pixelRes.match(/(\d+)\s*x\s*(\d+)/);
        if (pixMatch) {
          physicalWidth = parseInt(pixMatch[1], 10);
          physicalHeight = parseInt(pixMatch[2], 10);
        }

        // Parse logical resolution
        let logicalWidth = 0;
        let logicalHeight = 0;
        const resMatch = resStr.match(/(\d+)\s*x\s*(\d+)/);
        if (resMatch) {
          logicalWidth = parseInt(resMatch[1], 10);
          logicalHeight = parseInt(resMatch[2], 10);
        }

        // Calculate scaleFactor
        let scaleFactor = 1;
        if (physicalWidth > 0 && logicalWidth > 0) {
          scaleFactor = Math.round(physicalWidth / logicalWidth);
        } else if (isRetina) {
          scaleFactor = 2;
        }

        // Use logical resolution (or fall back to physical if no logical)
        const width = logicalWidth || physicalWidth;
        const height = logicalHeight || physicalHeight;

        if (width > 0 && height > 0) {
          const isPrimary = disp.spdisplays_main === 'spdisplays_yes' ||
            disp._spdisplays_displayID === '1' ||
            displays.length === 0;

          displays.push({
            index: displays.length,
            label: disp._name || `Display ${displays.length}`,
            width,
            height,
            scaleFactor,
            isPrimary,
            origin: { x: 0, y: 0 }, // macOS manages global offsets; nut.js uses logical
          });
        }
      }
    }

    if (displays.length > 0) {
      logInfo(`Detected ${displays.length} display(s) via system_profiler`);
      for (const d of displays) {
        logDebug(`Display ${d.index}: ${d.width}x${d.height} @${d.scaleFactor}x "${d.label}" primary=${d.isPrimary}`);
      }
      return displays;
    }
  } catch (err) {
    logDebug(`system_profiler failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fallback
  return await listDisplaysFallback();
}

/**
 * Fallback: use nut.js for basic display info with scaleFactor detection.
 */
async function listDisplaysFallback(): Promise<DisplayDescriptor[]> {
  const { screen } = await import('@nut-tree-fork/nut-js');
  const width = await screen.width();
  const height = await screen.height();

  // Detect scaleFactor: capture a small region and compare physical vs logical
  let scaleFactor = 1;
  try {
    const { Region } = await import('@nut-tree-fork/nut-js');
    const testRegion = new Region(0, 0, 10, 10);
    const capture = await screen.grabRegion(testRegion);
    // If physical capture is larger than requested logical region, we have HiDPI
    if (capture.width > 10) {
      scaleFactor = Math.round(capture.width / 10);
    }
  } catch {
    logDebug('scaleFactor detection failed, defaulting to 1');
  }

  const primary: DisplayDescriptor = {
    index: 0,
    label: 'Primary',
    width,
    height,
    scaleFactor,
    isPrimary: true,
    origin: { x: 0, y: 0 },
  };

  logInfo(`Detected display (fallback): ${width}x${height} @${scaleFactor}x`);
  return [primary];
}

/**
 * Get a specific display by index.
 */
export async function getDisplay(index: number): Promise<DisplayDescriptor> {
  const displays = await listDisplays();
  const display = displays.find(d => d.index === index);
  if (!display) {
    throw new DesktopError('getDisplay', new Error(`Display index ${index} not found (${displays.length} displays available)`));
  }
  return display;
}

/**
 * Get the primary display.
 */
export async function getPrimaryDisplay(): Promise<DisplayDescriptor> {
  const displays = await listDisplays();
  return displays.find(d => d.isPrimary) ?? displays[0];
}
