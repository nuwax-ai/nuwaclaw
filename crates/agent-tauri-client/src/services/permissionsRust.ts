// ============================================
// 权限服务 Rust 后端桥接
// 通过 Tauri invoke 调用 Rust system-permissions 库
// 遵循 Tauri 官方 API 模式：invoke + 类型定义
// ============================================

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ============================================
// Rust 命令名称常量
// 与 src-tauri/src/lib.rs 中的命令名保持一致
// ============================================

const COMMANDS = {
  CHECK: "permission_check",
  LIST: "permission_list",
  REQUEST: "permission_request",
  OPEN_SETTINGS: "permission_open_settings",
  MONITOR_START: "permission_monitor_start",
  MONITOR_STOP: "permission_monitor_stop",
} as const;

// ============================================
// 类型定义（与 Rust PermissionStatus 对齐）
// ============================================

/**
 * Rust 端定义的权限状态枚举
 */
export type RustPermissionStatus =
  | "NotDetermined" // 尚未请求
  | "Authorized" // 已授权
  | "Denied" // 已拒绝
  | "Restricted" // 受限制
  | "Unavailable"; // 不可用

/**
 * Rust 返回的权限状态信息
 */
export interface RustPermissionState {
  permission: string;
  status: RustPermissionStatus;
  can_request: boolean;
  granted_at: string | null;
}

/**
 * 权限请求结果
 */
export interface RustRequestResult {
  permission: string;
  granted: boolean;
  status: RustPermissionStatus;
  error_message: string | null;
  settings_guide: string | null;
}

/**
 * 权限变化事件负载（从 Rust 事件推送）
 */
export interface PermissionChangeEvent {
  permission: string;
  status: string;
  can_request: boolean;
}

// ============================================
// 权限名称映射（前端 ID -> Rust 枚举名）
// ============================================

const PERMISSION_MAPPING: Record<string, string> = {
  accessibility: "accessibility",
  screen_recording: "screen_recording",
  microphone: "microphone",
  camera: "camera",
  notifications: "notifications",
  speech: "speech",
  location: "location",
  nuwaxcode: "nuwaxcode",
  claude_code: "claude_code",
  file_access: "file_system_read",
  network: "network",
  clipboard: "clipboard",
  keyboard_monitoring: "keyboard_monitoring",
};

/**
 * 将前端权限 ID 转换为 Rust 枚举名
 */
function toRustPermission(permissionId: string): string {
  return PERMISSION_MAPPING[permissionId] || permissionId;
}

// ============================================
// Tauri 命令调用封装
// ============================================

/**
 * 检查单个权限状态
 *
 * @param permissionId - 前端权限 ID
 * @returns 权限状态信息
 *
 * @example
 * const state = await checkPermission('accessibility');
 * console.log(state.status); // 'Authorized' | 'Denied' | ...
 */
export async function checkPermission(
  permissionId: string,
): Promise<RustPermissionState> {
  const rustPerm = toRustPermission(permissionId);
  try {
    return await invoke<RustPermissionState>(COMMANDS.CHECK, {
      permission: rustPerm,
    });
  } catch (error) {
    console.error(`Failed to check permission ${permissionId}:`, error);
    // 返回默认值，避免上层处理错误
    return {
      permission: permissionId,
      status: "NotDetermined",
      can_request: true,
      granted_at: null,
    };
  }
}

/**
 * 批量检查所有权限状态
 *
 * @returns 权限状态数组
 *
 * @example
 * const states = await checkAllPermissions();
 * console.log(states.length);
 */
export async function checkAllPermissions(): Promise<RustPermissionState[]> {
  try {
    return await invoke<RustPermissionState[]>(COMMANDS.LIST);
  } catch (error) {
    console.error("Failed to get all permissions:", error);
    return [];
  }
}

