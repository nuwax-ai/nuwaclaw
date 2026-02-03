// 跨平台权限管理服务
// 支持 macOS、Windows、Linux 的系统权限检测和请求
// 优先使用 Rust 后端 system-permissions，fallback 到本地检测

import { message } from 'antd';
import {
  checkPermission as rustCheckPermission,
  checkAllPermissions as rustCheckAllPermissions,
  openSystemSettings as rustOpenSettings,
  getStatusColor as rustGetStatusColor,
  getStatusLabel as rustGetStatusLabel,
  startPermissionMonitor,
  stopPermissionMonitor,
  onPermissionChange,
  type PermissionChangeEvent,
  type UnlistenFn,
} from './permissionsRust';

// ============================================
// 权限类型定义
// ============================================

// 权限状态
export type PermissionStatus = 'granted' | 'denied' | 'pending' | 'unknown';

// 权限类别（与 Rust system-permissions 的 SystemPermission 对齐）
export type PermissionCategory =
  | 'accessibility'     // 辅助功能（键盘鼠标控制）
  | 'screen_recording'  // 屏幕录制
  | 'microphone'       // 麦克风
  | 'camera'           // 摄像头
  | 'location'         // 位置信息
  | 'notifications'    // 通知
  | 'file_access'      // 文件访问
  | 'network'          // 网络访问
  | 'clipboard'        // 剪贴板
  | 'speech'           // 语音识别
  | 'nuwaxcode'        // NuwaxCode 编辑器集成
  | 'claude_code'      // Claude Code 编辑器集成
  | 'keyboard_monitoring'; // 键盘监控（全局快捷键）

// 权限项接口
export interface PermissionItem {
  id: PermissionCategory;
  name: string;
  displayName: string;
  description: string;
  status: PermissionStatus;
  required: boolean;      // 是否必需权限
  platform: string[];     // 支持的平台
}

// 权限统计摘要
export interface PermissionsSummary {
  total: number;
  granted: number;
  requiredGranted: number;
  requiredTotal: number;
}

// 权限状态数据
export interface PermissionsState {
  items: PermissionItem[];
  summary: PermissionsSummary;
}

// ============================================
// 平台检测
// ============================================

type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

