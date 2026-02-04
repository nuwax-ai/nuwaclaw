// 权限服务 Rust 后端桥接
// 通过 Tauri invoke 调用 Rust system-permissions 库
// 注意：SETTINGS_URLS 用于系统设置 URL 映射，虽然当前未直接使用，但保留以备将来需要

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// 为了避免未使用变量警告，在开发时可以使用以下方式引用
// 如果需要使用，直接取消下面的注释即可
// console.log('Settings URLs:', SETTINGS_URLS);

// 权限状态类型（与 Rust PermissionStatus 对齐）
export type PermissionStatus =
  | 'NotDetermined'
  | 'Authorized'
  | 'Denied'
  | 'Restricted'
  | 'Unavailable';

// 权限状态信息
export interface PermissionState {
  permission: string;
  status: PermissionStatus;
  can_request: boolean;
  granted_at: string | null;
}

// 权限请求结果
export interface RequestResult {
  permission: string;
  granted: boolean;
  status: PermissionStatus;
  error_message: string | null;
  settings_guide: string | null;
}

// 系统设置 URL 映射
const SETTINGS_URLS: Record<string, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.security.accessibility',
  screen_recording: 'x-apple.systempreferences:com.apple.security.screenRecording',
  microphone: 'x-apple.systempreferences:com.apple.security.privacy-microphone',
  camera: 'x-apple.systempreferences:com.apple.security.privacy-camera',
  notifications: 'x-apple.systempreferences:com.apple.security.privacy-notifications',
  speech_recognition: 'x-apple.systempreferences:com.apple.security.privacy-speechRecognition',
  location: 'x-apple.systempreferences:com.apple.security.privacy-location',
  nuwaxcode: 'x-apple.systempreferences:com.apple.security.privacy.all',
  claude_code: 'x-apple.systempreferences:com.apple.security.privacy.all',
  file_system_read: 'x-apple.systempreferences:com.apple.security.privacy.files',
  file_system_write: 'x-apple.systempreferences:com.apple.security.privacy.files',
  clipboard: 'x-apple.systempreferences:com.apple.security.accessibility',
  keyboard_monitoring: 'x-apple.systempreferences:com.apple.security.privacy.inputMonitoring',
  network: 'x-apple.systempreferences:com.apple.security.firewall',
};

// 权限名称映射（前端 ID -> Rust 枚举名）
const PERMISSION_MAPPING: Record<string, string> = {
  accessibility: 'accessibility',
  screen_recording: 'screen_recording',
  microphone: 'microphone',
  camera: 'camera',
  notifications: 'notifications',
  speech: 'speech',
  location: 'location',
  nuwaxcode: 'nuwaxcode',
  claude_code: 'claude_code',
  file_access: 'file_system_read',
  network: 'network',
  clipboard: 'clipboard',
  keyboard_monitoring: 'keyboard_monitoring',
};

/**
 * 检查单个权限状态（调用 Rust 后端）
 */
export async function checkPermission(permissionId: string): Promise<PermissionState> {
  const rustPerm = PERMISSION_MAPPING[permissionId] || permissionId;
  try {
    const result = await invoke<PermissionState>('check_permission', {
      permission: rustPerm,
    });
    return result;
  } catch (error) {
    console.error(`Failed to check permission ${permissionId}:`, error);
    return {
      permission: permissionId,
      status: 'NotDetermined',
      can_request: true,
      granted_at: null,
    };
  }
}

/**
 * 批量检查所有权限状态
 */
export async function checkAllPermissions(): Promise<PermissionState[]> {
  try {
    const results = await invoke<PermissionState[]>('get_all_permissions');
    return results;
  } catch (error) {
    console.error('Failed to get all permissions:', error);
    return [];
  }
}

/**
 * 请求权限（交互式）
 */
export async function requestPermission(
  permissionId: string,
  interactive: boolean = true
): Promise<RequestResult> {
  const rustPerm = PERMISSION_MAPPING[permissionId] || permissionId;
  try {
    const result = await invoke<RequestResult>('request_permission', {
      permission: rustPerm,
      interactive,
    });
    return result;
  } catch (error) {
    console.error(`Failed to request permission ${permissionId}:`, error);
    return {
      permission: permissionId,
      granted: false,
      status: 'Denied',
      error_message: String(error),
      settings_guide: null,
    };
  }
}

/**
 * 打开系统设置页面
 */
export async function openSystemSettings(permissionId: string): Promise<boolean> {
  const rustPerm = PERMISSION_MAPPING[permissionId] || permissionId;
  try {
    await invoke('open_settings', { permission: rustPerm });
    return true;
  } catch (error) {
    console.error(`Failed to open system settings for ${permissionId}:`, error);
    return false;
  }
}

/**
 * 获取权限状态对应的显示标签
 */
export function getStatusLabel(status: PermissionStatus): string {
  switch (status) {
    case 'Authorized':
      return '已授权';
    case 'Denied':
      return '已拒绝';
    case 'Restricted':
      return '受限制';
    case 'Unavailable':
      return '不可用';
    case 'NotDetermined':
    default:
      return '未授权';
  }
}

/**
 * 获取权限状态对应的颜色
 */
export function getStatusColor(status: PermissionStatus): string {
  switch (status) {
    case 'Authorized':
      return 'success';
    case 'Denied':
    case 'Unavailable':
      return 'error';
    case 'Restricted':
      return 'warning';
    case 'NotDetermined':
    default:
      return 'default';
  }
}

// ============================================
// 权限监控 API
// ============================================

/**
 * 权限变化事件（从 Rust 后端推送）
 */
export interface PermissionChangeEvent {
  permission: string;
  status: string;
  can_request: boolean;
}

/**
 * 启动权限监控
 * 开始后会通过 Tauri 事件推送权限变化
 */
export async function startPermissionMonitor(): Promise<void> {
  try {
    await invoke('start_permission_monitor');
  } catch (error) {
    console.error('Failed to start permission monitor:', error);
    throw error;
  }
}

/**
 * 停止权限监控
 */
export async function stopPermissionMonitor(): Promise<void> {
  try {
    await invoke('stop_permission_monitor');
  } catch (error) {
    console.error('Failed to stop permission monitor:', error);
  }
}

/**
 * 监听权限变化事件
 * @param callback 权限变化时的回调函数
 * @returns 取消监听的函数
 */
export async function onPermissionChange(
  callback: (event: PermissionChangeEvent) => void
): Promise<UnlistenFn> {
  return listen<PermissionChangeEvent>('permission_change', (event) => {
    callback(event.payload);
  });
}

// Re-export UnlistenFn for convenience
export type { UnlistenFn } from '@tauri-apps/api/event';
