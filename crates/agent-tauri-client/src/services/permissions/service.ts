// ============================================
// 权限服务模块
// 提供权限检测、监控、状态管理等核心功能
// ============================================

import { message } from "antd";
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
} from "../permissionsRust";

// 从 config 导入类型和函数
import type {
  PermissionStatus,
  PermissionCategory,
  PermissionItem,
  PermissionsSummary,
  PermissionsState,
  Platform,
} from "./config";
import {
  getCurrentPlatform,
  getPlatformPermissionConfigs,
  getSettingsUrl,
} from "./config";

// ============================================
// 状态转换工具函数
// ============================================

/**
 * 将 Rust 权限状态转换为前端状态
 *
 * Rust 后端返回的权限状态字符串与前端定义的枚举可能不同，
 * 此函数负责两者之间的映射转换。
 *
 * @param {string} status - Rust 端返回的状态字符串
 * @returns {PermissionStatus} 前端使用的权限状态枚举
 *
 * @example
 * rustStatusToFrontend('Authorized'); // 'granted'
 * rustStatusToFrontend('Denied'); // 'denied'
 * rustStatusToFrontend('NotDetermined'); // 'pending'
 */
export function rustStatusToFrontend(status: string): PermissionStatus {
  switch (status) {
    case "Authorized":
      return "granted";
    case "Denied":
      return "denied";
    case "Restricted":
      return "denied";
    case "Unavailable":
      return "unknown";
    case "NotDetermined":
    default:
      return "pending";
  }
}

// ============================================
// 权限服务实现
// ============================================

/**
 * 权限服务核心类
 *
 * 职责：
 * - 权限状态检测（单权限/批量）
 * - 权限状态缓存管理
 * - 权限监控与事件通知
 * - 系统设置页面打开
 *
 * 设计要点：
 * - 单例模式，确保全局状态一致
 * - 5秒缓存机制，减少重复检测
 * - Rust 后端优先，fallback 到本地模拟
 *
 * @example
 * const service = new PermissionsService();
 * const status = await service.checkPermission('accessibility');
 */
class PermissionsService {
  /** 当前运行平台 */
  private platform: Platform;

  /** 权限状态缓存 */
  private permissionCache: Map<PermissionCategory, PermissionStatus> =
    new Map();

  /** 缓存时间戳，用于判断缓存是否过期 */
  private cacheTimestamp: number = 0;

  /** 缓存有效期（毫秒），避免频繁检测 */
  private readonly cacheDuration = 5000;

  /** 是否使用 Rust 后端 */
  private useRustBackend: boolean = true;

  /** 权限监控取消函数 */
  private monitorUnlisten: UnlistenFn | null = null;

  /** 权限变化回调函数集合 */
  private changeCallbacks: Set<
    (category: PermissionCategory, status: PermissionStatus) => void
  > = new Set();

  /**
   * 构造函数
   *
   * 初始化平台检测和 Rust 后端可用性检查。
   */
  constructor() {
    this.platform = getCurrentPlatform();
    this.checkRustBackend();
  }

  /**
   * 检查 Rust 后端是否可用
   *
   * 通过尝试调用 Rust 函数检测后端连接是否正常。
   * 如果调用失败，回退到本地检测模式。
   */
  private async checkRustBackend(): Promise<void> {
    try {
      await rustCheckAllPermissions();
      this.useRustBackend = true;
    } catch (error) {
      console.warn("Rust backend not available, using local detection");
      this.useRustBackend = false;
    }
  }

  // ============================================
  // 平台与缓存管理
  // ============================================

  /**
   * 获取当前平台
   *
   * @returns {Platform} 当前平台标识
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * 检查缓存是否有效
   *
   * @returns {boolean} 缓存是否有效
   */
  private isCacheValid(): boolean {
    return Date.now() - this.cacheTimestamp < this.cacheDuration;
  }

  /**
   * 清除所有缓存
   *
   * 通常在需要强制刷新权限状态时调用。
   */
  clearCache(): void {
    this.permissionCache.clear();
    this.cacheTimestamp = 0;
  }

  // ============================================
  // 权限状态检测
  // ============================================

  /**
   * 检测单个权限状态
   *
   * 优先从缓存读取，如果缓存无效则调用后端检测。
   *
   * @param {PermissionCategory} category - 权限类别
   * @returns {Promise<PermissionStatus>} 权限状态
   *
   * @example
   * const status = await service.checkPermission('accessibility');
   * console.log(status); // 'granted' | 'denied' | 'pending' | 'unknown'
   */
  async checkPermission(
    category: PermissionCategory,
  ): Promise<PermissionStatus> {
    // 1. 检查缓存
    if (this.isCacheValid()) {
      const cached = this.permissionCache.get(category);
      if (cached) return cached;
    }

    // 2. 调用后端检测
    let status: PermissionStatus;

    if (this.useRustBackend) {
      try {
        const rustState = await rustCheckPermission(category);
        status = rustStatusToFrontend(rustState.status);
      } catch (error) {
        console.error(
          `Failed to check permission ${category} from Rust:`,
          error,
        );
        status = "pending";
      }
    } else {
      // Fallback 到本地检测（模拟实现）
      status = await this.localCheckPermission(category);
    }

    // 3. 更新缓存并返回
    this.permissionCache.set(category, status);
    this.cacheTimestamp = Date.now();

    return status;
  }

