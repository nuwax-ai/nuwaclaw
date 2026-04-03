/**
 * 自动更新服务 - 基于 electron-updater + latest.json
 *
 * 更新检查流程：
 * 1. 从阿里云 OSS 拉取 latest.json 获取最新版本号
 * 2. 比较版本号，如有更新则将 electron-updater 指向版本化 OSS 路径
 * 3. electron-updater 从版本化路径读取 latest-*.yml 完成下载/安装
 *
 * - autoDownload = false: 用户控制下载时机
 * - autoInstallOnAppQuit = true: 下载完成后退出时自动安装
 * - Windows: NSIS 安装支持自动更新，MSI 安装引导到官网下载安装页
 */

import { app, BrowserWindow, shell, dialog, net } from "electron";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import type {
  UpdateState,
  UpdateInfo,
  UpdateProgress,
} from "@shared/types/updateTypes";
import { APP_DATA_DIR_NAME } from "@shared/constants";
import { readSetting } from "../db";
import { t } from "./i18n";
import {
  getWindowsDownloadUrl,
  getMacosDownloadUrl,
  getLinuxDownloadUrl,
  type Platforms,
} from "./updatePlatformUtils";

// ==================== OSS latest.json ====================

const OSS_BASE =
  "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron";
const OSS_STABLE_LATEST_JSON_URL = `${OSS_BASE}/latest/latest.json`;
const OSS_BETA_LATEST_JSON_URL = `${OSS_BASE}/beta/latest.json`;
const OFFICIAL_DOWNLOAD_PAGE_URL = "https://nuwax.com/nuwaclaw.html";
type UpdateChannel = "stable" | "beta";
const UPDATE_CHANNEL_SETTING_KEY = "update_channel";

/** Squirrel.Mac 在只读卷（如从「下载」直接打开）上无法就地更新时的错误信息特征 */
const READ_ONLY_VOLUME_ERROR_SUBSTR = "read-only volume";

function isReadOnlyVolumeError(err: Error): boolean {
  return err?.message?.includes(READ_ONLY_VOLUME_ERROR_SUBSTR) ?? false;
}

interface LatestJson {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<
    string,
    { url: string; signature?: string; size?: number }
  >;
  /** yml 文件的完整 OSS URL（新增字段，CI 生成；旧版 CI 无此字段则降级到老逻辑） */
  yml?: Record<string, string>;
}

function getUpdateChannel(): UpdateChannel {
  const raw = readSetting(UPDATE_CHANNEL_SETTING_KEY);
  return raw === "beta" ? "beta" : "stable";
}

function getLatestJsonUrlByChannel(channel: UpdateChannel): string {
  return channel === "beta"
    ? OSS_BETA_LATEST_JSON_URL
    : OSS_STABLE_LATEST_JSON_URL;
}

/**
 * 从 OSS 拉取 latest.json
 */
