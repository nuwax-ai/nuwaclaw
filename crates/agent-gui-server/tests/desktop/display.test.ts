/**
 * Unit tests for desktop/display.ts — macOS system_profiler parsing,
 * nut.js fallback with scaleFactor detection, getDisplay, getPrimaryDisplay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock platform ---
const mockGetPlatform = vi.fn();
vi.mock('../../src/utils/platform.js', () => ({
  getPlatform: () => mockGetPlatform(),
}));

// --- Mock logger ---
vi.mock('../../src/utils/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// --- Mock child_process (for macOS system_profiler) ---
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

// --- Mock nut.js (for fallback) ---
const mockScreenWidth = vi.fn();
const mockScreenHeight = vi.fn();
const mockGrabRegion = vi.fn();

vi.mock('@nut-tree-fork/nut-js', () => {
  class MockRegion {
    constructor(
      public left: number,
      public top: number,
      public width: number,
      public height: number,
    ) {}
  }
  return {
    screen: {
      width: () => mockScreenWidth(),
      height: () => mockScreenHeight(),
      grabRegion: (r: any) => mockGrabRegion(r),
    },
    Region: MockRegion,
  };
});

import { listDisplays, getDisplay, getPrimaryDisplay } from '../../src/desktop/display.js';

// --- Helpers: system_profiler JSON fixtures ---

function macSingleDisplay(opts: {
  resolution?: string;
  pixels?: string;
  retina?: string;
  name?: string;
  main?: string;
} = {}) {
  return JSON.stringify({
    SPDisplaysDataType: [
      {
        spdisplays_ndrvs: [
          {
            _spdisplays_resolution: opts.resolution ?? '1440 x 900 @ 60.00Hz',
            _spdisplays_pixels: opts.pixels ?? '2880 x 1800',
            spdisplays_retina: opts.retina ?? 'spdisplays_yes',
            _name: opts.name ?? 'Built-in Retina Display',
            spdisplays_main: opts.main ?? 'spdisplays_yes',
          },
        ],
      },
    ],
  });
}

function macDualDisplay() {
  return JSON.stringify({
    SPDisplaysDataType: [
      {
        spdisplays_ndrvs: [
          {
            _spdisplays_resolution: '1440 x 900 @ 60.00Hz',
            _spdisplays_pixels: '2880 x 1800',
            spdisplays_retina: 'spdisplays_yes',
            _name: 'Built-in Retina Display',
            spdisplays_main: 'spdisplays_yes',
          },
          {
            _spdisplays_resolution: '2560 x 1440',
            _spdisplays_pixels: '2560 x 1440',
            spdisplays_retina: 'spdisplays_no',
            _name: 'External Monitor',
          },
        ],
      },
    ],
  });
}

describe('listDisplays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- macOS via system_profiler ---

  describe('macOS (system_profiler)', () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue('macos');
    });

    it('parses single Retina display', async () => {
      mockExecSync.mockReturnValue(macSingleDisplay());
      const displays = await listDisplays();

      expect(displays).toHaveLength(1);
      expect(displays[0]).toMatchObject({
        index: 0,
        label: 'Built-in Retina Display',
        width: 1440,
        height: 900,
        scaleFactor: 2,
        isPrimary: true,
        origin: { x: 0, y: 0 },
      });
    });

    it('parses dual display setup', async () => {
      mockExecSync.mockReturnValue(macDualDisplay());
      const displays = await listDisplays();

      expect(displays).toHaveLength(2);
      expect(displays[0].label).toBe('Built-in Retina Display');
      expect(displays[0].isPrimary).toBe(true);
      expect(displays[0].scaleFactor).toBe(2);

      expect(displays[1].label).toBe('External Monitor');
      expect(displays[1].width).toBe(2560);
      expect(displays[1].height).toBe(1440);
      expect(displays[1].scaleFactor).toBe(1);
    });

    it('detects Retina via flag when pixel resolution missing', async () => {
      mockExecSync.mockReturnValue(macSingleDisplay({
        pixels: '',  // no pixel resolution
        retina: 'spdisplays_yes',
        resolution: '1440 x 900',
      }));
      const displays = await listDisplays();

      expect(displays).toHaveLength(1);
      expect(displays[0].scaleFactor).toBe(2); // falls back to retina flag
    });

    it('defaults scaleFactor 1 for non-Retina without pixel info', async () => {
      mockExecSync.mockReturnValue(macSingleDisplay({
        pixels: '',
        retina: 'spdisplays_no',
        resolution: '1920 x 1080',
      }));
      const displays = await listDisplays();

      expect(displays[0].scaleFactor).toBe(1);
    });

    it('falls back to nut.js when system_profiler throws', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('command not found'); });
      mockScreenWidth.mockResolvedValue(1920);
      mockScreenHeight.mockResolvedValue(1080);
      mockGrabRegion.mockResolvedValue({ width: 10 });

      const displays = await listDisplays();
      expect(displays).toHaveLength(1);
      expect(displays[0].width).toBe(1920);
      expect(displays[0].scaleFactor).toBe(1);
    });

    it('falls back when system_profiler returns empty displays', async () => {
      mockExecSync.mockReturnValue(JSON.stringify({ SPDisplaysDataType: [] }));
      mockScreenWidth.mockResolvedValue(1920);
      mockScreenHeight.mockResolvedValue(1080);
      mockGrabRegion.mockResolvedValue({ width: 20 });

      const displays = await listDisplays();
      expect(displays).toHaveLength(1);
      expect(displays[0].scaleFactor).toBe(2); // 20/10 = 2
    });

    it('uses display name from _name field', async () => {
      mockExecSync.mockReturnValue(macSingleDisplay({ name: 'LG UltraFine' }));
      const displays = await listDisplays();
      expect(displays[0].label).toBe('LG UltraFine');
    });
  });

  // --- Windows/Linux fallback ---

  describe('fallback (nut.js)', () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue('windows');
    });

    it('returns single display with correct dimensions', async () => {
      mockScreenWidth.mockResolvedValue(1920);
      mockScreenHeight.mockResolvedValue(1080);
      mockGrabRegion.mockResolvedValue({ width: 10 });

      const displays = await listDisplays();
      expect(displays).toHaveLength(1);
      expect(displays[0]).toMatchObject({
        index: 0,
        label: 'Primary',
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        isPrimary: true,
        origin: { x: 0, y: 0 },
      });
    });

    it('detects HiDPI scaleFactor from capture', async () => {
      mockScreenWidth.mockResolvedValue(1920);
      mockScreenHeight.mockResolvedValue(1080);
      mockGrabRegion.mockResolvedValue({ width: 20 }); // 20/10 = 2x

      const displays = await listDisplays();
      expect(displays[0].scaleFactor).toBe(2);
    });

    it('defaults scaleFactor to 1 when capture fails', async () => {
      mockScreenWidth.mockResolvedValue(1920);
      mockScreenHeight.mockResolvedValue(1080);
      mockGrabRegion.mockRejectedValue(new Error('no display'));

      const displays = await listDisplays();
      expect(displays[0].scaleFactor).toBe(1);
    });

    it('works on Linux', async () => {
      mockGetPlatform.mockReturnValue('linux');
      mockScreenWidth.mockResolvedValue(2560);
      mockScreenHeight.mockResolvedValue(1440);
      mockGrabRegion.mockResolvedValue({ width: 10 });

      const displays = await listDisplays();
      expect(displays[0].width).toBe(2560);
      expect(displays[0].height).toBe(1440);
    });
  });
});

describe('getDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatform.mockReturnValue('macos');
    mockExecSync.mockReturnValue(macDualDisplay());
  });

  it('returns display by index', async () => {
    const d = await getDisplay(1);
    expect(d.index).toBe(1);
    expect(d.label).toBe('External Monitor');
  });

  it('throws DesktopError for out-of-range index', async () => {
    await expect(getDisplay(5)).rejects.toThrow('Display index 5 not found');
  });
});

describe('getPrimaryDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatform.mockReturnValue('macos');
  });

  it('returns the primary display', async () => {
    mockExecSync.mockReturnValue(macDualDisplay());
    const d = await getPrimaryDisplay();
    expect(d.isPrimary).toBe(true);
    expect(d.label).toBe('Built-in Retina Display');
  });

  it('falls back to first display if none marked primary', async () => {
    // Single display with no main flag — first display still returned
    mockExecSync.mockReturnValue(macSingleDisplay({ main: '' }));
    const d = await getPrimaryDisplay();
    // First display is always treated as primary when displays.length === 0 before push
    expect(d.index).toBe(0);
  });
});
