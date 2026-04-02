/**
 * GUI Agent 平台权限检测与引导
 *
 * 三平台权限处理：
 * - macOS: Screen Recording + Accessibility
 * - Windows: 不需要额外权限
 * - Linux: X11 自动支持；Wayland 受限；需要 xdotool
 */

import { desktopCapturer, systemPreferences, shell } from "electron";
import { execSync } from "child_process";
import log from "electron-log";
import type {
  GuiPermissionInfo,
  GuiPermissionState,
} from "@shared/types/guiAgentTypes";

const TAG = "[GuiPermission]";

/**
 * 检测当前平台的 GUI 相关权限状态
 */
export function checkGuiPermissions(): GuiPermissionInfo {
  const platform = process.platform;

  if (platform === "darwin") {
    return checkMacPermissions();
  }
  if (platform === "win32") {
    return {
      screenCapture: "not_needed",
      accessibility: "not_needed",
      platform,
    };
  }
  if (platform === "linux") {
    return checkLinuxPermissions();
  }

  return {
    screenCapture: "unknown",
    accessibility: "unknown",
    platform,
  };
}

function checkMacPermissions(): GuiPermissionInfo {
  let screenCapture: GuiPermissionState = "unknown";
  let accessibility: GuiPermissionState = "unknown";

  try {
    const screenStatus = systemPreferences.getMediaAccessStatus("screen");
    screenCapture = screenStatus === "granted" ? "granted" : "denied";
  } catch (e) {
    log.warn(`${TAG} Failed to check screen capture permission:`, e);
  }

  try {
    // isTrustedAccessibilityClient(false) = check only, don't prompt
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    accessibility = trusted ? "granted" : "denied";
  } catch (e) {
    log.warn(`${TAG} Failed to check accessibility permission:`, e);
  }

  return {
    screenCapture,
    accessibility,
    platform: "darwin",
  };
}

function checkLinuxPermissions(): GuiPermissionInfo {
  let displayServer: "x11" | "wayland" | "unknown" = "unknown";
  let xdotoolAvailable = false;

  try {
    const sessionType = process.env.XDG_SESSION_TYPE?.toLowerCase();
    if (sessionType === "x11") {
      displayServer = "x11";
    } else if (sessionType === "wayland") {
      displayServer = "wayland";
    }
  } catch {
    // ignore
  }

  try {
    execSync("which xdotool", { stdio: "pipe" });
    xdotoolAvailable = true;
  } catch {
    // xdotool not found
  }

  const screenCapture: GuiPermissionState =
    displayServer === "x11"
      ? "granted"
      : displayServer === "wayland"
        ? "denied"
        : "unknown";

  const accessibility: GuiPermissionState = xdotoolAvailable
    ? "granted"
    : "denied";

  return {
    screenCapture,
    accessibility,
    platform: "linux",
    displayServer,
    xdotoolAvailable,
  };
}

/**
 * macOS: 请求屏幕录制权限 (触发系统弹窗)
 *
 * 调用 desktopCapturer.getSources() 触发 macOS 的屏幕录制授权弹窗。
 * 如果用户已经授权或拒绝过，不会再弹窗。
 */
export async function requestScreenCapturePermission(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    log.info(`${TAG} Requesting screen capture permission via desktopCapturer`);
    // Calling getSources triggers the macOS screen recording permission prompt
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
    });
    const granted = sources.length > 0 && !sources[0].thumbnail.isEmpty();
    log.info(
      `${TAG} Screen capture permission: ${granted ? "granted" : "not granted"}`,
    );
    return granted;
  } catch (e) {
    log.error(`${TAG} Failed to request screen capture permission:`, e);
    return false;
  }
}

/**
 * macOS: 请求辅助功能权限 (触发系统弹窗)
 */
export function requestAccessibilityPermission(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    // isTrustedAccessibilityClient(true) = prompt user if not granted
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    log.info(`${TAG} Accessibility permission requested, trusted=${trusted}`);
    return trusted;
  } catch (e) {
    log.error(`${TAG} Failed to request accessibility permission:`, e);
    return false;
  }
}

/**
 * 打开系统权限设置页面
 */
export async function openPermissionSettings(
  type: "screenCapture" | "accessibility",
): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      if (type === "screenCapture") {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
      } else {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        );
      }
      return true;
    }
    if (process.platform === "win32") {
      return false;
    }
    if (process.platform === "linux") {
      log.info(`${TAG} Linux: no standard permission settings to open`);
      return false;
    }
    return false;
  } catch (e) {
    log.error(`${TAG} Failed to open permission settings:`, e);
    return false;
  }
}