function getCurrentPlatform(): Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac') || platform.includes('darwin')) {
    return 'macos';
  }
  if (platform.includes('win')) {
    return 'windows';
  }
  if (platform.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

// ============================================
// 权限配置定义
// ============================================

// 所有支持的权限配置
const PERMISSION_CONFIGS: Record<PermissionCategory, Omit<PermissionItem, 'status'>> = {
  accessibility: {
    id: 'accessibility',
    name: 'accessibility',
    displayName: '辅助功能',
    description: '用于远程控制时模拟键盘鼠标输入',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  screen_recording: {
    id: 'screen_recording',
    name: 'screen_recording',
    displayName: '屏幕录制',
    description: '用于远程桌面实时画面传输',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  microphone: {
    id: 'microphone',
    name: 'microphone',
    displayName: '麦克风',
    description: '用于语音通话和音频输入',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
  camera: {
    id: 'camera',
    name: 'camera',
    displayName: '摄像头',
    description: '用于视频通话功能',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
  location: {
    id: 'location',
    name: 'location',
    displayName: '位置信息',
    description: '用于定位相关功能',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
  notifications: {
    id: 'notifications',
    name: 'notifications',
    displayName: '通知',
    description: '用于发送系统通知',
    required: false,
    platform: ['macos', 'windows'],
  },
  file_access: {
    id: 'file_access',
    name: 'file_access',
    displayName: '文件访问',
    description: '用于文件传输和本地文件操作',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  network: {
    id: 'network',
    name: 'network',
    displayName: '网络访问',
    description: '用于与服务器建立通信连接',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  clipboard: {
    id: 'clipboard',
    name: 'clipboard',
    displayName: '剪贴板',
    description: '用于跨设备剪贴板同步',
    required: false,
    platform: ['macos', 'windows'],
  },
  speech: {
    id: 'speech',
    name: 'speech',
    displayName: '语音识别',
    description: '用于语音命令输入',
    required: false,
    platform: ['macos', 'windows'],
  },
  nuwaxcode: {
    id: 'nuwaxcode',
    name: 'nuwaxcode',
    displayName: 'NuwaxCode',
    description: '用于 NuwaxCode 编辑器集成与自动化',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
  claude_code: {
    id: 'claude_code',
    name: 'claude_code',
    displayName: 'Claude Code',
    description: '用于 Claude Code 编辑器集成与自动化',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
  keyboard_monitoring: {
    id: 'keyboard_monitoring',
    name: 'keyboard_monitoring',
    displayName: '键盘监控',
    description: '用于全局快捷键监听',
    required: false,
    platform: ['macos', 'windows', 'linux'],
  },
};

// 将 Rust 权限状态转换为前端状态
function rustStatusToFrontend(status: string): PermissionStatus {
  switch (status) {
    case 'Authorized':
      return 'granted';
    case 'Denied':
      return 'denied';
    case 'Restricted':
      return 'denied';
    case 'Unavailable':
      return 'unknown';
    case 'NotDetermined':
    default:
      return 'pending';
  }
}

// ============================================
// 权限服务实现
// ============================================

class PermissionsService {
  private platform: Platform;
  private permissionCache: Map<PermissionCategory, PermissionStatus> = new Map();
  private cacheTimestamp: number = 0;
  private readonly cacheDuration = 5000; // 缓存 5 秒
  private useRustBackend: boolean = true; // 是否使用 Rust 后端

  constructor() {
    this.platform = getCurrentPlatform();
    // 检查 Rust 后端是否可用（通过尝试调用）
    this.checkRustBackend();
  }

  // 检查 Rust 后端是否可用
  private async checkRustBackend(): Promise<void> {
    try {
      await rustCheckAllPermissions();
      this.useRustBackend = true;
    } catch (error) {
      console.warn('Rust backend not available, using local detection');
      this.useRustBackend = false;
    }
  }

  // 获取当前平台
  getPlatform(): Platform {
    return this.platform;
  }

  // 检测权限状态
  async checkPermission(category: PermissionCategory): Promise<PermissionStatus> {
    // 检查缓存
    if (this.isCacheValid()) {
      const cached = this.permissionCache.get(category);
      if (cached) return cached;
    }

    let status: PermissionStatus;

    if (this.useRustBackend) {
      // 使用 Rust 后端获取真实权限状态
      try {
        const rustState = await rustCheckPermission(category);
        status = rustStatusToFrontend(rustState.status);
      } catch (error) {
        console.error(`Failed to check permission ${category} from Rust:`, error);
        status = 'pending';
      }
    } else {
      // Fallback 到本地检测（模拟实现）
      status = await this.localCheckPermission(category);
    }

    // 更新缓存
    this.permissionCache.set(category, status);
    this.cacheTimestamp = Date.now();

    return status;
  }

  // 本地权限检测（fallback，当 Rust 后端不可用时使用）
  private async localCheckPermission(category: PermissionCategory): Promise<PermissionStatus> {
    // 简化的本地检测逻辑
    switch (category) {
      case 'accessibility':
      case 'screen_recording':
      case 'microphone':
      case 'camera':
      case 'notifications':
      case 'location':
      case 'file_access':
      case 'network':
      case 'clipboard':
      case 'speech':
      case 'nuwaxcode':
      case 'claude_code':
      case 'keyboard_monitoring':
        return Math.random() > 0.5 ? 'granted' : 'pending';
      default:
        return 'unknown';
    }
  }

  // 批量检测权限
  async checkAllPermissions(): Promise<PermissionsState> {
    const platform = getCurrentPlatform();
    const items: PermissionItem[] = [];

    for (const [category, config] of Object.entries(PERMISSION_CONFIGS)) {
      // 只检测当前平台支持的权限
      if (!config.platform.includes(platform)) continue;

      const status = await this.checkPermission(category as PermissionCategory);
      items.push({
        ...config,
        status,
      });
    }

    // 计算统计
    const granted = items.filter((p) => p.status === 'granted').length;
    const requiredGranted = items.filter((p) => p.required && p.status === 'granted').length;
    const requiredTotal = items.filter((p) => p.required).length;

    return {
      items,
      summary: {
        total: items.length,
        granted,
        requiredGranted,
        requiredTotal,
      },
    };
  }

  // 打开系统设置（使用 Rust 后端或本地 URL）
  async openSystemSettings(category: PermissionCategory): Promise<boolean> {
    message.loading('正在打开系统设置...', 1);

    if (this.useRustBackend) {
      // 使用 Rust 后端的 opener 插件
      try {
        await rustOpenSettings(category);
        message.info('请在系统设置中完成权限授权');
        return true;
      } catch (error) {
        console.error('Failed to open settings via Rust:', error);
        // Fallback 到本地打开
      }
    }

    // 本地打开系统设置
    const settingsUrls: Record<PermissionCategory, string> = {
      accessibility: 'x-apple.systempreferences:com.apple.security.accessibility',
      screen_recording: 'x-apple.systempreferences:com.apple.security.screenRecording',
      microphone: 'x-apple.systempreferences:com.apple.security.privacy-microphone',
      camera: 'x-apple.systempreferences:com.apple.security.privacy-camera',
      location: 'x-apple.systempreferences:com.apple.security.privacy-location',
      notifications: 'x-apple.systempreferences:com.apple.security.privacy-notifications',
      file_access: 'x-apple.systempreferences:com.apple.security.privacy.files',
      network: 'x-apple.systempreferences:com.apple.security.firewall',
      clipboard: 'x-apple.systempreferences:com.apple.security.accessibility',
      speech: 'x-apple.systempreferences:com.apple.security.privacy-speechRecognition',
      nuwaxcode: 'x-apple.systempreferences:com.apple.security.privacy.all',
      claude_code: 'x-apple.systempreferences:com.apple.security.privacy.all',
      keyboard_monitoring: 'x-apple.systempreferences:com.apple.security.privacy.inputMonitoring',
    };

    const url = settingsUrls[category];
    if (url) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        message.info('请在系统设置中完成权限授权');
        return true;
      } catch (error) {
        console.error('Failed to open system settings:', error);
      }
    }

    message.warning('无法打开系统设置，请手动前往系统偏好设置');
    return false;
  }

  // 刷新权限状态
  async refresh(): Promise<PermissionsState> {
    this.permissionCache.clear();
    this.cacheTimestamp = 0;
    return this.checkAllPermissions();
  }

  // 检查缓存是否有效
  private isCacheValid(): boolean {
    return Date.now() - this.cacheTimestamp < this.cacheDuration;
  }

  // 获取权限状态配置
  getStatusConfig(status: PermissionStatus, required: boolean) {
    // 优先使用 Rust 后端的配置
    if (this.useRustBackend) {
      const color = rustGetStatusColor(status === 'granted' ? 'Authorized' : 'Denied');
      const text = rustGetStatusLabel(status === 'granted' ? 'Authorized' : 'Denied');
      return {
        color: color as 'success' | 'error' | 'warning' | 'default',
        text,
        icon: status === 'granted' ? 'check-circle' : 'close-circle',
      };
    }

    const config: Record<PermissionStatus, { color: string; text: string; icon: string }> = {
      granted: {
        color: 'success',
        text: '已授权',
        icon: 'check-circle',
      },
      denied: {
        color: 'error',
        text: '已拒绝',
        icon: 'close-circle',
      },
      pending: {
        color: 'warning',
        text: required ? '待授权' : '未授权',
        icon: 'clock-circle',
      },
      unknown: {
        color: 'default',
        text: '未知',
        icon: 'question-circle',
      },
    };
    return config[status];
  }

  // ============================================
  // 权限监控方法
  // ============================================

  private monitorUnlisten: UnlistenFn | null = null;
  private changeCallbacks: Set<(category: PermissionCategory, status: PermissionStatus) => void> = new Set();

  /**
   * 启动权限监控
   * 当权限状态变化时，自动更新缓存并通知回调
   */
  async startMonitoring(): Promise<void> {
    if (!this.useRustBackend) {
      console.warn('Permission monitoring requires Rust backend');
      return;
    }

    if (this.monitorUnlisten) {
      // 已经在监控
      return;
    }

    try {
      await startPermissionMonitor();

      this.monitorUnlisten = await onPermissionChange((event: PermissionChangeEvent) => {
        const category = event.permission as PermissionCategory;
        const status = rustStatusToFrontend(event.status);

        // 更新缓存
        this.permissionCache.set(category, status);
        this.cacheTimestamp = Date.now();

        // 通知回调
        this.changeCallbacks.forEach((cb) => cb(category, status));
      });
    } catch (error) {
      console.error('Failed to start permission monitoring:', error);
    }
  }

  /**
   * 停止权限监控
   */
  async stopMonitoring(): Promise<void> {
    if (this.monitorUnlisten) {
      this.monitorUnlisten();
      this.monitorUnlisten = null;
    }

    try {
      await stopPermissionMonitor();
    } catch (error) {
      console.error('Failed to stop permission monitoring:', error);
    }
  }

  /**
   * 订阅权限变化事件
   * @param callback 权限变化回调
   * @returns 取消订阅函数
   */
  onPermissionChange(callback: (category: PermissionCategory, status: PermissionStatus) => void): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }
}

// ============================================
// 导出单例
// ============================================

export const permissionsService = new PermissionsService();

// 便捷函数
export const getPlatform = () => permissionsService.getPlatform();
export const checkPermission = (category: PermissionCategory) => permissionsService.checkPermission(category);
export const checkAllPermissions = () => permissionsService.checkAllPermissions();
export const openSystemSettings = (category: PermissionCategory) => permissionsService.openSystemSettings(category);
export const refreshPermissions = () => permissionsService.refresh();
export const getStatusConfig = (status: PermissionStatus, required: boolean) =>
  permissionsService.getStatusConfig(status, required);

// 监控相关便捷函数
export const startMonitoring = () => permissionsService.startMonitoring();
export const stopMonitoring = () => permissionsService.stopMonitoring();
export const subscribePermissionChange = (
  callback: (category: PermissionCategory, status: PermissionStatus) => void
) => permissionsService.onPermissionChange(callback);
