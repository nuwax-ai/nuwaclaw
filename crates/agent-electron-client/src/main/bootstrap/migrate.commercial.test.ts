/**
 * 单元测试: migrate + 品牌注入（商业版 identifier=nuwawork + 端口偏移 1000）
 *
 * 模拟商业版构建产物行为（NUWAX_APP_IDENTIFIER/NUWAX_PORT_OFFSET 注入）：
 * 1. APP_DATA_DIR_NAME 派生为 .nuwawork
 * 2. .nuwaclaw → .nuwawork 整目录迁移（rename + DB/config 改名）
 * 3. 目标已有数据 → 跳过
 * 4. migrateSettingsPaths 重写 step1_config.workspaceDir 的 .nuwaclaw 前缀
 * 5. 迁移的 quickInit 配置中旧默认端口改写为 +1000（自定义端口不动）
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as path from "path";

// 必须在动态 import constants/migrate 之前设置（构建期 define 的运行时等价物）
process.env.NUWAX_APP_IDENTIFIER = "nuwawork";
process.env.NUWAX_PORT_OFFSET = "1000";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/home") },
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockExistsSync = vi.fn(() => false);
const mockRenameSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockReadFileSync = vi.fn(() => "{}");
const mockWriteFileSync = vi.fn();

vi.mock("fs", () => ({
  existsSync: (p: string) => mockExistsSync(p),
  renameSync: (o: string, n: string) => mockRenameSync(o, n),
  copyFileSync: (o: string, n: string) => mockCopyFileSync(o, n),
  readFileSync: (p: string) => mockReadFileSync(p),
  writeFileSync: (p: string, data: string) => mockWriteFileSync(p, data),
}));

const mockReadSetting = vi.fn(() => null);
const mockWriteSetting = vi.fn();

vi.mock("../db", () => ({
  readSetting: (...args: unknown[]) => mockReadSetting(...args),
  writeSetting: (...args: unknown[]) => mockWriteSetting(...args),
}));

const mockDbPrepare = vi.fn();
const mockDbClose = vi.fn();

vi.mock("better-sqlite3", () => ({
  default: vi.fn(() => ({
    prepare: mockDbPrepare,
    close: mockDbClose,
  })),
}));

afterAll(() => {
  delete process.env.NUWAX_APP_IDENTIFIER;
  delete process.env.NUWAX_PORT_OFFSET;
});

describe("commercial branding (identifier=nuwawork)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbPrepare.mockReturnValue({ get: () => ({ count: 0 }) });
  });

  it("derives APP_DATA_DIR_NAME from injected identifier", async () => {
    const { APP_DATA_DIR_NAME } = await import("@shared/constants");
    expect(APP_DATA_DIR_NAME).toBe(".nuwawork");
  });

  it("renames .nuwaclaw → .nuwawork with db/config renames when target missing", async () => {
    const legacyDir = path.join("/mock/home", ".nuwaclaw");
    const targetDir = path.join("/mock/home", ".nuwawork");
    mockExistsSync.mockImplementation((p: string) => {
      if (p === legacyDir) return true;
      // rename 之后在同一新目录里检查旧 DB / config 文件名
      if (p === path.join(targetDir, "nuwaclaw.db")) return true;
      if (p === path.join(targetDir, "nuwawork.db")) return false;
      if (p === path.join(targetDir, "nuwaclaw.json")) return true;
      if (p === path.join(targetDir, "nuwawork.json")) return false;
      return false;
    });

    const { migrateDataDir } = await import("./migrate");
    migrateDataDir();

    expect(mockRenameSync).toHaveBeenCalledWith(legacyDir, targetDir);
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join(targetDir, "nuwaclaw.db"),
      path.join(targetDir, "nuwawork.db"),
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      path.join(targetDir, "nuwaclaw.json"),
      path.join(targetDir, "nuwawork.json"),
    );
  });

  it("skips migration when target .nuwawork already has data", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes(".nuwawork")) return true;
      return false;
    });
    mockDbPrepare.mockReturnValue({ get: () => ({ count: 5 }) });

    const { migrateDataDir } = await import("./migrate");
    migrateDataDir();

    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("rewrites step1_config.workspaceDir legacy prefix to .nuwawork", async () => {
    mockReadSetting.mockReturnValue({
      workspaceDir: path.join("/mock/home", ".nuwaclaw", "workspace"),
    });

    const { migrateSettingsPaths } = await import("./migrate");
    migrateSettingsPaths();

    expect(mockWriteSetting).toHaveBeenCalledWith("step1_config", {
      workspaceDir: path.join("/mock/home", ".nuwawork", "workspace"),
    });
  });

  it("shifts legacy default quickInit ports (+1000) in migrated config, custom ports untouched", async () => {
    const legacyDir = path.join("/mock/home", ".nuwaclaw");
    const targetDir = path.join("/mock/home", ".nuwawork");
    const oldConfig = path.join(targetDir, "nuwaclaw.json");
    const newConfig = path.join(targetDir, "nuwawork.json");
    let renamedTo = "";

    mockRenameSync.mockImplementation((_o: string, n: string) => {
      if (n.endsWith(".json")) renamedTo = n;
    });
    mockExistsSync.mockImplementation((p: string) => {
      if (p === legacyDir) return true;
      // rename 前旧配置在、新配置不在；rename 后反之
      if (p === oldConfig) return !renamedTo;
      if (p === newConfig) return !!renamedTo;
      if (p === path.join(targetDir, "nuwaclaw.db")) return true;
      if (p === path.join(targetDir, "nuwawork.db")) return false;
      return false;
    });
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({
        quickInit: {
          agentPort: 60006,
          fileServerPort: 60005,
          ttydPort: 60009,
          customPort: 23456,
        },
      }),
    );

    const { migrateDataDir } = await import("./migrate");
    migrateDataDir();

    expect(mockRenameSync).toHaveBeenCalledWith(oldConfig, newConfig);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.quickInit.agentPort).toBe(61006);
    expect(written.quickInit.fileServerPort).toBe(61005);
    expect(written.quickInit.ttydPort).toBe(61009);
    expect(written.quickInit.customPort).toBe(23456);
  });
});
