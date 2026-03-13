/**
 * 单元测试: migrate (数据目录迁移)
 *
 * 覆盖三条迁移路径:
 * 1. .nuwax-agent → .nuwaclaw (优先级最高)
 * 2. .nuwaxbot → .nuwaclaw
 * 3. 无旧目录 → 跳过
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

  it('should skip when no legacy directory exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('should skip when new directory already exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('.nuwaclaw')) return true;
      if (p.includes('.nuwax-agent')) return true;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('should migrate .nuwax-agent → .nuwaclaw (priority 1)', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwaclaw')) return false;
      if (p === path.join('/mock/home', '.nuwax-agent')) return true;
      if (p.endsWith('nuwax-agent.db')) return true;
      if (p.endsWith('nuwaclaw.db')) return false;
      if (p.endsWith('-wal') || p.endsWith('-shm')) return false;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    // Directory rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwax-agent'),
      path.join('/mock/home', '.nuwaclaw'),
    );

    // DB rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaclaw', 'nuwax-agent.db'),
      path.join('/mock/home', '.nuwaclaw', 'nuwaclaw.db'),
    );
  });

  it('should migrate .nuwaxbot → .nuwaclaw (priority 2)', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwaclaw')) return false;
      if (p === path.join('/mock/home', '.nuwax-agent')) return false;
      if (p === path.join('/mock/home', '.nuwaxbot')) return true;
      if (p.endsWith('nuwaxbot.db')) return true;
      if (p.endsWith('nuwaclaw.db')) return false;
      if (p.endsWith('nuwaxbot.json')) return true;
      if (p.endsWith('nuwaclaw.json')) return false;
      if (p.endsWith('-wal') || p.endsWith('-shm')) return false;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    // Directory rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaxbot'),
      path.join('/mock/home', '.nuwaclaw'),
    );

    // DB rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaclaw', 'nuwaxbot.db'),
      path.join('/mock/home', '.nuwaclaw', 'nuwaclaw.db'),
    );

    // Config rename
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaclaw', 'nuwaxbot.json'),
      path.join('/mock/home', '.nuwaclaw', 'nuwaclaw.json'),
    );
  });

  it('should also rename WAL and SHM files if they exist', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwaclaw')) return false;
      if (p === path.join('/mock/home', '.nuwax-agent')) return true;
      if (p.endsWith('nuwax-agent.db')) return true;
      if (p.endsWith('nuwaclaw.db')) return false;
      if (p.endsWith('nuwax-agent.db-wal')) return true;
      if (p.endsWith('nuwax-agent.db-shm')) return true;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaclaw', 'nuwax-agent.db-wal'),
      path.join('/mock/home', '.nuwaclaw', 'nuwaclaw.db-wal'),
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaclaw', 'nuwax-agent.db-shm'),
      path.join('/mock/home', '.nuwaclaw', 'nuwaclaw.db-shm'),
    );
  });

  it('should prefer .nuwax-agent over .nuwaxbot when both exist', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === path.join('/mock/home', '.nuwaclaw')) return false;
      if (p === path.join('/mock/home', '.nuwax-agent')) return true;
      if (p === path.join('/mock/home', '.nuwaxbot')) return true;
      if (p.endsWith('nuwax-agent.db')) return true;
      if (p.endsWith('nuwaclaw.db')) return false;
      return false;
    });

    const { migrateDataDir } = await import('./migrate');
    migrateDataDir();

    // Should rename .nuwax-agent, NOT .nuwaxbot
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwax-agent'),
      path.join('/mock/home', '.nuwaclaw'),
    );
    expect(mockRenameSync).not.toHaveBeenCalledWith(
      path.join('/mock/home', '.nuwaxbot'),
      expect.anything(),
    );
  });
});
