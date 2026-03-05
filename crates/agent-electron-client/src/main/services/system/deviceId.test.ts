/**
 * 单元测试: deviceId
 *
 * 测试设备 ID 生成、缓存与异常回退逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node-machine-id
const mockMachineIdSync = vi.fn();
vi.mock('node-machine-id', () => ({
  machineIdSync: (...args: unknown[]) => mockMachineIdSync(...args),
}));

// Mock os.hostname
const mockHostname = vi.fn(() => 'mock-hostname');
vi.mock('os', () => ({
  hostname: () => mockHostname(),
}));

describe('deviceId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockMachineIdSync.mockReturnValue('mock-machine-id');
    mockHostname.mockReturnValue('mock-hostname');
  });

  it('should return a 64-char hex string', async () => {
    const { getDeviceId } = await import('./deviceId');
    const id = getDeviceId();

    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should hash machineId + salt with SHA-256', async () => {
    const { getDeviceId } = await import('./deviceId');
    const id = getDeviceId();

    const expected = createHash('sha256')
      .update('mock-machine-id' + 'nuwax-agent')
      .digest('hex');
    expect(id).toBe(expected);
  });

  it('should call machineIdSync with original=true', async () => {
    const { getDeviceId } = await import('./deviceId');
    getDeviceId();

    expect(mockMachineIdSync).toHaveBeenCalledWith(true);
  });

  it('should cache the result on subsequent calls', async () => {
    const { getDeviceId } = await import('./deviceId');
    const first = getDeviceId();
    const second = getDeviceId();

    expect(first).toBe(second);
    expect(mockMachineIdSync).toHaveBeenCalledTimes(1);
  });

  it('should log the deviceId on first call', async () => {
    const { getDeviceId } = await import('./deviceId');
    const log = (await import('electron-log')).default;
    const id = getDeviceId();

    expect(log.info).toHaveBeenCalledWith(`[DeviceId] ${id}`);
  });

  it('should fallback to hostname when machineIdSync throws', async () => {
    mockMachineIdSync.mockImplementation(() => {
      throw new Error('no machine-id');
    });

    const { getDeviceId } = await import('./deviceId');
    const log = (await import('electron-log')).default;
    const id = getDeviceId();

    const expected = createHash('sha256')
      .update('mock-hostname' + 'nuwax-agent')
      .digest('hex');
    expect(id).toBe(expected);
    expect(log.warn).toHaveBeenCalledWith(
      '[DeviceId] Failed to read machineId, using hostname fallback:',
      expect.any(Error),
    );
  });

  it('should produce different IDs for different machineIds', async () => {
    mockMachineIdSync.mockReturnValue('machine-a');
    const mod1 = await import('./deviceId');
    const idA = mod1.getDeviceId();

    vi.resetModules();
    mockMachineIdSync.mockReturnValue('machine-b');
    const mod2 = await import('./deviceId');
    const idB = mod2.getDeviceId();

    expect(idA).not.toBe(idB);
  });
});
