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
 * - Windows: NSIS 安装支持自动更新，MSI 安装引导到 Releases 页面
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
import {
  getWindowsDownloadUrl,
  getMacosDownloadUrl,
  getLinuxDownloadUrl,
  type Platforms,
} from "./updatePlatformUtils";

// ==================== OSS latest.json ====================

const OSS_BASE =
  "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/nuwaclaw-electron";
const OSS_LATEST_JSON_URL = `${OSS_BASE}/latest/latest.json`;

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
 * NSIS 安装会在应用目录下创建 `Uninstall {productName}.exe`，
 * MSI 安装由 Windows Installer 管理，不含此文件。
 */
function detectInstallerType(): InstallerType {
  if (!app.isPackaged) return "dev";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";

  if (process.platform === "win32") {
    const appDir = path.dirname(app.getPath("exe"));
    // electron-builder NSIS 会生成 "Uninstall {productName}.exe"
    const productName = app.getName();
    const nsisUninstaller = path.join(appDir, `Uninstall ${productName}.exe`);
    if (fs.existsSync(nsisUninstaller)) {
      log.info(
        `[AutoUpdater] Windows installer type: NSIS (found ${nsisUninstaller})`,
      );
      return "nsis";
    }
    log.info(
      "[AutoUpdater] Windows installer type: MSI (no NSIS uninstaller found)",
    );
    return "msi";
  }

  return "nsis"; // fallback
}

let cachedInstallerType: InstallerType | undefined;

function getInstallerType(): InstallerType {
  if (!cachedInstallerType) {
    cachedInstallerType = detectInstallerType();
  }
  return cachedInstallerType;
}

/**
 * 当前安装方式是否支持自动更新
 * - NSIS / mac / linux / dev: electron-updater 原生支持（dev 模式下载有单独 guard）
 * - MSI: 不支持，引导到 Releases 页面
 */
function canAutoUpdate(): boolean {
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
  setState({
    status: "checking",
    error: undefined,
    isReadOnlyVolumeError: undefined,
    canAutoUpdate: canAutoUpdate(),
  });

  let latestJson: LatestJson;

  try {
    latestJson = await fetchLatestJson(OSS_LATEST_JSON_URL);
  } catch (e: any) {
    log.error(
      `[AutoUpdater] Failed to fetch latest.json from OSS: ${e.message}`,
    );
    setState({
      status: "error",
      error: `无法获取更新信息: ${e.message}`,
      canAutoUpdate: canAutoUpdate(),
    });
    return { hasUpdate: false, error: `无法获取更新信息: ${e.message}` };
  }

  const hasUpdate = compareVersions(latestJson.version, app.getVersion()) > 0;

  if (hasUpdate) {
    // 指向版本化 OSS 路径，electron-updater 从该路径下载安装包
    const versionedUrl = `${OSS_BASE}/electron-v${latestJson.version}`;
    log.info(
      `[AutoUpdater] New version ${latestJson.version} found via latest.json, setting feed URL: ${versionedUrl}`,
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
      "[AutoUpdater] MSI installation detected: auto-download disabled, will redirect to releases page",
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
    // MSI 用户引导到 Releases 页面
    const { response } = await showModal({
      type: "info",
      title: "发现新版本",
      message: `发现新版本 v${version}`,
      detail:
        "当前安装方式不支持自动更新，请前往 Releases 页面下载最新安装包。",
      buttons: ["前往下载页", "跳过此版本", "关闭"],
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
    title: "发现新版本",
    message: `发现新版本 v${version}`,
    detail: "是否立即下载并安装更新？",
    buttons: ["立即更新", "跳过此版本", "关闭"],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 0) {
    try {
      const dlResult = await downloadUpdate();
      if (dlResult.success) {
        const { response: installResponse } = await showModal({
          type: "info",
          title: "更新已下载",
          message: "更新已下载完成",
          detail: "是否立即重启安装？",
          buttons: ["立即重启", "退出时安装"],
          defaultId: 0,
          cancelId: 1,
        });
        if (installResponse === 0) {
          installUpdate();
        }
      } else if (dlResult.error) {
        showModal({
          type: "error",
          title: "下载失败",
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
        title: "检查更新",
        message: "当前已是最新版本",
      });
      return;
    }

    const version = result.version ?? "unknown";
    const state = getUpdateState();

    if (state.canAutoUpdate === false) {
      const { response } = await showModal({
        type: "info",
        title: "发现新版本",
        message: `发现新版本 v${version}`,
        detail:
          "当前安装方式不支持自动更新，请前往 Releases 页面下载最新安装包。",
        buttons: ["前往下载页", "稍后再说"],
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
      title: "发现新版本",
      message: `发现新版本 v${version}`,
      detail: "是否立即下载更新？",
      buttons: ["下载更新", "稍后再说"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;

    const dlResult = await downloadUpdate();
    if (!dlResult.success) {
      if (dlResult.error)
        showModal({
          type: "error",
          title: "下载失败",
          message: dlResult.error,
        });
      return;
    }

    const { response: installResponse } = await showModal({
      type: "info",
      title: "更新已下载",
      message: "更新已下载完成",
      detail: "是否立即重启安装？",
      buttons: ["立即重启", "退出时安装"],
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
      title: "检查更新失败",
      message: e.message || "请稍后重试",
    });
  }
}

// ==================== 公开 API ====================

/**
 * 手动检查更新（通过 latest.json）
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  // 自定义更新源覆盖时，直接走 electron-updater（已在 init 中设置 feedURL）
  if (process.env.NUWAX_UPDATE_SERVER) {
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
      error: "开发模式不支持下载更新，请使用打包版本测试",
    };
  }

  // MSI 安装不支持自动更新，引导到 Releases 页面
  if (getInstallerType() === "msi") {
    log.info(
      "[AutoUpdater] MSI installation: redirecting to releases page for manual download",
    );
    openReleasesPage();
    return {
      success: false,
      error: "MSI 安装请前往 Releases 页面下载最新 MSI 安装包",
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
    return { success: false, error: "开发模式不支持安装更新" };
  }

  if (getInstallerType() === "msi") {
    openReleasesPage();
    return {
      success: false,
      error: "MSI 安装请前往 Releases 页面下载最新 MSI 安装包",
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
 * 打开下载页：从 OSS latest.json 获取当前平台对应的下载链接
 * - Windows: 按安装类型（NSIS/MSI）选择 .exe 或 .msi
 * - macOS: 根据架构选择 arm64/x64 .zip
 * - Linux: 根据架构选择 arm64/x64 AppImage
 * OSS 不可达时弹窗提示错误，不 fallback 到 GitHub
 */
export async function openReleasesPage(): Promise<void> {
  let url: string;
  let platformName: string;

  try {
    const latest = await fetchLatestJson(OSS_LATEST_JSON_URL);
    const platforms: Platforms | undefined = latest.platforms;

    if (process.platform === "win32") {
      const installerType = getInstallerType();
      url = getWindowsDownloadUrl(platforms, installerType);
      platformName = `Windows (${installerType})`;
    } else if (process.platform === "darwin") {
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
      `[AutoUpdater] Opening ${platformName} download URL from OSS: ${url}`,
    );
    await shell.openExternal(url);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[AutoUpdater] Failed to get download URL from OSS: ${msg}`);
    // 弹窗提示用户，不 fallback 到 GitHub
    await showModal({
      type: "error",
      title: "获取下载链接失败",
      message: "无法从服务器获取下载链接",
      detail: `错误: ${msg}\n\n请检查网络连接后重试。`,
    });
  }
}
