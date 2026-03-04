/**
 * 单元测试: migrate (数据目录迁移)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/home') },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockExistsSync = vi.fn(() => false);
const mockRenameSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
  renameSync: (o: string, n: string) => mockRenameSync(o, n),
}));

describe('migrateDataDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when old directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('should skip when new directory already exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('.nuwax-agent')) return true;
      if (p.includes('.nuwaxbot')) return true;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('should rename directory and DB when old exists and new does not', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwax-agent')) return true;
      if (p === path.join('/mock/home', '.nuwaxbot')) return false;
      if (p.endsWith('nuwax-agent.db')) return true;
      if (p.endsWith('nuwaxbot.db')) return false;
      if (p.endsWith('-wal') || p.endsWith('-shm')) return false;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    // Directory rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwax-agent'),
      path.join('/mock/home', '.nuwaxbot'),
    );

    // DB rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaxbot', 'nuwax-agent.db'),
      path.join('/mock/home', '.nuwaxbot', 'nuwaxbot.db'),
    );
  });

  it('should also rename WAL and SHM files if they exist', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwax-agent')) return true;
      if (p === path.join('/mock/home', '.nuwaxbot')) return false;
      if (p.endsWith('nuwax-agent.db')) return true;
      if (p.endsWith('nuwaxbot.db')) return false;
      if (p.endsWith('nuwax-agent.db-wal')) return true;
      if (p.endsWith('nuwax-agent.db-shm')) return true;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaxbot', 'nuwax-agent.db-wal'),
      path.join('/mock/home', '.nuwaxbot', 'nuwaxbot.db-wal'),
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaxbot', 'nuwax-agent.db-shm'),
      path.join('/mock/home', '.nuwaxbot', 'nuwaxbot.db-shm'),
    );
  });
});
