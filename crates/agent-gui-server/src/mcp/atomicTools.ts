/**
 * 14 atomic MCP tool handlers.
 *
 * Each handler: validate input → safety check → coordinate resolve → desktop operation → audit → response
 */

import type { GuiAgentConfig } from '../config.js';
import { AuditLog } from '../safety/auditLog.js';
import { validateHotkey } from '../safety/hotkeys.js';
import { resolveCoordinate, type ScreenshotMeta, type DisplayInfo } from '../coordinates/resolver.js';
import { getModelProfile } from '../coordinates/modelProfiles.js';
import { captureScreenshot } from '../desktop/screenshot.js';
import * as mouse from '../desktop/mouse.js';
import * as keyboard from '../desktop/keyboard.js';
import * as display from '../desktop/display.js';
import { findImage, waitForImage } from '../desktop/imageSearch.js';
import { analyzeScreen } from '../desktop/screenAnalyzer.js';
import { createModel } from '../agent/taskRunner.js';
import { logError } from '../utils/logger.js';
import { SafetyError } from '../utils/errors.js';

const ATOMIC_TOOLS = [
  {
    name: 'gui_screenshot',
    description: 'Capture a screenshot and return as base64 image data. WARNING: Returns raw image data that text-only models cannot interpret. For understanding screen content, use gui_analyze_screen instead. Use this tool only when you need to save or transfer the screenshot file itself.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        displayIndex: { type: 'number', description: 'Display index (default: configured display)' },
      },
    },
  },
  {
    name: 'gui_click',
    description: 'Click at the specified coordinates. Use gui_analyze_screen first to identify element locations, or gui_cursor_position to get current mouse position. Coordinates are in logical pixels (scaled automatically for Retina displays).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate in logical pixels (0 = left edge of display)' },
        y: { type: 'number', description: 'Y coordinate in logical pixels (0 = top edge of display)' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        coordinateMode: { type: 'string', description: 'Coordinate mode: "logical" (default, use logical pixel values), "image-absolute" (divide x/y by image width/height to get 0-1, then multiply by display size), "normalized-1000" (x/y in 0-1000 range, scaled to display size)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_double_click',
    description: 'Double-click at the specified coordinates. Typically used to open files or select words. Use gui_analyze_screen first to identify element locations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate in logical pixels' },
        y: { type: 'number', description: 'Y coordinate in logical pixels' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        coordinateMode: { type: 'string', description: 'Coordinate mode override' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_move_mouse',
    description: 'Move mouse cursor to the specified coordinates without clicking. Useful for hovering over elements to reveal tooltips or menus.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate in logical pixels' },
        y: { type: 'number', description: 'Y coordinate in logical pixels' },
        coordinateMode: { type: 'string', description: 'Coordinate mode override' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_drag',
    description: 'Drag from start to end coordinates. Used for dragging files, selecting text, or moving windows. Hold mouse button from start to end position.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        startX: { type: 'number', description: 'Start X coordinate in logical pixels' },
        startY: { type: 'number', description: 'Start Y coordinate in logical pixels' },
        endX: { type: 'number', description: 'End X coordinate in logical pixels' },
        endY: { type: 'number', description: 'End Y coordinate in logical pixels' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        coordinateMode: { type: 'string', description: 'Coordinate mode override' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'gui_scroll',
    description: 'Scroll at the specified position. Positive deltaY scrolls down, negative scrolls up. Used for navigating long pages or lists.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate in logical pixels' },
        y: { type: 'number', description: 'Y coordinate in logical pixels' },
        deltaY: { type: 'number', description: 'Vertical scroll amount in "steps" (scroll wheel clicks). Positive = scroll down, negative = scroll up. Typical values: 1-3 for small scroll, 5-10 for larger scroll' },
        deltaX: { type: 'number', description: 'Horizontal scroll amount in steps (positive = right, negative = left)' },
        coordinateMode: { type: 'string', description: 'Coordinate mode override' },
      },
      required: ['x', 'y', 'deltaY'],
    },
  },
  {
    name: 'gui_type',
    description: 'Type text at the current cursor position. Automatically handles CJK/non-ASCII text via clipboard paste. Use after clicking on an input field.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to type (supports all languages including Chinese, Japanese, Korean)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'gui_press_key',
    description: 'Press a single key. Supported keys: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, F1-F24. Modifiers: Shift, Control/Ctrl, Alt/Option, Meta/Command/Cmd.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Key name (e.g. Enter, Tab, Escape, ArrowUp, F1). Supports aliases like Ctrl, Cmd, Opt.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'gui_hotkey',
    description: 'Press a key combination (shortcut). Key names support aliases: Meta/Command/Cmd/⌘, Control/Ctrl/⌃, Alt/Option/Opt/⌥, Shift/⇧. Example: ["Meta", "C"] for copy, ["Meta", "V"] for paste.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'Keys to press together in order (e.g. ["Meta", "C"] for copy, ["Alt", "Tab"] for window switcher)' },
      },
      required: ['keys'],
    },
  },
  {
    name: 'gui_cursor_position',
    description: 'Get current mouse cursor position. Returns both logical coordinates (for use with gui_click) and physical coordinates (raw nut.js values). On Retina displays, logical coords are half of physical.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gui_list_displays',
    description: 'List all connected displays with their properties (resolution, scale factor, position). Use to identify which display to target.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gui_find_image',
    description: 'Find a template image on screen using image matching. DEPRECATED: For most use cases, prefer gui_analyze_screen with prompt "Find [element]" instead. Returns match location and confidence. Requires base64-encoded template image.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Base64-encoded template image to find (PNG/JPEG)' },
        confidence: { type: 'number', description: 'Match confidence threshold 0-1 (default 0.9, lower for fuzzy matching)' },
      },
      required: ['template'],
    },
  },
  {
    name: 'gui_wait_for_image',
    description: 'Wait for a template image to appear on screen. DEPRECATED: For most use cases, prefer gui_analyze_screen in a loop instead. Polls until found or timeout.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Base64-encoded template image to wait for' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 10000)' },
        confidence: { type: 'number', description: 'Match confidence threshold 0-1 (default 0.9)' },
      },
      required: ['template'],
    },
  },
  {
    name: 'gui_analyze_screen',
    description: 'Capture screenshot and analyze with vision model. Returns text description of screen content, UI elements, text, buttons, and their locations. Use this to understand what is on screen before taking action. Preferred over gui_screenshot for text-based models.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Analysis instruction (e.g., "What buttons are visible?", "Find the search box location and provide coordinates", "Is there an error dialog?", "What is the current active window?")' },
        displayIndex: { type: 'number', description: 'Display index (default: configured display)' },
      },
      required: ['prompt'],
    },
  },
];

