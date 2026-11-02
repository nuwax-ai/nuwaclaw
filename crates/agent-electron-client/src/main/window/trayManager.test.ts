/**
 * 单元测试: TrayManager
 *
 * 测试托盘管理器逻辑（Electron API 被 mock）
 *
 * 注意：由于 TrayManager 依赖 Electron 的 Tray/nativeImage 等 API，
 * 这些测试主要验证状态更新和菜单构建逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 在导入模块前设置 mock
vi.mock('electron', () => ({
  Tray: vi.fn().mockImplementation(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    setImage: vi.fn(),
  })),
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({
      isEmpty: vi.fn(() => false),
      getSize: vi.fn(() => ({ width: 22, height: 22 })),
      resize: vi.fn(function(this: any) { return this; }),
      setTemplateImage: vi.fn(),
    }),
    createFromDataURL: vi.fn().mockReturnValue({
      isEmpty: vi.fn(() => false),
      getSize: vi.fn(() => ({ width: 16, height: 16 })),
      resize: vi.fn(function(this: any) { return this; }),
    }),
  },
  app: {
    getVersion: vi.fn(() => '0.7.4'),
    isPackaged: false,
    dock: {
      show: vi.fn(),
    },
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

vi.mock('./autoLaunchManager', () => ({
  createAutoLaunchManager: vi.fn(() => ({
    isEnabled: vi.fn().mockResolvedValue(false),
    setEnabled: vi.fn().mockResolvedValue(true),
  })),
}));

import { TrayManager, TrayStatus } from './trayManager';

describe('TrayManager', () => {
  let trayManager: TrayManager;
  const mockOptions = {
    onShowWindow: vi.fn(),
    onRestartServices: vi.fn().mockResolvedValue(undefined),
    onStopServices: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    trayManager = new TrayManager(mockOptions);
  });

  afterEach(() => {
    trayManager.destroy();
  });

  describe('初始化', () => {
    it('should create TrayManager instance', () => {
      expect(trayManager).toBeDefined();
    });
  });

  describe('create()', () => {
    it('should create tray and return void', async () => {
      const result = await trayManager.create();
      expect(result).toBeUndefined();
    });
  });

  describe('updateServicesStatus()', () => {
    it('should update status to running', async () => {
      await trayManager.create();
      // 不应抛出错误
      expect(() => trayManager.updateServicesStatus(true)).not.toThrow();
    });

    it('should update status to stopped', async () => {
      await trayManager.create();
      expect(() => trayManager.updateServicesStatus(false)).not.toThrow();
    });
  });

  describe('setStatus()', () => {
    it('should set error status', async () => {
      await trayManager.create();
      expect(() => trayManager.setStatus('error')).not.toThrow();
    });

    it('should set starting status', async () => {
      await trayManager.create();
      expect(() => trayManager.setStatus('starting')).not.toThrow();
    });

    it('should set running status', async () => {
      await trayManager.create();
      expect(() => trayManager.setStatus('running')).not.toThrow();
    });

    it('should set stopped status', async () => {
      await trayManager.create();
      expect(() => trayManager.setStatus('stopped')).not.toThrow();
    });
  });

  describe('destroy()', () => {
    it('should destroy tray without error', () => {
      expect(() => trayManager.destroy()).not.toThrow();
    });
  });

  describe('getTray()', () => {
    it('should return null before create', () => {
      expect(trayManager.getTray()).toBeNull();
    });
  });
});

describe('TrayStatus 类型', () => {
  it('should have correct status values', () => {
    const statuses: TrayStatus[] = ['running', 'stopped', 'error', 'starting'];
    expect(statuses).toHaveLength(4);
  });
});