/**
 * 请求权限（交互式）
 *
 * @param permissionId - 前端权限 ID
 * @param interactive - 是否交互式请求（弹出系统对话框）
 * @returns 请求结果
 *
 * @example
 * const result = await requestPermission('accessibility', true);
 * console.log(result.granted);
 */
export async function requestPermission(
  permissionId: string,
  interactive: boolean = true,
): Promise<RustRequestResult> {
  const rustPerm = toRustPermission(permissionId);
  try {
    return await invoke<RustRequestResult>(COMMANDS.REQUEST, {
      permission: rustPerm,
      interactive,
    });
  } catch (error) {
    console.error(`Failed to request permission ${permissionId}:`, error);
    return {
      permission: permissionId,
      granted: false,
      status: "Denied",
      error_message: String(error),
      settings_guide: null,
    };
  }
}

/**
 * 打开系统设置页面
 *
 * @param permissionId - 前端权限 ID
 * @returns 是否成功打开
 *
 * @example
 * await openSystemSettings('accessibility');
 */
export async function openSystemSettings(
  permissionId: string,
): Promise<boolean> {
  const rustPerm = toRustPermission(permissionId);
  try {
    await invoke(COMMANDS.OPEN_SETTINGS, { permission: rustPerm });
    return true;
  } catch (error) {
    console.error(`Failed to open system settings for ${permissionId}:`, error);
    return false;
  }
}

// ============================================
// UI 辅助函数（状态显示配置）
// ============================================

/**
 * 获取权限状态对应的显示标签
 *
 * @param status - Rust 权限状态
 * @returns 中文显示文本
 *
 * @example
 * getStatusLabel('Authorized'); // '已授权'
 */
export function getStatusLabel(status: RustPermissionStatus): string {
  switch (status) {
    case "Authorized":
      return "已授权";
    case "Denied":
      return "已拒绝";
    case "Restricted":
      return "受限制";
    case "Unavailable":
      return "不可用";
    case "NotDetermined":
    default:
      return "未授权";
  }
}

/**
 * 获取权限状态对应的 UI 颜色
 *
 * @param status - Rust 权限状态
 * @returns Ant Design 颜色标识
 *
 * @example
 * getStatusColor('Authorized'); // 'success'
 */
export function getStatusColor(status: RustPermissionStatus): string {
  switch (status) {
    case "Authorized":
      return "success";
    case "Denied":
    case "Unavailable":
      return "error";
    case "Restricted":
      return "warning";
    case "NotDetermined":
    default:
      return "default";
  }
}

// ============================================
// 权限监控 API
// ============================================

/**
 * 启动权限监控
 *
 * 开始监听权限变化事件。
 *
 * @throws {Error} 启动失败时抛出异常
 *
 * @example
 * await startPermissionMonitor();
 */
export async function startPermissionMonitor(): Promise<void> {
  try {
    await invoke(COMMANDS.MONITOR_START);
  } catch (error) {
    console.error("Failed to start permission monitor:", error);
    throw error;
  }
}

/**
 * 停止权限监控
 *
 * @example
 * await stopPermissionMonitor();
 */
export async function stopPermissionMonitor(): Promise<void> {
  try {
    await invoke(COMMANDS.MONITOR_STOP);
  } catch (error) {
    console.error("Failed to stop permission monitor:", error);
  }
}

/**
 * 监听权限变化事件
 *
 * @param callback - 权限变化时的回调函数
 * @returns 取消监听的函数
 *
 * @example
 * const unlisten = await onPermissionChange((event) => {
 *   console.log(`${event.permission} changed to ${event.status}`);
 * });
 * // 稍后...
 * unlisten();
 */
export async function onPermissionChange(
  callback: (event: PermissionChangeEvent) => void,
): Promise<UnlistenFn> {
  return listen<PermissionChangeEvent>("permission_change", (event) => {
    callback(event.payload);
  });
}

// Re-export UnlistenFn for convenience
export type { UnlistenFn } from "@tauri-apps/api/event";