/** Cached screenshot dimensions per display (with TTL) */
interface CachedDimensions {
  imageWidth: number;
  imageHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  timestamp: number;
}
const screenshotDimensionCache = new Map<number, CachedDimensions>();
const CACHE_TTL_MS = 5000; // 5 seconds

/** Clear the screenshot dimension cache (for testing) */
export function clearScreenshotDimensionCache(): void {
  screenshotDimensionCache.clear();
}

/** Helper: resolve coordinates for tools that accept x/y + optional coordinateMode */
async function resolveXY(
  x: number,
  y: number,
  coordinateMode: string | undefined,
  config: GuiAgentConfig,
): Promise<{ globalX: number; globalY: number; meta: ScreenshotMeta }> {
  const profile = getModelProfile(config.model, coordinateMode as any);
  const disp = await display.getDisplay(config.displayIndex);
  const displayInfo: DisplayInfo = {
    origin: disp.origin,
    bounds: { width: disp.width, height: disp.height },
    scaleFactor: disp.scaleFactor,
  };

  if (!coordinateMode) {
    // No coordinate mode specified — treat as logical coordinates directly
    // Convert to physical coordinates for nut.js (multiply by scaleFactor)
    const scaleFactor = disp.scaleFactor ?? 1;
    const meta: ScreenshotMeta = {
      imageWidth: disp.width,
      imageHeight: disp.height,
      logicalWidth: disp.width,
      logicalHeight: disp.height,
    };
    return {
      globalX: Math.round(x * scaleFactor) + disp.origin.x * scaleFactor,
      globalY: Math.round(y * scaleFactor) + disp.origin.y * scaleFactor,
      meta,
    };
  }

  // For coordinate modes (image-absolute, normalized-*), we need actual screenshot dimensions
  // because models return coordinates based on the image they saw (which may be scaled)
  // Use cached dimensions if available and fresh
  const cached = screenshotDimensionCache.get(config.displayIndex);
  const now = Date.now();

  let meta: ScreenshotMeta;
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    meta = {
      imageWidth: cached.imageWidth,
      imageHeight: cached.imageHeight,
      logicalWidth: cached.logicalWidth,
      logicalHeight: cached.logicalHeight,
    };
  } else {
    // Capture screenshot to get actual dimensions
    try {
      const shot = await captureScreenshot(config.displayIndex, config.jpegQuality);
      meta = {
        imageWidth: shot.imageWidth,
        imageHeight: shot.imageHeight,
        logicalWidth: shot.logicalWidth,
        logicalHeight: shot.logicalHeight,
      };
      // Cache the dimensions
      screenshotDimensionCache.set(config.displayIndex, {
        imageWidth: shot.imageWidth,
        imageHeight: shot.imageHeight,
        logicalWidth: shot.logicalWidth,
        logicalHeight: shot.logicalHeight,
        timestamp: now,
      });
    } catch (err) {
      // Fallback to display dimensions on screenshot failure
      logError(`Screenshot failed for coordinate resolution: ${err instanceof Error ? err.message : String(err)}`);
      meta = {
        imageWidth: disp.width,
        imageHeight: disp.height,
        logicalWidth: disp.width,
        logicalHeight: disp.height,
      };
    }
  }

  const resolved = resolveCoordinate(x, y, profile, meta, displayInfo);
  return { globalX: resolved.globalX, globalY: resolved.globalY, meta };
}