  /**
   * 本地权限检测（fallback）
   *
   * 当 Rust 后端不可用时使用本地模拟逻辑。
   * 注意：这是简化实现，实际项目中应该根据平台使用系统 API 检测。
   *
   * @param {PermissionCategory} category - 权限类别
   * @returns {Promise<PermissionStatus>} 权限状态
   */
  private async localCheckPermission(
    category: PermissionCategory,
  ): Promise<PermissionStatus> {
    // 模拟检测：实际项目中应该调用各平台的系统 API
    // 此处使用随机结果模拟，实际应替换为真实检测逻辑
    switch (category) {
      case "accessibility":
      case "screen_recording":
      case "microphone":
      case "camera":
      case "notifications":
      case "location":
      case "file_access":
      case "network":
      case "clipboard":
      case "speech":
      case "nuwaxcode":
      case "claude_code":
      case "keyboard_monitoring":
        // 模拟：50% 概率已授权
        return Math.random() > 0.5 ? "granted" : "pending";
      default:
        return "unknown";
    }
  }

  /**
   * 批量检测所有权限状态
   *
   * 检测当前平台支持的所有权限，并计算统计摘要。
   *
   * @returns {Promise<PermissionsState>} 完整权限状态数据
   *
   * @example
   * const state = await service.checkAllPermissions();
   * console.log(state.summary.granted, state.summary.requiredGranted);
   */
  async checkAllPermissions(): Promise<PermissionsState> {
    const configs = getPlatformPermissionConfigs();
    const items: PermissionItem[] = [];

    // 遍历所有配置的权限
    for (const [category, config] of Object.entries(configs)) {
      const status = await this.checkPermission(category as PermissionCategory);
      items.push({
        ...config,
        status,
      });
    }

    // 计算统计
    const granted = items.filter((p) => p.status === "granted").length;
    const requiredGranted = items.filter(
      (p) => p.required && p.status === "granted",
    ).length;
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

  /**
   * 刷新权限状态
   *
   * 清除缓存并重新检测所有权限。
   *
   * @returns {Promise<PermissionsState>} 更新后的权限状态
   */
  async refresh(): Promise<PermissionsState> {
    this.clearCache();
    return this.checkAllPermissions();
  }

  // ============================================
  // 系统设置
  // ============================================

  /**
   * 打开系统设置页面
   *
   * 尝试使用 Rust 后端打开设置，如果失败则使用本地 URL 方案。
   *
   * @param {PermissionCategory} category - 要打开的权限类别
   * @returns {Promise<boolean>} 是否成功打开
   *
   * @example
   * await service.openSystemSettings('microphone');
   * // 打开麦克风权限设置页面
   */
  async openSystemSettings(category: PermissionCategory): Promise<boolean> {
    // 1. 优先使用 Rust 后端
    if (this.useRustBackend) {
      try {
        await rustOpenSettings(category);
        return true;
      } catch (error) {
        console.error("Failed to open settings via Rust:", error);
        // Fallback 到本地打开
      }
    }

    // 2. 本地打开系统设置
    const url = getSettingsUrl(category);
    if (url) {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return true;
      } catch (error) {
        console.error("Failed to open system settings:", error);
      }
    }

    console.warn("无法打开系统设置，请手动前往系统偏好设置");
    return false;
  }

  // ============================================
  // 状态配置与 UI 辅助
  // ============================================

  /**
   * 获取权限状态显示配置
   *
   * 返回用于 UI 显示的颜色、文本和图标配置。
   *
   * @param {PermissionStatus} status - 权限状态
   * @param {boolean} required - 是否为必需权限
   * @returns {{ color: string; text: string; icon: string }} 显示配置对象
   *
   * @example
   * const config = service.getStatusConfig('granted', true);
   * // { color: 'success', text: '已授权', icon: 'check-circle' }
   */
  getStatusConfig(
    status: PermissionStatus,
    required: boolean,
  ): { color: string; text: string; icon: string } {
    // 优先使用 Rust 后端的配置（如果有）
    if (this.useRustBackend) {
      const rustStatus = status === "granted" ? "Authorized" : "Denied";
      const color = rustGetStatusColor(rustStatus) as
        | "success"
        | "error"
        | "warning"
        | "default";
      const text = rustGetStatusLabel(rustStatus);
      return {
        color,
        text,
        icon: status === "granted" ? "check-circle" : "close-circle",
      };
    }

    // 本地配置
    const config: Record<
      PermissionStatus,
      { color: string; text: string; icon: string }
    > = {
      granted: {
        color: "success",
        text: "已授权",
        icon: "check-circle",
      },
      denied: {
        color: "error",
        text: "已拒绝",
        icon: "close-circle",
      },
      pending: {
        color: "warning",
        text: required ? "待授权" : "未授权",
        icon: "clock-circle",
      },
      unknown: {
        color: "default",
        text: "未知",
        icon: "question-circle",
      },
    };

    return config[status];
  }