function fetchLatestJson(url: string, timeoutMs = 15_000): Promise<LatestJson> {
  return new Promise((resolve, reject) => {
    // 添加时间戳参数绕过 CDN/浏览器缓存，确保每次都获取最新版本信息
    const cacheBustUrl = url.includes("?")
      ? `${url}&_t=${Date.now()}`
      : `${url}?_t=${Date.now()}`;
    const request = net.request(cacheBustUrl);
    let body = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        request.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms fetching ${url}`));
      }
    }, timeoutMs);

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
        return;
      }
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    });
    request.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    request.end();
  });
}

// ==================== 安装类型检测 ====================

type InstallerType = "nsis" | "msi" | "mac" | "linux" | "dev";

/**
 * 检测 Windows 安装类型（NSIS vs MSI）
 *
 * NSIS 安装会在应用目录下创建卸载程序文件，按优先级检测：
 * 1. 标准命名：Uninstall {productName}.exe
 * 2. NSIS 通用命名：unins000.exe, unins001.exe 等
 * 3. 匹配 Uninstall*.exe 或 unins*.exe（避免误判其他文件）
 *
 * MSI 安装由 Windows Installer 管理，通常不含卸载程序文件。
 */
function detectInstallerType(): InstallerType {
  if (!app.isPackaged) return "dev";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";

  if (process.platform === "win32") {
    const appDir = path.dirname(app.getPath("exe"));

    // 方式1: 标准的 electron-builder NSIS 卸载程序
    // 文件名格式: "Uninstall {productName}.exe"
    const productName = app.getName();
    const standardNsisUninstaller = path.join(
      appDir,
      `Uninstall ${productName}.exe`,
    );
    if (fs.existsSync(standardNsisUninstaller)) {
      log.info(
        `[AutoUpdater] Windows installer type: NSIS (found standard uninstaller: ${standardNsisUninstaller})`,
      );
      return "nsis";
    }

    // 方式2和3: 读取目录一次，检查多种 NSIS 卸载程序模式
    // 避免重复调用 readdirSync，提高性能
    let appFiles: string[] | undefined;
    try {
      appFiles = fs.readdirSync(appDir);
    } catch (e) {
      log.warn("[AutoUpdater] Failed to read app directory:", e);
    }

    if (appFiles && appFiles.length > 0) {
      // 方式2: NSIS 通用卸载程序模式 (unins000.exe, unins001.exe 等)
      const genericNsisUninstaller = appFiles.find((f) =>
        /^unins\d{3}\.exe$/i.test(f),
      );
      if (genericNsisUninstaller) {
        log.info(
          `[AutoUpdater] Windows installer type: NSIS (found generic NSIS uninstaller: ${genericNsisUninstaller})`,
        );
        return "nsis";
      }

      // 方式3: 匹配 Uninstall*.exe 或 unins*.exe 开头的文件
      // 严格模式：避免误判如 "uninstaller_helper.exe" 等非卸载程序文件
      const anyUninstaller = appFiles.find((f) => {
        const lowerName = f.toLowerCase();
        return (
          // Uninstall 开头 + .exe 结尾（如 Uninstall.exe, Uninstall-1.0.0.exe）
          (lowerName.startsWith("uninstall") && lowerName.endsWith(".exe")) ||
          // unins 开头但不是 uninsNNN.exe 模式的（兼容其他 NSIS 变体）
          (lowerName.startsWith("unins") &&
            !/^unins\d{3}\.exe$/i.test(f) &&
            lowerName.endsWith(".exe"))
        );
      });
      if (anyUninstaller) {
        log.info(
          `[AutoUpdater] Windows installer type: NSIS (found uninstaller: ${anyUninstaller})`,
        );
        return "nsis";
      }
    }

    // Fallback: 找不到任何卸载程序文件，判定为 MSI
    log.info(
      "[AutoUpdater] Windows installer type: MSI (no uninstaller found in app directory)",
    );
    return "msi";
  }

  return "nsis"; // 非预期平台 fallback（实际 win32/mac/linux 已覆盖）
}

let cachedInstallerType: InstallerType | undefined;

export function getInstallerType(): InstallerType {
  if (!cachedInstallerType) {
    cachedInstallerType = detectInstallerType();
  }
  return cachedInstallerType;
}

/**
 * 当前安装方式是否支持自动更新
 * - NSIS / mac / linux / dev: electron-updater 原生支持（dev 模式下载有单独 guard）
 * - MSI: 不支持，引导到官网下载安装页
 */
export function canAutoUpdate(): boolean {
  const type = getInstallerType();
  return type !== "msi";
}

// ==================== 跳过版本管理 ====================

function getSkippedVersionFile(): string {
  return path.join(
    app.getPath("home"),
    APP_DATA_DIR_NAME,
    ".skipped-update-version",
  );
}

function getSkippedVersion(): string | null {
  try {
    const file = getSkippedVersionFile();
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf-8").trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function setSkippedVersion(version: string): void {
  try {
    const file = getSkippedVersionFile();
    fs.writeFileSync(file, version, "utf-8");
    log.info(`[AutoUpdater] Skipped version set: ${version}`);
  } catch (e) {
    log.warn("[AutoUpdater] Failed to save skipped version:", e);
  }
}

// ==================== 更新状态管理 ====================

/**
 * 语义化版本比较: a > b 返回 1, a < b 返回 -1, 相等返回 0
 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * MVP 仅支持 x.y.z 纯数字版本，避免 compareVersions 对 prerelease 得到 NaN
 */
function isNumericSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version.trim());
}

let currentState: UpdateState = { status: "idle" };
let getMainWindow: (() => BrowserWindow | null) | null = null;
let cleanupBeforeInstall: (() => void) | null = null;
/**
 * 在 quitAndInstall 前调用，通知主进程：
 * 1. 设置 isQuitting = true，防止窗口 close 事件被拦截到托盘
 * 2. 设置 isInstallingUpdate = true，让 before-quit 跳过 e.preventDefault()，
 *    允许 Squirrel.Mac 正常接管退出流程完成安装
 */
let markQuitting: (() => void) | null = null;

function sendStatusToRenderer(): void {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send("update:status", currentState);
  }
}

/**
 * 显示模态对话框（挂载到主窗口，避免 Linux 标题栏图标显示异常）
 */
function showModal(
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) {
    return dialog.showMessageBox(win, options);
  }
  return dialog.showMessageBox(options);
}

function setState(patch: Partial<UpdateState>): void {
  currentState = { ...currentState, ...patch };
  sendStatusToRenderer();
}

// ==================== latest.json 更新检查 ====================

let checkInProgress = false;

/**
 * 通过 OSS latest.json 检查更新
 *
 * 流程：
 * 1. 拉取 latest.json 获取最新版本号和 signature
 * 2. 与本地版本比较
 * 3. 如果有更新，设置 electron-updater feedURL 指向版本化 OSS 路径，
 *    并调用 autoUpdater.checkForUpdates() 初始化 electron-updater 下载状态
 * 4. OSS 不可达时直接报错，不 fallback 到 GitHub
 */
async function checkForUpdatesViaLatestJson(): Promise<UpdateInfo> {
  if (checkInProgress) {
    log.info("[AutoUpdater] Check already in progress, skipping");
    // 返回 alreadyChecking: true，让调用方知道检查正在进行，避免误报"当前已是最新版本"
    return { hasUpdate: false, alreadyChecking: true };
  }
  checkInProgress = true;

  try {
    return await doCheckViaLatestJson();
  } finally {
    checkInProgress = false;
  }
}

async function doCheckViaLatestJson(): Promise<UpdateInfo> {
  const { autoUpdater } = require("electron-updater");
  const updateChannel = getUpdateChannel();
  const latestJsonUrl = getLatestJsonUrlByChannel(updateChannel);
  log.info(
    `[AutoUpdater] Check updates via channel=${updateChannel}, url=${latestJsonUrl}`,
  );
  setState({
    status: "checking",
    error: undefined,
    isReadOnlyVolumeError: undefined,
    canAutoUpdate: canAutoUpdate(),
  });

  let latestJson: LatestJson;

  try {
    latestJson = await fetchLatestJson(latestJsonUrl);
  } catch (e: any) {
    // 日志保留完整错误信息（含 URL），用户提示仅显示 HTTP 状态码
    log.error(
      `[AutoUpdater] Failed to fetch latest.json from OSS(channel=${updateChannel}): ${e.message}`,
    );
    const statusMatch = e.message.match(/^HTTP (\d+)/);
    const userMsg = statusMatch
      ? `HTTP ${statusMatch[1]}`
      : t("Claw.AutoUpdater.networkFailed");
    setState({
      status: "error",
      error: `${t("Claw.AutoUpdater.getUpdateInfoFailed", updateChannel)}: ${userMsg}`,
      canAutoUpdate: canAutoUpdate(),
    });
    return {
      hasUpdate: false,
      error: `${t("Claw.AutoUpdater.getUpdateInfoFailed", updateChannel)}: ${userMsg}`,
    };
  }

  if (!isNumericSemver(latestJson.version)) {
    const msg = t(
      "Claw.AutoUpdater.invalidMetadataVersion",
      latestJson.version,
    );
    log.error(
      `[AutoUpdater] Invalid latest.json version for channel=${updateChannel}: ${latestJson.version}`,
    );
    setState({
      status: "error",
      error: msg,
      canAutoUpdate: canAutoUpdate(),
    });
    return { hasUpdate: false, error: msg };
  }

  const hasUpdate = compareVersions(latestJson.version, app.getVersion()) > 0;

  if (hasUpdate) {
    // 优先从 latest.json 的 yml 字段读取完整 yml URL（CI 生成，支持任意 OSS 路径结构）
    // 降级老逻辑：客户端自己拼接 electron-v{version} 或 beta-build/prerelease-v{version} 路径
    // 注意：ymlUrl 是文件 URL（.../latest.yml），但 setFeedURL 期望目录路径，它会自动拼接 {channel}.yml
    const platformKey = process.platform === "win32" ? "win" : process.platform;
    const ymlUrl = latestJson.yml?.[platformKey];
    // 去掉文件名得到目录路径，供 electron-updater generic provider 自动拼接 {channel}.yml
    const ymlDir = ymlUrl ? ymlUrl.replace(/\/[^/]+\.yml$/, "/") : null;
    const versionedUrl = ymlDir
      ? ymlDir
      : updateChannel === "beta"
        ? `${OSS_BASE}/beta-build/prerelease-v${latestJson.version}`
        : `${OSS_BASE}/electron-v${latestJson.version}`;
    log.info(
      `[AutoUpdater] New version ${latestJson.version} found via channel=${updateChannel}, ymlUrl=${ymlUrl ?? "none (using fallback)"}, feedUrl=${versionedUrl}`,
    );
    autoUpdater.setFeedURL({ provider: "generic", url: versionedUrl });
    // 初始化 electron-updater 内部状态，为后续 downloadUpdate() 做准备
    await autoUpdater.checkForUpdates();
  } else {
    setState({
      status: "not-available",
      canAutoUpdate: canAutoUpdate(),
    });
  }

  return {
    hasUpdate,
    version: latestJson.version,
    releaseNotes: latestJson.notes,
  };
}

// ==================== 初始化 ====================

/**
 * 初始化自动更新（应在 app.whenReady 后调用）
 * @param getWindow 获取主窗口
 * @param cleanup 安装更新前的清理回调（停止服务、关闭数据库等）
 * @param onMarkQuitting 在调用 quitAndInstall 前调用，用于设置主进程的 isQuitting/isInstallingUpdate 标志，
 *                       防止窗口 close 被拦截，并让 before-quit 不阻止退出
 */
export function initAutoUpdater(
  getWindow: () => BrowserWindow | null,
  cleanup?: () => void,
  onMarkQuitting?: () => void,
): void {
  getMainWindow = getWindow;
  cleanupBeforeInstall = cleanup || null;
  markQuitting = onMarkQuitting || null;

  const installerType = getInstallerType();
  log.info(
    `[AutoUpdater] Installer type: ${installerType}, canAutoUpdate: ${canAutoUpdate()}`,
  );

  // MSI 安装只支持检查更新，不支持自动下载/安装
  if (installerType === "msi") {
    log.info(
      "[AutoUpdater] MSI installation detected: auto-download disabled, will redirect to official download page",
    );
  }

  // CJS 兼容导入 electron-updater
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require("electron-updater");

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = canAutoUpdate();

  // 开发模式：使用 dev-app-update.yml 配置，禁用自动安装（Squirrel.Mac 无法匹配 dev bundle ID）
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.autoInstallOnAppQuit = false;
    log.info(
      "[AutoUpdater] Dev mode: using dev-app-update.yml (autoInstall disabled)",
    );
  }

  // 自定义更新源覆盖（本地测试），直接走 electron-updater 的 generic provider
  const customServer = process.env.NUWAX_UPDATE_SERVER;
  if (customServer) {
    log.info(`[AutoUpdater] Using custom update server: ${customServer}`);
    autoUpdater.setFeedURL({ provider: "generic", url: customServer });
  }

  // -------- 事件监听 --------

  autoUpdater.on("checking-for-update", () => {
    log.info("[AutoUpdater] Checking for update...");
    setState({
      status: "checking",
      isReadOnlyVolumeError: undefined,
      canAutoUpdate: canAutoUpdate(),
    });
  });

  autoUpdater.on("update-available", (info: any) => {
    log.info("[AutoUpdater] Update available:", info.version);
    setState({
      status: "available",
      version: info.version,
      isReadOnlyVolumeError: undefined,
      canAutoUpdate: canAutoUpdate(),
    });
  });

  autoUpdater.on("update-not-available", (_info: any) => {
    log.info("[AutoUpdater] Already up to date");
    setState({
      status: "not-available",
      isReadOnlyVolumeError: undefined,
      canAutoUpdate: canAutoUpdate(),
    });
  });

  autoUpdater.on("download-progress", (progress: UpdateProgress) => {
    log.info(
      `[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`,
    );
    setState({
      status: "downloading",
      progress,
      canAutoUpdate: true,
    });
  });

  autoUpdater.on("update-downloaded", (info: any) => {
    log.info("[AutoUpdater] Update downloaded:", info.version);
    setState({
      status: "downloaded",
      version: info.version,
      progress: undefined,
      canAutoUpdate: true,
    });
  });

  autoUpdater.on("error", (err: Error) => {
    log.error("[AutoUpdater] Error:", err.message);
    setState({
      status: "error",
      error: err.message,
      progress: undefined,
      canAutoUpdate: canAutoUpdate(),
      isReadOnlyVolumeError: isReadOnlyVolumeError(err),
    });
  });

  // 延迟 10s 启动时检查一次，发现新版本弹窗提示；退出时清除避免在已退出状态下弹窗
  const STARTUP_CHECK_DELAY_MS = 10_000;
  const startupCheckTimerId = setTimeout(async () => {
    log.info("[AutoUpdater] Initial startup check");
    try {
      const result = await checkForUpdatesViaLatestJson();
      if (result.hasUpdate && result.version) {
        const skipped = getSkippedVersion();
        if (skipped === result.version) {
          log.info(
            `[AutoUpdater] Startup: v${result.version} was skipped by user, not prompting`,
          );
          return;
        }
        log.info(`[AutoUpdater] Startup: found new version v${result.version}`);
        showStartupUpdateDialog(result.version);
      }
    } catch (e: any) {
      log.warn("[AutoUpdater] Startup check failed:", e.message);
    }
  }, STARTUP_CHECK_DELAY_MS);

  app.once("before-quit", () => {
    clearTimeout(startupCheckTimerId);
  });
}

/**
 * 启动时发现新版本的弹窗提示
 */
async function showStartupUpdateDialog(version: string): Promise<void> {
  if (!canAutoUpdate()) {
    // MSI 用户引导到官网下载安装页
    const { response } = await showModal({
      type: "info",
      title: t("Claw.AutoUpdater.newVersionFound"),
      message: t("Claw.AutoUpdater.versionFound", version),
      detail: t("Claw.AutoUpdater.unsupportedInstall"),
      buttons: [
        t("Claw.AutoUpdater.downloadPage"),
        t("Claw.AutoUpdater.skipThisVersion"),
        t("Claw.AutoUpdater.close"),
      ],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) {
      openReleasesPage();
    } else if (response === 1) {
      setSkippedVersion(version);
    }
    return;
  }

  const { response } = await showModal({
    type: "info",
    title: t("Claw.AutoUpdater.newVersionFound"),
    message: t("Claw.AutoUpdater.versionFound", version),
    detail: t("Claw.AutoUpdater.downloadInstallNow"),
    buttons: [
      t("Claw.AutoUpdater.downloadNow"),
      t("Claw.AutoUpdater.skipThisVersion"),
      t("Claw.AutoUpdater.close"),
    ],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 0) {
    try {
      const dlResult = await downloadUpdate();
      if (dlResult.success) {
        const { response: installResponse } = await showModal({
          type: "info",
          title: t("Claw.AutoUpdater.updateDownloaded"),
          message: t("Claw.AutoUpdater.updateReady"),
          detail: t("Claw.AutoUpdater.installNow"),
          buttons: [
            t("Claw.AutoUpdater.installNow"),
            t("Claw.AutoUpdater.installOnExit"),
          ],
          defaultId: 0,
          cancelId: 1,
        });
        if (installResponse === 0) {
          installUpdate();
        }
      } else if (dlResult.error) {
        showModal({
          type: "error",
          title: t("Claw.AutoUpdater.downloadFailed"),
          message: dlResult.error,
        });
      }
    } catch (e: any) {
      log.error("[AutoUpdater] Startup download failed:", e.message);
    }
  } else {
    setSkippedVersion(version);
  }
}

/**
 * 通用更新对话框流程（供托盘菜单等外部调用）
 * 检查更新 → 有更新则弹窗 → 下载 → 二次确认 → 安装
 */
export async function showUpdateDialogFlow(): Promise<void> {
  try {
    const result = await checkForUpdates();
    if (!result.hasUpdate) {
      showModal({
        type: "info",
        title: t("Claw.AutoUpdater.checking"),
        message: t("Claw.AutoUpdater.alreadyLatest"),
      });
      return;
    }

    const version = result.version ?? "unknown";
    const state = getUpdateState();

    if (state.canAutoUpdate === false) {
      const { response } = await showModal({
        type: "info",
        title: t("Claw.AutoUpdater.newVersionFound"),
        message: t("Claw.AutoUpdater.versionFound", version),
        detail: t("Claw.AutoUpdater.unsupportedInstall"),
        buttons: [
          t("Claw.AutoUpdater.downloadPage"),
          t("Claw.AutoUpdater.later"),
        ],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        openReleasesPage();
      }
      return;
    }

    const { response } = await showModal({
      type: "info",
      title: t("Claw.AutoUpdater.newVersionFound"),
      message: t("Claw.AutoUpdater.versionFound", version),
      detail: t("Claw.AutoUpdater.downloadInstallNow"),
      buttons: [t("Claw.AutoUpdater.downloadNow"), t("Claw.AutoUpdater.later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;

    const dlResult = await downloadUpdate();
    if (!dlResult.success) {
      if (dlResult.error)
        showModal({
          type: "error",
          title: t("Claw.AutoUpdater.downloadFailed"),
          message: dlResult.error,
        });
      return;
    }

    const { response: installResponse } = await showModal({
      type: "info",
      title: t("Claw.AutoUpdater.updateDownloaded"),
      message: t("Claw.AutoUpdater.updateReady"),
      detail: t("Claw.AutoUpdater.installNow"),
      buttons: [
        t("Claw.AutoUpdater.installNow"),
        t("Claw.AutoUpdater.installOnExit"),
      ],
      defaultId: 0,
      cancelId: 1,
    });
    if (installResponse === 0) {
      installUpdate();
    }
  } catch (e: any) {
    log.error("[AutoUpdater] Update dialog flow error:", e.message);
    showModal({
      type: "error",
      title: t("Claw.AutoUpdater.checkFailed"),
      message: e.message || t("Claw.AutoUpdater.later"),
    });
  }
}

// ==================== 公开 API ====================

/**
 * 手动检查更新（通过 latest.json）
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  // 自定义更新源（本地测试用）直接走 electron-updater，适用于 stable 通道
  // beta 通道始终走 doCheckViaLatestJson，确保 feedURL 指向 beta-build 路径
  if (process.env.NUWAX_UPDATE_SERVER && getUpdateChannel() === "stable") {
    try {
      const { autoUpdater } = require("electron-updater");
      setState({
        status: "checking",
        error: undefined,
        isReadOnlyVolumeError: undefined,
        canAutoUpdate: canAutoUpdate(),
      });
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo) {
        const hasUpdate =
          compareVersions(result.updateInfo.version, app.getVersion()) > 0;
        return {
          hasUpdate,
          version: result.updateInfo.version,
          releaseDate: result.updateInfo.releaseDate,
          releaseNotes:
            typeof result.updateInfo.releaseNotes === "string"
              ? result.updateInfo.releaseNotes
              : undefined,
        };
      }
      return { hasUpdate: false };
    } catch (err: any) {
      log.error("[AutoUpdater] checkForUpdates error:", err.message);
      setState({
        status: "error",
        error: err.message,
        canAutoUpdate: canAutoUpdate(),
      });
      return { hasUpdate: false, error: err.message };
    }
  }

  return checkForUpdatesViaLatestJson();
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<{
  success: boolean;
  error?: string;
}> {
  // Dev 模式下 Squirrel.Mac 无法处理更新包（bundle ID 不匹配），只允许检查更新
  if (!app.isPackaged) {
    log.warn(
      "[AutoUpdater] Download skipped in dev mode (Squirrel.Mac requires packaged app)",
    );
    return {
      success: false,
      error: t("Claw.AutoUpdater.devModeUnsupported"),
    };
  }

  // MSI 安装不支持自动更新，引导到官网下载安装页
  if (getInstallerType() === "msi") {
    log.info(
      "[AutoUpdater] MSI installation: redirecting to official download page for manual download",
    );
    openReleasesPage();
    return {
      success: false,
      error: t("Claw.AutoUpdater.unsupportedInstall"),
    };
  }

  try {
    // 立即设置 downloading 状态，让渲染进程马上显示 loading
    setState({
      status: "downloading",
      progress: undefined,
      canAutoUpdate: true,
    });
    const { autoUpdater } = require("electron-updater");
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err: any) {
    log.error("[AutoUpdater] downloadUpdate error:", err.message);
    setState({
      status: "error",
      error: err.message,
      canAutoUpdate: canAutoUpdate(),
      isReadOnlyVolumeError: isReadOnlyVolumeError(err),
    });
    return { success: false, error: err.message };
  }
}

/**
 * 退出并安装更新
 */
export function installUpdate(): { success: boolean; error?: string } {
  if (!app.isPackaged) {
    return {
      success: false,
      error: t("Claw.AutoUpdater.installDevUnsupported"),
    };
  }

  if (getInstallerType() === "msi") {
    openReleasesPage();
    return {
      success: false,
      error: t("Claw.AutoUpdater.unsupportedInstall"),
    };
  }

  try {
    // 关键：在 quitAndInstall 前设置退出标志（所有平台通用）
    // 原因1：quitAndInstall 会触发 app.quit()，进而触发窗口 close 事件；
    //   若 isQuitting 未设置，close 会被拦截到托盘，app 无法正常退出
    // 原因2：通知 before-quit handler 跳过 e.preventDefault()，
    //   让各平台的安装器（macOS Squirrel.Mac / Windows NSIS / Linux AppImage）
    //   正常接管退出流程完成安装；否则 e.preventDefault() 会阻止安装器触发
    if (markQuitting) {
      log.info("[AutoUpdater] Marking app as quitting for update install...");
      markQuitting();
    }

    // 先停止所有服务，避免残留进程（cleanup 是同步触发的异步操作）
    if (cleanupBeforeInstall) {
      log.info("[AutoUpdater] Running cleanup before install...");
      cleanupBeforeInstall();
    }
    const { autoUpdater } = require("electron-updater");
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err: any) {
    log.error("[AutoUpdater] installUpdate error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 获取当前更新状态
 */
export function getUpdateState(): UpdateState {
  return { ...currentState, canAutoUpdate: canAutoUpdate() };
}

/**
 * 打开下载页：
 * - Windows: 统一打开官网下载安装页（避免 MSI/EXE 安装路径不一致带来的升级问题）
 * - macOS/Linux: 从 OSS latest.json 获取当前平台对应下载链接
 * - macOS: 根据架构选择 arm64/x64 .zip
 * - Linux: 根据架构选择 arm64/x64 AppImage
 * OSS 不可达时弹窗提示错误，不 fallback 到 GitHub
 */
export async function openReleasesPage(): Promise<void> {
  if (process.platform === "win32") {
    log.info(
      `[AutoUpdater] Opening official download page on Windows: ${OFFICIAL_DOWNLOAD_PAGE_URL}`,
    );
    await shell.openExternal(OFFICIAL_DOWNLOAD_PAGE_URL);
    return;
  }

  let url: string;
  let platformName: string;
  const updateChannel = getUpdateChannel();
  const latestJsonUrl = getLatestJsonUrlByChannel(updateChannel);

  try {
    log.info(
      `[AutoUpdater] Resolve download URL via channel=${updateChannel}, url=${latestJsonUrl}`,
    );
    const latest = await fetchLatestJson(latestJsonUrl);
    const platforms: Platforms | undefined = latest.platforms;

    if (process.platform === "darwin") {
      url = getMacosDownloadUrl(platforms);
      platformName = `macOS (${process.arch})`;
    } else {
      url = getLinuxDownloadUrl(platforms);
      platformName = `Linux (${process.arch})`;
    }

    if (!url) {
      throw new Error(`未找到 ${platformName} 对应的下载包`);
    }

    log.info(
      `[AutoUpdater] Opening ${platformName} download URL from OSS(channel=${updateChannel}): ${url}`,
    );
    await shell.openExternal(url);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(
      `[AutoUpdater] Failed to get download URL from OSS(channel=${updateChannel}): ${msg}`,
    );
    // 弹窗提示用户，不 fallback 到 GitHub
    await showModal({
      type: "error",
      title: t("Claw.AutoUpdater.getDownloadLinkFailed"),
      message: t("Claw.AutoUpdater.getDownloadLinkFailedDetail", msg),
    });
  }
}
