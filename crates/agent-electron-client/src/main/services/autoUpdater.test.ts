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

vi.mock("@shared/constants", () => ({
  APP_DATA_DIR_NAME: ".nuwaclaw",
}));

vi.mock("../db", () => ({
  readSetting: vi.fn(),
}));

vi.mock("./i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("./updatePlatformUtils", () => ({
  getWindowsDownloadUrl: vi.fn(),
  getMacosDownloadUrl: vi.fn(),
  getLinuxDownloadUrl: vi.fn(),
}));

// ── Helper ──

/** 重置模块缓存并重新导入，确保 cachedInstallerType 被清除 */
async function importFresh() {
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

// ── yml URL 处理逻辑测试 ──
// 测试 electron-updater generic provider 的 URL 构造行为：
// setFeedURL({ provider: "generic", url: "https://.../dir/" }) 会自动拼接 {channel}.yml
// 因此传入的 URL 必须是目录路径（以 / 结尾），而不是文件 URL

describe("autoUpdater - yml URL 处理", () => {
  // 纯函数测试：模拟 doCheckViaLatestJson 中的 URL 推导逻辑
  function deriveFeedUrl(params: {
    ymlUrl: string | null;
    updateChannel: "stable" | "beta";
    version: string;
  }): string {
    const OSS_BASE =
      "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron";
    const { ymlUrl, updateChannel, version } = params;
    // 从 yml 文件 URL 提取目录路径（electron-updater generic provider 期望目录 URL）
    const ymlDir = ymlUrl ? ymlUrl.replace(/\/[^/]+\.yml$/, "/") : null;
    return ymlDir
      ? ymlDir
      : updateChannel === "beta"
        ? `${OSS_BASE}/beta-build/prerelease-v${version}`
        : `${OSS_BASE}/electron-v${version}`;
  }

  describe("yml 文件 URL → 目录 URL 转换（供 electron-updater generic provider 使用）", () => {
    it("Windows: yml 文件 URL 应提取为目录 URL", () => {
      const ymlUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest.yml";
      const result = deriveFeedUrl({
        ymlUrl,
        updateChannel: "beta",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/",
      );
    });

    it("macOS: yml 文件 URL 应提取为目录 URL", () => {
      const ymlUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest-mac.yml";
      const result = deriveFeedUrl({
        ymlUrl,
        updateChannel: "beta",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/",
      );
    });

    it("Linux: yml 文件 URL 应提取为目录 URL", () => {
      const ymlUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest-linux.yml";
      const result = deriveFeedUrl({
        ymlUrl,
        updateChannel: "beta",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/",
      );
    });

    it("stable 通道: yml 文件 URL 应提取为目录 URL", () => {
      const ymlUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/electron-v0.10.7/latest.yml";
      const result = deriveFeedUrl({
        ymlUrl,
        updateChannel: "stable",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/electron-v0.10.7/",
      );
    });
  });

  describe("降级逻辑（yml 字段缺失时的 fallback）", () => {
    it("yml 字段缺失时，beta 通道应使用 beta-build/prerelease-v{version} 路径", () => {
      const result = deriveFeedUrl({
        ymlUrl: null,
        updateChannel: "beta",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7",
      );
    });

    it("yml 字段缺失时，stable 通道应使用 electron-v{version} 路径", () => {
      const result = deriveFeedUrl({
        ymlUrl: null,
        updateChannel: "stable",
        version: "0.10.7",
      });
      expect(result).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/electron-v0.10.7",
      );
    });
  });

  describe("electron-updater generic provider URL 拼接验证", () => {
    // 模拟 GenericProvider 的 URL 构造行为：
    // new URL(channelFile, newBaseUrl(directoryUrl))
    // newBaseUrl 会确保目录 URL 以 / 结尾
    function simulateGenericProvider(
      channelFile: string,
      feedUrl: string,
    ): string {
      const url = new URL(feedUrl);
      if (!url.pathname.endsWith("/")) {
        url.pathname += "/";
      }
      return new URL(channelFile, url).toString();
    }

    it("目录 URL 传给 electron-updater 应拼接出正确的 yml 文件路径", () => {
      const feedUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/";
      const windowsResult = simulateGenericProvider("latest.yml", feedUrl);
      const macResult = simulateGenericProvider("latest-mac.yml", feedUrl);
      const linuxResult = simulateGenericProvider("latest-linux.yml", feedUrl);

      expect(windowsResult).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest.yml",
      );
      expect(macResult).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest-mac.yml",
      );
      expect(linuxResult).toBe(
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest-linux.yml",
      );
    });

    it("文件 URL 传给 electron-updater 会导致路径重复（Bug 演示）", () => {
      // 这是之前错误的做法：直接传文件 URL
      const fileUrl =
        "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron/beta-build/prerelease-v0.10.7/latest.yml";
      const result = simulateGenericProvider("latest.yml", fileUrl);

      // URL 构造器会将 /latest.yml 当作文件名，拼接后变成 /beta-build/prerelease-v0.10.7//latest.yml/latest.yml
      // 最终标准化为 .../beta-build/prerelease-v0.10.7/latest.yml/latest.yml（路径重复）
      expect(result).toContain("latest.yml/latest.yml");
    });
  });
});
