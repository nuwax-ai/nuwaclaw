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
    description: 'Capture a screenshot of the specified display',
    inputSchema: {
      type: 'object' as const,
      properties: {
        displayIndex: { type: 'number', description: 'Display index (default: configured display)' },
      },
    },
  },
  {
    name: 'gui_click',
    description: 'Click at the specified coordinates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        coordinateMode: { type: 'string', description: 'Coordinate mode override (image-absolute, normalized-1000, etc.)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_double_click',
    description: 'Double-click at the specified coordinates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        coordinateMode: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_move_mouse',
    description: 'Move mouse to the specified coordinates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        coordinateMode: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_drag',
    description: 'Drag from start to end coordinates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        startX: { type: 'number' },
        startY: { type: 'number' },
        endX: { type: 'number' },
        endY: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        coordinateMode: { type: 'string' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'gui_scroll',
    description: 'Scroll at the specified position',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        deltaY: { type: 'number', description: 'Vertical scroll (positive = down)' },
        deltaX: { type: 'number', description: 'Horizontal scroll (positive = right)' },
        coordinateMode: { type: 'string' },
      },
      required: ['x', 'y', 'deltaY'],
    },
  },
  {
    name: 'gui_type',
    description: 'Type text (CJK auto-routed via clipboard)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'gui_press_key',
    description: 'Press a single key',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Key name (e.g. Enter, Tab, Escape)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'gui_hotkey',
    description: 'Press a key combination',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'Keys to press together (e.g. ["Meta", "C"])' },
      },
      required: ['keys'],
    },
  },
  {
    name: 'gui_cursor_position',
    description: 'Get current cursor position',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gui_list_displays',
    description: 'List all connected displays',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gui_find_image',
    description: 'Find an image on screen by template matching',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Base64-encoded template image' },
        confidence: { type: 'number', description: 'Match confidence threshold (0-1, default 0.9)' },
      },
      required: ['template'],
    },
  },
  {
    name: 'gui_wait_for_image',
    description: 'Wait for an image to appear on screen',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Base64-encoded template image' },
        timeout: { type: 'number', description: 'Timeout in ms (default 10000)' },
        confidence: { type: 'number', description: 'Match confidence threshold (0-1, default 0.9)' },
      },
      required: ['template'],
    },
  },
  {
    name: 'gui_analyze_screen',
    description: 'Capture screenshot and analyze with vision model. Returns text description of screen content, UI elements, text, buttons, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Analysis instruction (e.g., "What buttons are visible?", "Find the search box location", "Is there an error dialog?")' },
        displayIndex: { type: 'number', description: 'Display index (default: configured display)' },
      },
      required: ['prompt'],
    },
  },
];

/** Helper: resolve coordinates for tools that accept x/y + optional coordinateMode */
async function resolveXY(
  x: number,
  y: number,
  coordinateMode: string | undefined,
  config: GuiAgentConfig,
): Promise<{ globalX: number; globalY: number; meta: ScreenshotMeta }> {
  const profile = getModelProfile(config.model, coordinateMode as any);
  const disp = await display.getDisplay(config.displayIndex);
  const meta: ScreenshotMeta = {
    imageWidth: disp.width,
    imageHeight: disp.height,
    logicalWidth: disp.width,
    logicalHeight: disp.height,
  };
  const displayInfo: DisplayInfo = {
    origin: disp.origin,
    bounds: { width: disp.width, height: disp.height },
  };

  if (!coordinateMode) {
    // No coordinate mode specified — treat as logical coordinates directly
    return { globalX: Math.round(x) + disp.origin.x, globalY: Math.round(y) + disp.origin.y, meta };
  }

  const resolved = resolveCoordinate(x, y, profile, meta, displayInfo);
  return { globalX: resolved.globalX, globalY: resolved.globalY, meta };
}