  // ============================================
  // 权限监控
  // ============================================

  /**
   * 启动权限状态监控
   *
   * 监控权限变化事件，当权限状态改变时自动更新缓存并通知回调函数。
   * 仅在 Rust 后端可用时生效。
   *
   * @example
   * await service.startMonitoring();
   * service.onPermissionChange((category, status) => {
   *   console.log(`${category} changed to ${status}`);
   * });
   */
  async startMonitoring(): Promise<void> {
    if (!this.useRustBackend) {
      console.warn("Permission monitoring requires Rust backend");
      return;
    }

    if (this.monitorUnlisten) {
      // 已经在监控中，跳过
      return;
    }

    try {
      // 启动 Rust 端监控
      await startPermissionMonitor();

      // 注册事件监听
      this.monitorUnlisten = await onPermissionChange(
        (event: PermissionChangeEvent) => {
          const category = event.permission as PermissionCategory;
          const status = rustStatusToFrontend(event.status);

          // 更新缓存
          this.permissionCache.set(category, status);
          this.cacheTimestamp = Date.now();

          // 通知所有回调
          this.changeCallbacks.forEach((cb) => cb(category, status));
        },
      );
    } catch (error) {
      console.error("Failed to start permission monitoring:", error);
    }
  }

  /**
   * 停止权限状态监控
   *
   * 取消所有监控监听，释放资源。
   */
  async stopMonitoring(): Promise<void> {
    if (this.monitorUnlisten) {
      this.monitorUnlisten();
      this.monitorUnlisten = null;
    }

    try {
      await stopPermissionMonitor();
    } catch (error) {
      console.error("Failed to stop permission monitoring:", error);
    }
  }

  /**
   * 订阅权限变化事件
   *
   * @param {Function} callback - 权限变化回调函数
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const unsubscribe = service.onPermissionChange((category, status) => {
   *   console.log(`权限 ${category} 变为 ${status}`);
   * });
   * // 稍后...
   * unsubscribe(); // 取消订阅
   */
  onPermissionChange(
    callback: (category: PermissionCategory, status: PermissionStatus) => void,
  ): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }
}

// ============================================
// 导出单例与便捷函数
// ============================================

/**
 * 权限服务单例
 *
 * 全局共享的权限服务实例，用于检测、监控和管理应用权限。
 *
 * @example
 * const status = await permissionsService.checkPermission('accessibility');
 * permissionsService.openSystemSettings('microphone');
 */
export const permissionsService = new PermissionsService();

/**
 * 获取当前运行平台
 *
 * @returns {Platform} 'macos' | 'windows' | 'linux' | 'unknown'
 */
export const getPlatform = () => permissionsService.getPlatform();

/**
 * 检测单个权限状态
 *
 * @param {PermissionCategory} category - 权限类别
 * @returns {Promise<PermissionStatus>} 权限状态
 */
export const checkPermission = (category: PermissionCategory) =>
  permissionsService.checkPermission(category);

/**
 * 批量检测所有权限状态
 *
 * @returns {Promise<PermissionsState>} 完整权限状态
 */
export const checkAllPermissions = () =>
  permissionsService.checkAllPermissions();

/**
 * 打开系统设置页面
 *
 * @param {PermissionCategory} category - 权限类别
 * @returns {Promise<boolean>} 是否成功打开
 */
export const openSystemSettings = (category: PermissionCategory) =>
  permissionsService.openSystemSettings(category);

/**
 * 刷新权限状态
 *
 * @returns {Promise<PermissionsState>} 更新后的权限状态
 */
export const refreshPermissions = () => permissionsService.refresh();

/**
 * 获取权限状态显示配置
 *
 * @param {PermissionStatus} status - 权限状态
 * @param {boolean} required - 是否必需
 * @returns {{ color: string; text: string; icon: string }} 显示配置
 */
export const getStatusConfig = (status: PermissionStatus, required: boolean) =>
  permissionsService.getStatusConfig(status, required);

/**
 * 启动权限监控
 */
export const startMonitoring = () => permissionsService.startMonitoring();

/**
 * 停止权限监控
 */
export const stopMonitoring = () => permissionsService.stopMonitoring();

/**
 * 订阅权限变化事件
 *
 * @param {Function} callback - 变化回调
 * @returns {Function} 取消订阅函数
 */
export const subscribePermissionChange = (
  callback: (category: PermissionCategory, status: PermissionStatus) => void,
) => permissionsService.onPermissionChange(callback);

// 导出类型，供外部使用
export type {
  PermissionStatus,
  PermissionCategory,
  PermissionItem,
  PermissionsSummary,
  PermissionsState,
};
