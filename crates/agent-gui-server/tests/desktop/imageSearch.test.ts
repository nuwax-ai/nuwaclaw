/**
 * Unit tests for desktop/imageSearch.ts — findImage, waitForImage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();
vi.mock('fs', () => ({
  promises: {
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
  },
}));

// Mock nut.js
const mockFind = vi.fn();
const mockLoadImage = vi.fn();
const mockScreenConfig = { confidence: 0.9 };

vi.mock('@nut-tree-fork/nut-js', () => ({
  screen: {
    find: (...args: any[]) => mockFind(...args),
    config: mockScreenConfig,
  },
  loadImage: (...args: any[]) => mockLoadImage(...args),
}));

import { findImage, waitForImage } from '../../src/desktop/imageSearch.js';

describe('findImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockLoadImage.mockResolvedValue('template-obj');
  });

  it('returns found=true with region when match found', async () => {
    mockFind.mockResolvedValue({ left: 10, top: 20, width: 50, height: 30 });

    const result = await findImage('dGVzdA==', 0.85);

    expect(result.found).toBe(true);
    expect(result.region).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    expect(result.confidence).toBe(0.85);
    expect(mockScreenConfig.confidence).toBe(0.85);
  });

  it('returns found=false when no match', async () => {
    mockFind.mockRejectedValue(new Error('no match'));

    const result = await findImage('dGVzdA==');
    expect(result.found).toBe(false);
    expect(result.region).toBeUndefined();
  });

  it('writes template to temp file and cleans up', async () => {
    mockFind.mockResolvedValue({ left: 0, top: 0, width: 10, height: 10 });

    await findImage('dGVzdA==');

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('cleans up temp file even when match fails', async () => {
    mockFind.mockRejectedValue(new Error('no match'));

    await findImage('dGVzdA==');
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('uses default confidence of 0.9', async () => {
    mockFind.mockResolvedValue({ left: 0, top: 0, width: 10, height: 10 });

    const result = await findImage('dGVzdA==');
    expect(result.confidence).toBe(0.9);
  });
});

describe('waitForImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockLoadImage.mockResolvedValue('template-obj');
  });

  it('returns found=true with elapsed when image found immediately', async () => {
    mockFind.mockResolvedValue({ left: 5, top: 10, width: 20, height: 15 });

    const result = await waitForImage('dGVzdA==', 5000, 0.8);

    expect(result.found).toBe(true);
    expect(result.region).toEqual({ x: 5, y: 10, width: 20, height: 15 });
    expect(result.elapsed).toBeDefined();
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns found=false with elapsed after timeout', async () => {
    mockFind.mockRejectedValue(new Error('no match'));

    // Use a very short timeout to avoid slow tests
    const result = await waitForImage('dGVzdA==', 100, 0.9);

    expect(result.found).toBe(false);
    expect(result.elapsed).toBeGreaterThanOrEqual(100);
  });

  it('cleans up temp file after completion', async () => {
    mockFind.mockResolvedValue({ left: 0, top: 0, width: 10, height: 10 });

    await waitForImage('dGVzdA==', 5000);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('cleans up temp file even after timeout', async () => {
    mockFind.mockRejectedValue(new Error('no match'));

    await waitForImage('dGVzdA==', 100);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('writes temp file only once for reuse across polls', async () => {
    mockFind.mockRejectedValue(new Error('no match'));

    await waitForImage('dGVzdA==', 100);
    // Only 1 writeFile call despite potentially multiple polls
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});