export { ATOMIC_TOOLS };

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
              imageWidth: shot.imageWidth,
              imageHeight: shot.imageHeight,
              logicalWidth: shot.logicalWidth,
              logicalHeight: shot.logicalHeight,
              physicalWidth: shot.physicalWidth,
              physicalHeight: shot.physicalHeight,
              scaleFactor: shot.scaleFactor,
              displayIndex: shot.displayIndex,
            }),
          },
        ],
      };
    }

    case 'gui_click': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.click(globalX, globalY, args.button as any);
      return { content: [{ type: 'text', text: `Clicked (${globalX}, ${globalY})` }] };
    }

    case 'gui_double_click': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.doubleClick(globalX, globalY, args.button as any);
      return { content: [{ type: 'text', text: `Double-clicked (${globalX}, ${globalY})` }] };
    }

    case 'gui_move_mouse': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.moveTo(globalX, globalY);
      return { content: [{ type: 'text', text: `Moved to (${globalX}, ${globalY})` }] };
    }

    case 'gui_drag': {
      const startX = requireNumber('startX', args.startX);
      const startY = requireNumber('startY', args.startY);
      const endX = requireNumber('endX', args.endX);
      const endY = requireNumber('endY', args.endY);
      const start = await resolveXY(startX, startY, args.coordinateMode as string, config);
      const end = await resolveXY(endX, endY, args.coordinateMode as string, config);
      await mouse.drag(start.globalX, start.globalY, end.globalX, end.globalY, args.button as any);
      return { content: [{ type: 'text', text: `Dragged (${start.globalX},${start.globalY}) → (${end.globalX},${end.globalY})` }] };
    }

    case 'gui_scroll': {
      const x = requireNumber('x', args.x);
      const y = requireNumber('y', args.y);
      const deltaY = requireNumber('deltaY', args.deltaY);
      const deltaX = args.deltaX !== undefined ? requireNumber('deltaX', args.deltaX) : undefined;
      const { globalX, globalY } = await resolveXY(x, y, args.coordinateMode as string, config);
      await mouse.scroll(globalX, globalY, deltaY, deltaX);
      return { content: [{ type: 'text', text: `Scrolled at (${globalX}, ${globalY}), dy=${deltaY}` }] };
    }

    case 'gui_type': {
      const text = requireString('text', args.text);
      await keyboard.typeText(text);
      return { content: [{ type: 'text', text: `Typed ${text.length} characters` }] };
    }

    case 'gui_press_key': {
      const key = requireString('key', args.key);
      await keyboard.pressKey(key);
      return { content: [{ type: 'text', text: `Pressed ${key}` }] };
    }

    case 'gui_hotkey': {
      const keys = requireStringArray('keys', args.keys);
      const validation = validateHotkey(keys);
      if (validation.blocked) {
        throw new SafetyError(keys, validation.reason!);
      }
      await keyboard.hotkey(keys);
      return { content: [{ type: 'text', text: `Hotkey: ${keys.join('+')}` }] };
    }

    case 'gui_cursor_position': {
      const pos = await mouse.getPosition();
      return { content: [{ type: 'text', text: JSON.stringify(pos) }] };
    }

    case 'gui_list_displays': {
      const displays = await display.listDisplays();
      return { content: [{ type: 'text', text: JSON.stringify(displays, null, 2) }] };
    }

    case 'gui_find_image': {
      const template = requireString('template', args.template);
      const result = await findImage(template, args.confidence as number);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'gui_wait_for_image': {
      const template = requireString('template', args.template);
      const result = await waitForImage(template, args.timeout as number, args.confidence as number);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'gui_analyze_screen': {
      const prompt = requireString('prompt', args.prompt);
      const displayIdx = typeof args.displayIndex === 'number' ? args.displayIndex : config.displayIndex;

      // Create vision model
      const model = createModel(config.provider, config.apiProtocol, config.model, config.baseUrl);
      const apiKey = config.apiKey;

      if (!apiKey) {
        return {
          content: [{ type: 'text', text: 'Error: API key not configured' }],
          isError: true,
        };
      }

      const result = await analyzeScreen(model, apiKey, prompt, displayIdx);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            analysis: result.analysis,
            imageWidth: result.imageWidth,
            imageHeight: result.imageHeight,
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
