/**
 * T2.3 — Screenshot pipeline unit tests (with mocked nut.js and sharp)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGrabRegion = vi.fn();
const mockRegion = vi.fn().mockImplementation((left: number, top: number, width: number, height: number) => ({
  left, top, width, height,
}));

const mockResize = vi.fn();
const mockJpeg = vi.fn();
const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data'));

// Build a chainable mock that supports .clone()
function makeChain() {
  const chain: any = {
    resize: mockResize,
    jpeg: mockJpeg,
    toBuffer: mockToBuffer,
    clone: vi.fn(() => makeChain()),
  };
  mockResize.mockReturnValue(chain);
  mockJpeg.mockReturnValue(chain);
  return chain;
}

// Mock sharp
vi.mock('sharp', () => {
  return {
    default: vi.fn(() => makeChain()),
  };
});

// Mock display module
vi.mock('../../src/desktop/display.js', () => ({
  getDisplay: vi.fn(),
}));

// Mock nut.js — must handle dynamic import()
vi.mock('@nut-tree-fork/nut-js', () => ({
  screen: { grabRegion: mockGrabRegion },
  Region: mockRegion,
}));

import { captureScreenshot } from '../../src/desktop/screenshot.js';
import { getDisplay } from '../../src/desktop/display.js';
import sharp from 'sharp';

const mockGetDisplay = vi.mocked(getDisplay);
const mockSharp = vi.mocked(sharp);

function setupDisplay(width: number, height: number, scaleFactor: number = 1) {
  mockGetDisplay.mockResolvedValue({
    index: 0,
    label: 'Test',
    width,
    height,
    scaleFactor,
    isPrimary: true,
    origin: { x: 0, y: 0 },
  });
}

function setupCapture(physicalWidth: number, physicalHeight: number) {
  mockGrabRegion.mockResolvedValue({
    width: physicalWidth,
    height: physicalHeight,
    data: Buffer.alloc(physicalWidth * physicalHeight * 4),
  });
}

describe('captureScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults after clearAllMocks
    mockToBuffer.mockResolvedValue(Buffer.from('fake-jpeg-data'));
  });

  it('1080p display: no resize needed', async () => {
    setupDisplay(1920, 1080, 1);
    setupCapture(1920, 1080);

    const result = await captureScreenshot(0, 75);

    expect(result.physicalWidth).toBe(1920);
    expect(result.physicalHeight).toBe(1080);
    expect(result.logicalWidth).toBe(1920);
    expect(result.logicalHeight).toBe(1080);
    expect(result.imageWidth).toBe(1920);
    expect(result.imageHeight).toBe(1080);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.displayIndex).toBe(0);

    expect(mockResize).toHaveBeenCalledWith(1920, 1080, { kernel: 'lanczos3' });
  });

  it('Retina: 2880x1800 physical, scaleFactor=2 → 1440x900 (no further resize)', async () => {
    setupDisplay(1440, 900, 2);
    setupCapture(2880, 1800);

    const result = await captureScreenshot(0, 75);

    expect(result.physicalWidth).toBe(2880);
    expect(result.physicalHeight).toBe(1800);
    expect(result.logicalWidth).toBe(1440);
    expect(result.logicalHeight).toBe(900);
    expect(result.imageWidth).toBe(1440);
    expect(result.imageHeight).toBe(900);
    expect(result.scaleFactor).toBe(2);
  });

  it('4K: 3840x2160 physical, scaleFactor=1 → resize to 1920x1080', async () => {
    setupDisplay(3840, 2160, 1);
    setupCapture(3840, 2160);

    const result = await captureScreenshot(0, 75);

    expect(result.physicalWidth).toBe(3840);
    expect(result.logicalWidth).toBe(3840);
    expect(result.imageWidth).toBe(1920);
    expect(result.imageHeight).toBe(1080);
  });

  it('2K: 2560x1440 physical, scaleFactor=1 → resize to 1920x1080', async () => {
    setupDisplay(2560, 1440, 1);
    setupCapture(2560, 1440);

    const result = await captureScreenshot(0, 75);

    expect(result.logicalWidth).toBe(2560);
    expect(result.imageWidth).toBe(1920);
    expect(result.imageHeight).toBe(1080);
  });

  it('returns valid base64 string', async () => {
    setupDisplay(1920, 1080, 1);
    setupCapture(1920, 1080);

    const result = await captureScreenshot(0, 75);

    expect(typeof result.image).toBe('string');
    expect(result.image.length).toBeGreaterThan(0);
    expect(() => Buffer.from(result.image, 'base64')).not.toThrow();
  });

  it('passes jpeg quality to sharp', async () => {
    setupDisplay(1920, 1080, 1);
    setupCapture(1920, 1080);

    await captureScreenshot(0, 50);

    expect(mockJpeg).toHaveBeenCalledWith({ quality: 50 });
  });
});
