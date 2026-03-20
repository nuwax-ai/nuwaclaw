/**
 * Unit tests for mcp/atomicTools.ts — handleAtomicToolCall, input validation, audit logging, safety.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock desktop modules
const mockClick = vi.fn();
const mockDoubleClick = vi.fn();
const mockMoveTo = vi.fn();
const mockDrag = vi.fn();
const mockScroll = vi.fn();
const mockGetMousePosition = vi.fn();
vi.mock('../../src/desktop/mouse.js', () => ({
  click: (...args: any[]) => mockClick(...args),
  doubleClick: (...args: any[]) => mockDoubleClick(...args),
  moveTo: (...args: any[]) => mockMoveTo(...args),
  drag: (...args: any[]) => mockDrag(...args),
  scroll: (...args: any[]) => mockScroll(...args),
  getPosition: () => mockGetMousePosition(),
}));

const mockTypeText = vi.fn();
const mockPressKey = vi.fn();
const mockHotkey = vi.fn();
vi.mock('../../src/desktop/keyboard.js', () => ({
  typeText: (...args: any[]) => mockTypeText(...args),
  pressKey: (...args: any[]) => mockPressKey(...args),
  hotkey: (...args: any[]) => mockHotkey(...args),
}));

const mockCaptureScreenshot = vi.fn();
vi.mock('../../src/desktop/screenshot.js', () => ({
  captureScreenshot: (...args: any[]) => mockCaptureScreenshot(...args),
}));

const mockListDisplays = vi.fn();
const mockGetDisplay = vi.fn();
vi.mock('../../src/desktop/display.js', () => ({
  listDisplays: () => mockListDisplays(),
  getDisplay: (...args: any[]) => mockGetDisplay(...args),
}));

const mockFindImage = vi.fn();
const mockWaitForImage = vi.fn();
vi.mock('../../src/desktop/imageSearch.js', () => ({
  findImage: (...args: any[]) => mockFindImage(...args),
  waitForImage: (...args: any[]) => mockWaitForImage(...args),
}));

// Mock safety
const mockValidateHotkey = vi.fn();
vi.mock('../../src/safety/hotkeys.js', () => ({
  validateHotkey: (...args: any[]) => mockValidateHotkey(...args),
}));

// Mock coordinates
vi.mock('../../src/coordinates/modelProfiles.js', () => ({
  getModelProfile: () => ({ coordinateMode: 'image-absolute', coordinateOrder: 'xy' }),
}));

vi.mock('../../src/coordinates/resolver.js', () => ({
  resolveCoordinate: (_x: number, _y: number) => ({ globalX: _x, globalY: _y }),
}));

import { handleAtomicToolCall, ATOMIC_TOOLS, clearScreenshotDimensionCache } from '../../src/mcp/atomicTools.js';
import { AuditLog } from '../../src/safety/auditLog.js';
import type { GuiAgentConfig } from '../../src/config.js';

const baseConfig: GuiAgentConfig = {
  apiKey: 'test-key',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  port: 60008,
  transport: 'http' as const,
  maxSteps: 50,
  stepDelayMs: 1500,
  stuckThreshold: 3,
  jpegQuality: 75,
  displayIndex: 0,
};

describe('ATOMIC_TOOLS', () => {
  it('defines exactly 14 tools', () => {
    expect(ATOMIC_TOOLS).toHaveLength(14);
  });

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of ATOMIC_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('includes all expected tool names', () => {
    const names = ATOMIC_TOOLS.map(t => t.name);
    expect(names).toContain('gui_screenshot');
    expect(names).toContain('gui_click');
    expect(names).toContain('gui_double_click');
    expect(names).toContain('gui_move_mouse');
    expect(names).toContain('gui_drag');
    expect(names).toContain('gui_scroll');
    expect(names).toContain('gui_type');
    expect(names).toContain('gui_press_key');
    expect(names).toContain('gui_hotkey');
    expect(names).toContain('gui_cursor_position');
    expect(names).toContain('gui_list_displays');
    expect(names).toContain('gui_find_image');
    expect(names).toContain('gui_wait_for_image');
    expect(names).toContain('gui_analyze_screen');
  });
});

describe('handleAtomicToolCall', () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    vi.clearAllMocks();
    clearScreenshotDimensionCache();
    auditLog = new AuditLog();
    // Default mock for getDisplay (needed by coordinate resolution)
    mockGetDisplay.mockResolvedValue({
      index: 0, label: 'Primary', width: 1920, height: 1080,
      scaleFactor: 1, isPrimary: true, origin: { x: 0, y: 0 },
    });
    // Default mock for captureScreenshot (needed by resolveXY for coordinate modes)
    mockCaptureScreenshot.mockResolvedValue({
      image: 'base64data',
      mimeType: 'image/jpeg',
      imageWidth: 1920,
      imageHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      physicalWidth: 1920,
      physicalHeight: 1080,
      scaleFactor: 1,
      displayIndex: 0,
    });
  });

  it('returns null for unknown tool names', async () => {
    const result = await handleAtomicToolCall('unknown_tool', {}, baseConfig, auditLog);
    expect(result).toBeNull();
  });

  // --- Input validation ---

  it('returns error for gui_click with non-number x', async () => {
    const result = await handleAtomicToolCall('gui_click', { x: 'abc', y: 100 }, baseConfig, auditLog);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("'x'");
  });

  it('returns error for gui_click with NaN y', async () => {
    const result = await handleAtomicToolCall('gui_click', { x: 100, y: NaN }, baseConfig, auditLog);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("'y'");
  });

  it('returns error for gui_type with empty text', async () => {
    const result = await handleAtomicToolCall('gui_type', { text: '' }, baseConfig, auditLog);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("'text'");
  });

  it('returns error for gui_hotkey with non-array keys', async () => {
    const result = await handleAtomicToolCall('gui_hotkey', { keys: 'Meta' }, baseConfig, auditLog);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("'keys'");
  });

  // --- Successful operations ---

  it('gui_click calls mouse.click with resolved coordinates', async () => {
    mockClick.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_click', { x: 100, y: 200 }, baseConfig, auditLog);
    expect(result?.isError).toBeUndefined();
    // Without coordinateMode, click uses logical coords directly (no screenshot needed)
    expect(mockClick).toHaveBeenCalledWith(100, 200, 'left');
    expect(result?.content[0].text).toContain('100');
    expect(result?.content[0].text).toContain('200');
  });

  it('gui_type calls keyboard.typeText', async () => {
    mockTypeText.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_type', { text: 'hello' }, baseConfig, auditLog);
    expect(mockTypeText).toHaveBeenCalledWith('hello');
    const parsed = JSON.parse(result!.content[0].text!);
    expect(parsed.characterCount).toBe(5);
  });

  it('gui_press_key calls keyboard.pressKey', async () => {
    mockPressKey.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_press_key', { key: 'Enter' }, baseConfig, auditLog);
    expect(mockPressKey).toHaveBeenCalledWith('Enter');
    expect(result?.content[0].text).toContain('Enter');
  });

  it('gui_cursor_position returns position', async () => {
    mockGetMousePosition.mockResolvedValue({ x: 350, y: 450 });
    const result = await handleAtomicToolCall('gui_cursor_position', {}, baseConfig, auditLog);
    const parsed = JSON.parse(result!.content[0].text!);
    expect(parsed.logicalCoords).toEqual({ x: 350, y: 450 });
    expect(parsed.success).toBe(true);
  });

  it('gui_list_displays returns display list', async () => {
    mockListDisplays.mockResolvedValue([
      { index: 0, label: 'Primary', width: 1920, height: 1080, scaleFactor: 1, isPrimary: true, origin: { x: 0, y: 0 } },
    ]);
    const result = await handleAtomicToolCall('gui_list_displays', {}, baseConfig, auditLog);
    const parsed = JSON.parse(result!.content[0].text!);
    expect(parsed.count).toBe(1);
    expect(parsed.displays[0].label).toBe('Primary');
  });

  it('gui_screenshot returns image and metadata', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      image: 'base64data',
      mimeType: 'image/jpeg',
      imageWidth: 1920,
      imageHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      physicalWidth: 3840,
      physicalHeight: 2160,
      scaleFactor: 2,
      displayIndex: 0,
    });
    const result = await handleAtomicToolCall('gui_screenshot', {}, baseConfig, auditLog);
    expect(result?.content).toHaveLength(2);
    expect(result?.content[0].type).toBe('image');
    expect(result?.content[0].data).toBe('base64data');
    const meta = JSON.parse(result!.content[1].text!);
    expect(meta.scaleFactor).toBe(2);
  });

  // --- Safety: hotkey blocking ---

  it('gui_hotkey blocks dangerous key combination', async () => {
    mockValidateHotkey.mockReturnValue({ blocked: true, reason: 'Quit application' });
    const result = await handleAtomicToolCall('gui_hotkey', { keys: ['Meta', 'Q'] }, baseConfig, auditLog);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('Quit application');
    expect(mockHotkey).not.toHaveBeenCalled();
  });

  it('gui_hotkey allows safe key combination', async () => {
    mockValidateHotkey.mockReturnValue({ blocked: false });
    mockHotkey.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_hotkey', { keys: ['Meta', 'C'] }, baseConfig, auditLog);
    expect(result?.isError).toBeUndefined();
    expect(mockHotkey).toHaveBeenCalledWith(['Meta', 'C']);
  });

  // --- Audit logging ---

  it('records successful operation in audit log', async () => {
    mockClick.mockResolvedValue(undefined);
    await handleAtomicToolCall('gui_click', { x: 100, y: 200 }, baseConfig, auditLog);

    const entries = auditLog.getEntries(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('gui_click');
    expect(entries[0].success).toBe(true);
    expect(entries[0].durationMs).toBeDefined();
  });

  it('records failed operation in audit log', async () => {
    mockClick.mockRejectedValue(new Error('click failed'));
    await handleAtomicToolCall('gui_click', { x: 100, y: 200 }, baseConfig, auditLog);

    const entries = auditLog.getEntries(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('gui_click');
    expect(entries[0].success).toBe(false);
  });

  // --- gui_scroll ---

  it('gui_scroll calls mouse.scroll with deltaY and optional deltaX', async () => {
    mockScroll.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_scroll', { x: 100, y: 200, deltaY: 5, deltaX: 3 }, baseConfig, auditLog);
    expect(mockScroll).toHaveBeenCalledWith(100, 200, 5, 3);
    expect(result?.isError).toBeUndefined();
  });

  // --- gui_drag ---

  it('gui_drag calls mouse.drag with start and end coordinates', async () => {
    mockDrag.mockResolvedValue(undefined);
    const result = await handleAtomicToolCall('gui_drag', { startX: 10, startY: 20, endX: 100, endY: 200 }, baseConfig, auditLog);
    expect(mockDrag).toHaveBeenCalled();
    expect(result?.isError).toBeUndefined();
  });

  // --- gui_find_image ---

  it('gui_find_image calls findImage and returns result', async () => {
    mockFindImage.mockResolvedValue({ found: true, region: { x: 10, y: 20, width: 50, height: 30 }, confidence: 0.95 });
    const result = await handleAtomicToolCall('gui_find_image', { template: 'base64data' }, baseConfig, auditLog);
    const parsed = JSON.parse(result!.content[0].text!);
    expect(parsed.found).toBe(true);
    expect(parsed.logicalCoords.x).toBe(10);
    expect(parsed.logicalCoords.y).toBe(20);
  });
});

describe('resolveXY coordinate mode and caching', () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    vi.clearAllMocks();
    clearScreenshotDimensionCache();
    auditLog = new AuditLog();
    mockGetDisplay.mockResolvedValue({
      index: 0, label: 'Primary', width: 1920, height: 1080,
      scaleFactor: 1, isPrimary: true, origin: { x: 0, y: 0 },
    });
    mockClick.mockResolvedValue(undefined);
  });

  it('captures screenshot when coordinateMode is provided', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      image: 'base64data',
      mimeType: 'image/jpeg',
      imageWidth: 1920,
      imageHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      physicalWidth: 1920,
      physicalHeight: 1080,
      scaleFactor: 1,
      displayIndex: 0,
    });

    await handleAtomicToolCall('gui_click', { x: 100, y: 200, coordinateMode: 'image-absolute' }, baseConfig, auditLog);

    expect(mockCaptureScreenshot).toHaveBeenCalledTimes(1);
  });

  it('uses cached dimensions for subsequent coordinate mode calls', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      image: 'base64data',
      mimeType: 'image/jpeg',
      imageWidth: 1920,
      imageHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      physicalWidth: 1920,
      physicalHeight: 1080,
      scaleFactor: 1,
      displayIndex: 0,
    });

    // First call - should capture screenshot
    await handleAtomicToolCall('gui_click', { x: 100, y: 200, coordinateMode: 'image-absolute' }, baseConfig, auditLog);
    expect(mockCaptureScreenshot).toHaveBeenCalledTimes(1);

    // Second call - should use cached dimensions
    await handleAtomicToolCall('gui_click', { x: 150, y: 250, coordinateMode: 'image-absolute' }, baseConfig, auditLog);
    expect(mockCaptureScreenshot).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  it('captures new screenshot after cache TTL expires', async () => {
    vi.useFakeTimers();

    mockCaptureScreenshot.mockResolvedValue({
      image: 'base64data',
      mimeType: 'image/jpeg',
      imageWidth: 1920,
      imageHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      physicalWidth: 1920,
      physicalHeight: 1080,
      scaleFactor: 1,
      displayIndex: 0,
    });

    // First call
    await handleAtomicToolCall('gui_click', { x: 100, y: 200, coordinateMode: 'image-absolute' }, baseConfig, auditLog);
    expect(mockCaptureScreenshot).toHaveBeenCalledTimes(1);

    // Advance time past TTL (5001ms)
    vi.advanceTimersByTime(5001);

    // Second call - should capture new screenshot
    await handleAtomicToolCall('gui_click', { x: 150, y: 250, coordinateMode: 'image-absolute' }, baseConfig, auditLog);
    expect(mockCaptureScreenshot).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('falls back to display dimensions when screenshot fails', async () => {
    mockCaptureScreenshot.mockRejectedValue(new Error('Screenshot failed'));

    // Should not throw, should use display dimensions as fallback
    const result = await handleAtomicToolCall('gui_click', { x: 100, y: 200, coordinateMode: 'image-absolute' }, baseConfig, auditLog);

    expect(result?.isError).toBeUndefined();
    expect(mockClick).toHaveBeenCalled();
  });
});

describe('Retina display coordinate scaling', () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    vi.clearAllMocks();
    clearScreenshotDimensionCache();
    auditLog = new AuditLog();
    mockClick.mockResolvedValue(undefined);
    mockGetDisplay.mockResolvedValue({
      index: 0, label: 'Primary', width: 1440, height: 900,
      scaleFactor: 2, // Retina display
      isPrimary: true, origin: { x: 0, y: 0 },
    });
  });

  it('scales logical coordinates by scaleFactor for Retina displays', async () => {
    // logical (100, 200) with scaleFactor 2 should become physical (200, 400)
    await handleAtomicToolCall('gui_click', { x: 100, y: 200 }, baseConfig, auditLog);

    expect(mockClick).toHaveBeenCalledWith(200, 400, 'left');
  });

  it('handles non-origin display offset with Retina scaling', async () => {
    mockGetDisplay.mockResolvedValue({
      index: 1, label: 'External', width: 1920, height: 1080,
      scaleFactor: 2, // Retina external display
      isPrimary: false, origin: { x: 1440, y: 0 }, // Right of primary
    });

    // logical (100, 200) + origin (1440, 0) * scaleFactor 2 = physical (3080, 400)
    await handleAtomicToolCall('gui_click', { x: 100, y: 200 }, baseConfig, auditLog);

    expect(mockClick).toHaveBeenCalledWith(3080, 400, 'left');
  });

  it('gui_cursor_position returns logical coords divided by scaleFactor', async () => {
    mockGetMousePosition.mockResolvedValue({ x: 400, y: 600 }); // Physical coords

    const result = await handleAtomicToolCall('gui_cursor_position', {}, baseConfig, auditLog);
    const parsed = JSON.parse(result!.content[0].text!);

    // Physical (400, 600) / scaleFactor 2 = logical (200, 300)
    expect(parsed.logicalCoords).toEqual({ x: 200, y: 300 });
    expect(parsed.physicalCoords).toEqual({ x: 400, y: 600 });
    expect(parsed.scaleFactor).toBe(2);
  });

  it('gui_find_image returns logical coords divided by scaleFactor', async () => {
    mockFindImage.mockResolvedValue({
      found: true,
      region: { x: 200, y: 400, width: 100, height: 60 }, // Physical coords
      confidence: 0.95,
    });

    const result = await handleAtomicToolCall('gui_find_image', { template: 'base64data' }, baseConfig, auditLog);
    const parsed = JSON.parse(result!.content[0].text!);

    // Physical / scaleFactor 2 = logical
    expect(parsed.logicalCoords.x).toBe(100);
    expect(parsed.logicalCoords.y).toBe(200);
    expect(parsed.logicalCoords.width).toBe(50);
    expect(parsed.logicalCoords.height).toBe(30);
  });
});