export { ATOMIC_TOOLS };

/**
 * 获取可用的工具列表
 * 如果未配置视觉模型，则不包含 gui_analyze_screen
 */
export function getAvailableTools(): typeof ATOMIC_TOOLS {
  const visionModel = process.env.GUI_AGENT_VISION_MODEL;
  if (!visionModel) {
    return ATOMIC_TOOLS.filter(t => t.name !== 'gui_analyze_screen');
  }
  return ATOMIC_TOOLS;
}

/** Validate that a value is a finite number */
function requireNumber(name: string, value: unknown): number {
  if (typeof value !== 'number' || !isFinite(value)) {
    throw new Error(`Parameter '${name}' must be a finite number, got: ${value}`);
  }
  return value;
}

/** Validate that a value is a non-empty string */
function requireString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Parameter '${name}' must be a non-empty string`);
  }
  return value;
}

/** Validate that a value is a non-empty string array */
function requireStringArray(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(v => typeof v === 'string')) {
    throw new Error(`Parameter '${name}' must be a non-empty array of strings`);
  }
  return value;
}

export async function handleAtomicToolCall(
  name: string,
  args: Record<string, unknown>,
  config: GuiAgentConfig,
  auditLog: AuditLog,
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean } | null> {
  // Check if this is an atomic tool
  if (!ATOMIC_TOOLS.some(t => t.name === name)) {
    return null; // Not handled by this module
  }

  const start = Date.now();
  try {
    const result = await handleAtomicTool(name, args, config);
    auditLog.record({ tool: name, args, success: true, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    auditLog.record({ tool: name, args, success: false, durationMs: Date.now() - start });
    logError(`Tool ${name} failed: ${errorMsg}`);
    return { content: [{ type: 'text', text: `Error: ${errorMsg}` }], isError: true };
  }
}

async function handleAtomicTool(name: string, args: Record<string, unknown>, config: GuiAgentConfig) {
  switch (name) {
    case 'gui_screenshot': {
      const idx = (args.displayIndex as number) ?? config.displayIndex;
      const shot = await captureScreenshot(idx, config.jpegQuality);
      return {
        content: [
          { type: 'image', data: shot.image, mimeType: shot.mimeType },
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              imageWidth: shot.imageWidth,
              imageHeight: shot.imageHeight,
              logicalWidth: shot.logicalWidth,
              logicalHeight: shot.logicalHeight,
              physicalWidth: shot.physicalWidth,
              physicalHeight: shot.physicalHeight,
              scaleFactor: shot.scaleFactor,
              displayIndex: shot.displayIndex,
              note: 'Image dimensions are in logical pixels. Use logical coordinates for click operations.',
            }, null, 2),
          },
        ],
      };
    }

    case 'gui_click': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const button = (args.button as string) || 'left';
      const { globalX, globalY, meta } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.click(globalX, globalY, button as any);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'click',
            button,
            logicalCoords: { x, y },
            physicalCoords: { x: globalX, y: globalY },
            displaySize: { width: meta.logicalWidth, height: meta.logicalHeight },
          }, null, 2),
        }],
      };
    }

    case 'gui_double_click': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const button = (args.button as string) || 'left';
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.doubleClick(globalX, globalY, button as any);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'double_click',
            button,
            logicalCoords: { x, y },
            physicalCoords: { x: globalX, y: globalY },
          }, null, 2),
        }],
      };
    }

    case 'gui_move_mouse': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.moveTo(globalX, globalY);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'move',
            logicalCoords: { x, y },
            physicalCoords: { x: globalX, y: globalY },
          }, null, 2),
        }],
      };
    }

    case 'gui_drag': {
      const startX = requireNumber('startX', args.startX);
      const startY = requireNumber('startY', args.startY);
      const endX = requireNumber('endX', args.endX);
      const endY = requireNumber('endY', args.endY);
      const button = (args.button as string) || 'left';
      const start = await resolveXY(startX, startY, args.coordinateMode as string, config);
      const end = await resolveXY(endX, endY, args.coordinateMode as string, config);
      await mouse.drag(start.globalX, start.globalY, end.globalX, end.globalY, button as any);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'drag',
            button,
            start: { logical: { x: startX, y: startY }, physical: { x: start.globalX, y: start.globalY } },
            end: { logical: { x: endX, y: endY }, physical: { x: end.globalX, y: end.globalY } },
          }, null, 2),
        }],
      };
    }

    case 'gui_scroll': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const deltaY = requireNumber('deltaY', args.deltaY);
      const deltaX = args.deltaX !== undefined ? requireNumber('deltaX', args.deltaX) : 0;
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.scroll(globalX, globalY, deltaY, deltaX);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'scroll',
            position: { logical: { x, y }, physical: { x: globalX, y: globalY } },
            scroll: { vertical: deltaY, horizontal: deltaX },
            direction: deltaY > 0 ? 'down' : deltaY < 0 ? 'up' : 'none',
          }, null, 2),
        }],
      };
    }

    case 'gui_type': {
      const text = requireString('text', args.text);
      await keyboard.typeText(text);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'type',
            characterCount: text.length,
            text: text.length <= 50 ? text : text.substring(0, 50) + '...',
            method: /[^\x00-\x7F]/.test(text) ? 'clipboard_paste' : 'direct_type',
          }, null, 2),
        }],
      };
    }

    case 'gui_press_key': {
      const key = requireString('key', args.key);
      await keyboard.pressKey(key);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'press_key',
            key,
          }, null, 2),
        }],
      };
    }

    case 'gui_hotkey': {
      const keys = requireStringArray('keys', args.keys);
      const validation = validateHotkey(keys);
      if (validation.blocked) {
        throw new SafetyError(keys, validation.reason!);
      }
      await keyboard.hotkey(keys);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'hotkey',
            keys,
            combination: keys.join('+'),
          }, null, 2),
        }],
      };
    }

    case 'gui_cursor_position': {
      const pos = await mouse.getPosition();
      const disp = await display.getDisplay(config.displayIndex);
      const scaleFactor = disp.scaleFactor ?? 1;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            logicalCoords: { x: Math.round(pos.x / scaleFactor), y: Math.round(pos.y / scaleFactor) },
            physicalCoords: { x: pos.x, y: pos.y },
            scaleFactor,
            note: 'Logical coordinates should be used for gui_click operations.',
          }, null, 2),
        }],
      };
    }

    case 'gui_list_displays': {
      const displays = await display.listDisplays();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: displays.length,
            displays: displays.map(d => ({
              index: d.index,
              label: d.label,
              resolution: { width: d.width, height: d.height },
              scaleFactor: d.scaleFactor,
              isPrimary: d.isPrimary,
              origin: d.origin,
            })),
            note: 'Resolution is in logical pixels. Use display index for displayIndex parameter in other tools.',
          }, null, 2),
        }],
      };
    }

    case 'gui_find_image': {
      const template = requireString('template', args.template);
      const result = await findImage(template, args.confidence as number);
      const disp = await display.getDisplay(config.displayIndex);
      const scaleFactor = disp.scaleFactor ?? 1;
      const region = result.region;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.found,
            found: result.found,
            logicalCoords: result.found && region ? {
              x: Math.round(region.x / scaleFactor),
              y: Math.round(region.y / scaleFactor),
              width: Math.round(region.width / scaleFactor),
              height: Math.round(region.height / scaleFactor),
            } : null,
            physicalCoords: region,
            confidence: result.confidence,
            note: 'Use logicalCoords.center (x + width/2, y + height/2) for click operations.',
          }, null, 2),
        }],
      };
    }

    case 'gui_wait_for_image': {
      const template = requireString('template', args.template);
      const result = await waitForImage(template, args.timeout as number, args.confidence as number);
      const disp = await display.getDisplay(config.displayIndex);
      const scaleFactor = disp.scaleFactor ?? 1;
      const region = result.region;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.found,
            found: result.found,
            logicalCoords: result.found && region ? {
              x: Math.round(region.x / scaleFactor),
              y: Math.round(region.y / scaleFactor),
              width: Math.round(region.width / scaleFactor),
              height: Math.round(region.height / scaleFactor),
            } : null,
            physicalCoords: region,
            confidence: result.confidence,
            timedOut: !result.found,
          }, null, 2),
        }],
      };
    }

    case 'gui_analyze_screen': {
      const prompt = requireString('prompt', args.prompt);
      const displayIdx = typeof args.displayIndex === 'number' ? args.displayIndex : config.displayIndex;

      // Create vision model
      const model = createModel(config.provider, config.apiProtocol, config.model, config.baseUrl);
      const apiKey = config.apiKey;

      if (!apiKey) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'API key not configured' }) }],
          isError: true,
        };
      }

      const result = await analyzeScreen(model, apiKey, prompt, displayIdx);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            analysis: result.analysis,
            imageSize: {
              width: result.imageWidth,
              height: result.imageHeight,
              note: 'Coordinates in analysis reference this image size (logical pixels)',
            },
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) }], isError: true };
  }
}
