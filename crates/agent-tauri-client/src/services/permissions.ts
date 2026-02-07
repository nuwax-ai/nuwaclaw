// ============================================
// 完全磁盘访问权限专用函数
// 提供 macOS/Windows/Linux 平台的完全磁盘访问权限管理
// ============================================

// 导入类型和配置函数
import type {
  PermissionStatus,
  PermissionCategory,
  PermissionItem,
  PermissionsSummary,
  PermissionsState,
} from "./permissions/config";
import { getFullDiskAccessUrl, getCurrentPlatform } from "./permissions/config";

// 导入核心服务（用于便捷函数）
import { permissionsService } from "./permissions/service";

// ============================================
// 跨平台完全磁盘访问检测
// ============================================

/**
 * 检测应用是否已获得完全磁盘访问权限
 *
 * 通过尝试访问受保护目录来判断。
 * macOS: ~/Library/Application Support
 * Windows: AppData 目录
 * Linux: ~/.config
 *
 * @returns {Promise<boolean>} 返回 true 表示已获得权限，false 表示未获得
 *
 * @example
 * const hasAccess = await checkFullDiskAccessPermission();
 * if (!hasAccess) {
 *   await openFullDiskAccessPanel();
 * }
 */
export async function checkFullDiskAccessPermission(): Promise<boolean> {
  try {
    // 使用 Tauri 的 invoke 直接调用 Rust 后端进行检测
    const { invoke } = await import("@tauri-apps/api/core");

    // 调用 Rust 后端的检测命令
    const hasPermission = (await invoke("check_disk_access")) as boolean;
    return hasPermission;
  } catch (error) {
    console.warn(
      "[Permissions] 完全磁盘访问权限检查失败（可能是权限不足）:",
      error,
    );
    return false;
  }
}

// ============================================
// 平台专用函数
// ============================================

/**
 * 打开 macOS 完全磁盘访问权限面板
 *
 * 使用系统偏好设置 URL Scheme 直接打开对应面板。
 * 优先使用 Rust 端实现，fallback 到 URL Scheme。
 *
 * @throws {Error} 当无法打开面板时抛出异常
 *
 * @example
 * await openMacOSFullDiskAccessPanel();
 */
async function openMacOSFullDiskAccessPanel(): Promise<void> {
  // 方案1：使用 Rust 端的 permission_open_settings
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("permission_open_settings", {
      permission: "file_system_read",
    });
    console.log("[Permissions] 已通过 Rust 打开完全磁盘访问面板");
    return;
  } catch (error) {
    console.warn("[Permissions] Rust 打开失败，尝试 URL Scheme:", error);
  }

  // 方案2：使用 URL Scheme 直接打开
  const url = getFullDiskAccessUrl();
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    console.log("[Permissions] 已通过 URL Scheme 打开完全磁盘访问面板");
  } catch (error) {
    console.error("[Permissions] 无法自动打开完全磁盘访问面板:", error);
    throw error;
  }
}

/**
 * 打开 Windows 完全磁盘访问权限面板
 *
 * Windows 使用文件选择器访问模式，逻辑与 macOS 不同。
 *
 * @example
 * await openWindowsFullDiskAccessPanel();
 */
async function openWindowsFullDiskAccessPanel(): Promise<void> {
  // Windows 没有 macOS 那样的"完全磁盘访问"概念
  // 通常通过 UAC 和应用清单来处理
}

/**
 * 打开 Linux 完全磁盘访问权限面板
 *
 * Linux 桌面环境通常使用 Polkit 管理权限。
 *
 * @example
 * await openLinuxFullDiskAccessPanel();
 */
async function openLinuxFullDiskAccessPanel(): Promise<void> {
  // Linux 权限通常通过 Polkit 或 AppArmor 管理
}

// ============================================
// 通用入口函数
// ============================================

/**
 * 打开完全磁盘访问权限面板
 *
 * 根据当前平台调用对应的面板打开函数。
 * 这是跨平台统一的入口点。
 *
 * @returns {Promise<void>}
 *
 * @example
 * await openFullDiskAccessPanel();
 * console.log('面板已打开');
 */
export async function openFullDiskAccessPanel(): Promise<void> {
  const platform = getCurrentPlatform();

  switch (platform) {
    case "macos":
      await openMacOSFullDiskAccessPanel();
      break;
    case "windows":
      await openWindowsFullDiskAccessPanel();
      break;
    case "linux":
      await openLinuxFullDiskAccessPanel();
      break;
    default:
      // 未知平台，静默处理
      break;
  }
}

/**
 * 打开完全磁盘访问权限面板，并在打开后执行回调
 *
 * 该函数封装了打开面板的操作，并支持在用户完成授权后执行自定义逻辑。
 *
 * @param {Function} onPanelOpened - 面板打开后的回调函数
 * @returns {Promise<void>}
 *
 * @example
 * await openFullDiskAccessPanelWithCallback(() => {
 *   console.log('用户已完成授权设置');
 *   refreshPermissions();
 * });
 */
export async function openFullDiskAccessPanelWithCallback(
  onPanelOpened?: () => void,
): Promise<void> {
  await openFullDiskAccessPanel();
  onPanelOpened?.();
}

// ============================================
// 辅助函数
// ============================================

/**
 * 检查当前平台是否需要完全磁盘访问权限
 *
 * @returns {boolean} 是否需要
 */
export function isFullDiskAccessNeeded(): boolean {
  const platform = getCurrentPlatform();
  // macOS 最需要完全磁盘访问
  return platform === "macos";
}

/**
 * 获取完全磁盘访问权限的说明文本
 *
 * 根据平台返回不同的说明信息。
 *
 * @returns {string} 说明文本
 */
export function getFullDiskAccessHelpText(): string {
  const platform = getCurrentPlatform();

  switch (platform) {
    case "macos":
      return "打开「系统设置」→「隐私与安全性」→「完全磁盘访问权限」，勾选本应用";
    case "windows":
      return "请确保应用已通过 Windows 权限检查";
    case "linux":
      return "请确保应用已获得必要的文件系统访问权限";
    default:
      return "请在系统设置中授予文件访问权限";
  }
}

// ============================================
// 从子模块 re-export
// ============================================

// 类型 re-export
export type {
  PermissionStatus,
  PermissionCategory,
  PermissionItem,
  PermissionsSummary,
  PermissionsState,
} from "./permissions/config";

// 配置函数
export {
  getCurrentPlatform,
  getPlatformPermissionConfigs,
  getAllPermissionConfigs,
  getSettingsUrl,
  getFullDiskAccessUrl,
} from "./permissions/config";

// 状态转换工具
export { rustStatusToFrontend } from "./permissions/service";

// 核心服务（已在顶部导入）
// 重新导出以保持 API 兼容性
export { permissionsService } from "./permissions/service";

// 便捷函数
export const getPlatform = () => permissionsService.getPlatform();
export const checkPermission = (category: PermissionCategory) =>
  permissionsService.checkPermission(category);
export const checkAllPermissions = () =>
  permissionsService.checkAllPermissions();
export const openSystemSettings = (category: PermissionCategory) =>
  permissionsService.openSystemSettings(category);
export const refreshPermissions = () => permissionsService.refresh();
export const getStatusConfig = (status: PermissionStatus, required: boolean) =>
  permissionsService.getStatusConfig(status, required);

// 监控相关
export const startMonitoring = () => permissionsService.startMonitoring();
export const stopMonitoring = () => permissionsService.stopMonitoring();
export const subscribePermissionChange = (
  callback: (category: PermissionCategory, status: PermissionStatus) => void,
) => permissionsService.onPermissionChange(callback);
