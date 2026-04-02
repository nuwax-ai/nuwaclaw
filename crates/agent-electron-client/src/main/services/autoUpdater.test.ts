/**
 * 单元测试: autoUpdater - 安装类型检测
 *
 * 测试 Windows 安装类型检测逻辑（NSIS vs MSI）
 * 通过 mock electron 和 fs 模块验证 getInstallerType() / canAutoUpdate() 的行为
 *
 * 注意: detectInstallerType 是私有函数，但 getInstallerType / canAutoUpdate 已导出
 * 每个测试重置模块缓存以清除 cachedInstallerType
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

const mockExistsSync = vi.fn((...args: unknown[]) => false);
const mockReaddirSync = vi.fn((...args: unknown[]) => [] as string[]);

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getName: () => "NuwaClaw",
    getPath: (name: string) => {
      if (name === "exe")
        return "C:\\Users\\user\\AppData\\Local\\Programs\\NuwaClaw\\NuwaClaw.exe";
      return "";
    },
    getAppPath: () => "/app",
    getVersion: () => "0.9.4",
  },
  BrowserWindow: class {},
  shell: {},
  dialog: {},
  net: {},
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: true,
  },
}));

// ── Helper ──

/** 重置模块缓存并重新导入，确保 cachedInstallerType 被清除 */
async function importFresh() {
  // 清除已缓存的模块
  const moduleId = require.resolve("./autoUpdater");
  delete require.cache[moduleId];
  // vi.resetModules 也清 vite 的模块缓存
  vi.resetModules();
  return import("./autoUpdater");
}

/** 让 process.platform 模拟为 win32 */
function mockWin32() {
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
}

/** 让 process.platform 模拟为 darwin */
function mockDarwin() {
  Object.defineProperty(process, "platform", {
    value: "darwin",
    configurable: true,
  });
}

/** 让 process.platform 模拟为 linux */
function mockLinux() {
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
}

/** 恢复 platform */
function restorePlatform() {
  // vitest 在 Node 中 process.platform 原值已丢失，记录初始值
  // 这里不做恢复，每个测试自己设 platform
}

// ── Tests ──

describe("autoUpdater - getInstallerType & canAutoUpdate", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  describe("macOS / Linux 平台", () => {
    it("macOS 应返回 'mac'", async () => {
      mockDarwin();
      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("mac");
    });

    it("Linux 应返回 'linux'", async () => {
      mockLinux();
      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("linux");
    });
  });

  describe("Windows NSIS 检测", () => {
    beforeEach(() => {
      mockWin32();
    });

    it("标准 NSIS: 存在 'Uninstall NuwaClaw.exe' 应返回 'nsis'", async () => {
      mockExistsSync.mockImplementation((...args: unknown[]) =>
        String(args[0]).includes("Uninstall NuwaClaw.exe"),
      );

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
    });

    it("通用 NSIS: 存在 unins000.exe 应返回 'nsis'", async () => {
      mockReaddirSync.mockReturnValue(["app.exe", "resources", "unins000.exe"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
    });

    it("通用 NSIS: unins001.exe 也应返回 'nsis'", async () => {
      mockReaddirSync.mockReturnValue(["app.exe", "unins001.exe"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
    });

    it("方式3: Uninstall.exe (无产品名) 应返回 'nsis'", async () => {
      mockReaddirSync.mockReturnValue(["app.exe", "Uninstall.exe"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
    });

    it("方式3: unins.exe 应返回 'nsis'", async () => {
      mockReaddirSync.mockReturnValue(["app.exe", "unins.exe"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
    });

    it("优先级: 标准 NSIS 优先于通用 NSIS", async () => {
      mockExistsSync.mockImplementation((...args: unknown[]) =>
        String(args[0]).includes("Uninstall NuwaClaw.exe"),
      );
      // 即使目录中也有 unins000.exe，应该先走 existsSync 的标准检测
      mockReaddirSync.mockReturnValue(["app.exe", "unins000.exe"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("nsis");
      // readdirSync 不应被调用（标准检测先命中）
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });
  });

  describe("Windows MSI 检测 (fallback)", () => {
    beforeEach(() => {
      mockWin32();
    });

    it("目录中无卸载程序文件应返回 'msi'", async () => {
      mockReaddirSync.mockReturnValue(["app.exe", "resources", "locales"]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("msi");
    });

    it("readdirSync 抛出异常应 fallback 为 'msi'", async () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("msi");
    });

    it("目录为空应返回 'msi'", async () => {
      mockReaddirSync.mockReturnValue([]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("msi");
    });

    it("不应将无关文件误判为 NSIS", async () => {
      mockReaddirSync.mockReturnValue([
        "app.exe",
        "nuwaclaw.exe",
        "setup.exe",
        "uninstall.dat",
        "uninstall", // 无扩展名
        "helper.dll",
      ]);

      const { getInstallerType } = await importFresh();
      expect(getInstallerType()).toBe("msi");
    });
  });

  describe("canAutoUpdate", () => {
    it("NSIS 应支持自动更新", async () => {
      mockWin32();
      mockExistsSync.mockImplementation((...args: unknown[]) =>
        String(args[0]).includes("Uninstall NuwaClaw.exe"),
      );

      const { canAutoUpdate } = await importFresh();
      expect(canAutoUpdate()).toBe(true);
    });

    it("MSI 不支持自动更新", async () => {
      mockWin32();
      mockReaddirSync.mockReturnValue(["app.exe"]);

      const { canAutoUpdate } = await importFresh();
      expect(canAutoUpdate()).toBe(false);
    });

    it("macOS 应支持自动更新", async () => {
      mockDarwin();
      const { canAutoUpdate } = await importFresh();
      expect(canAutoUpdate()).toBe(true);
    });
  });
});
