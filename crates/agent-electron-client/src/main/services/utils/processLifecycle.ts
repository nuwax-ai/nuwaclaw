/**
 * ProcessLifecycleManager — 服务进程生命周期守护层
 *
 * 职责：
 * 1. 监听 ManagedProcess 的 crash / restart 事件 → 推送 service:lifecycle 到渲染进程
 * 2. 跟踪每个服务的重启次数与最近崩溃时间（供诊断使用）
 * 3. 提供 getStats() 汇总所有托管服务的运行状态（IPC diagnostics 查询入口）
 * 4. 退出时统一清理事件监听器（防内存泄漏）
 *
 * 与 ManagedProcess 的关系：
 * - ManagedProcess 管理单个进程的启停与内置重启策略
 * - ProcessLifecycleManager 作为外层协调器，聚合多个 ManagedProcess 的状态
 *   并将重启/崩溃事件广播到渲染进程
 */

import { EventEmitter } from "events";
import { BrowserWindow } from "electron";
import log from "electron-log";
import type { ManagedProcess } from "../../processManager";
import { structuredLog } from "../../bootstrap/logConfig";

// ==================== 类型定义 ====================

export interface ServiceLifecycleEntry {
  /** 唯一标识符，对应 IPC 服务 key（如 "lanproxy"、"fileServer"、"mcpProxy"） */
  key: string;
  /** 人可读名称（用于日志与诊断） */
  label: string;
  /** 对应的 ManagedProcess 实例 */
  process: ManagedProcess;
}

export interface ServiceLifecycleStats {
  key: string;
  label: string;
  /** 进程当前是否运行中 */
  running: boolean;
  /** 进程 PID（仅 running=true 时有效） */
  pid?: number;
  /** 本次启动以来的重启次数 */
  restartCount: number;
  /** 最近崩溃的 Unix 毫秒时间戳 */
  lastCrashAt?: number;
  /** 运行时长（ms），仅在 running=true 且曾记录启动时间时有效 */
  uptimeMs?: number;
}

// ==================== 守护器实现 ====================

class ProcessLifecycleManager extends EventEmitter {
  private services = new Map<string, ServiceLifecycleEntry>();
  private restartCounts = new Map<string, number>();
  private lastCrashAt = new Map<string, number>();
  private startedAt = new Map<string, number>();
  /** 每个服务注册的事件清理函数 */
  private cleanupFns = new Map<string, () => void>();

  // ==================== 注册 / 注销 ====================

  /**
   * 将一个 ManagedProcess 注册到守护层。
   * 应在进程首次创建（new ManagedProcess(...)）之后调用。
   */
  register(entry: ServiceLifecycleEntry): void {
    const { key, process: proc } = entry;

    if (this.services.has(key)) {
      log.warn(`[ProcessLifecycle] Service already registered: ${key}`);
      return;
    }

    this.services.set(key, entry);
    this.restartCounts.set(key, 0);

    // 监听 ManagedProcess 内置的 restart 事件（启动了 restartPolicy.enabled=true 时触发）
    const onRestart = (data: { attempt: number; delayMs: number }) => {
      const count = data.attempt;
      this.restartCounts.set(key, count);
      this.lastCrashAt.set(key, Date.now());

      structuredLog("warn", "system", `Service restarting: ${key}`, {
        data: { key, attempt: count, delayMs: data.delayMs },
      });

      log.info(
        `[ProcessLifecycle] ${key} restarting (attempt ${count}, delay ${data.delayMs}ms)`,
      );

      // 通知渲染进程：服务正在重启
      this._broadcast("service:lifecycle", {
        key,
        event: "restarting",
        attempt: count,
        delayMs: data.delayMs,
      });
    };

    // 监听 restart:failed 事件（达到最大重启次数时触发）
    const onRestartFailed = (data: { attempts: number }) => {
      structuredLog(
        "error",
        "system",
        `Service restart limit reached: ${key}`,
        { data: { key, attempts: data.attempts } },
      );

      log.error(
        `[ProcessLifecycle] ${key} max restarts reached (${data.attempts})`,
      );

      // 通知渲染进程：重启失败
      this._broadcast("service:lifecycle", {
        key,
        event: "restartFailed",
        attempts: data.attempts,
      });

      // 立即触发 service:health 让渲染进程刷新服务状态
      this._broadcast("service:health", null);
    };

    proc.on("restart", onRestart as (...args: unknown[]) => void);
    proc.on("restart:failed", onRestartFailed as (...args: unknown[]) => void);

    // 保存清理函数（unregister 时调用）
    this.cleanupFns.set(key, () => {
      proc.off("restart", onRestart as (...args: unknown[]) => void);
      proc.off(
        "restart:failed",
        onRestartFailed as (...args: unknown[]) => void,
      );
    });

    log.info(`[ProcessLifecycle] Registered service: ${key} (${entry.label})`);
  }

  /**
   * 注销服务（清理事件监听器）。
   * 应在应用退出或服务永久下线时调用。
   */
  unregister(key: string): void {
    const cleanup = this.cleanupFns.get(key);
    if (cleanup) {
      cleanup();
      this.cleanupFns.delete(key);
    }
    this.services.delete(key);
    log.debug(`[ProcessLifecycle] Unregistered service: ${key}`);
  }

  // ==================== 状态追踪 ====================

  /**
   * 记录服务成功启动的时刻（用于计算 uptimeMs）。
   * 应在 ManagedProcess.start() 返回 { success: true } 后调用。
   */
  recordStarted(key: string): void {
    this.startedAt.set(key, Date.now());
  }

  /**
   * 手动记录一次崩溃（对于非 ManagedProcess 托管的进程使用）。
   */
  recordCrash(key: string): void {
    const existing = this.restartCounts.get(key) ?? 0;
    this.restartCounts.set(key, existing + 1);
    this.lastCrashAt.set(key, Date.now());
  }

  /**
   * 重置某服务的重启计数（手动重启后调用）。
   */
  resetRestartCount(key: string): void {
    this.restartCounts.set(key, 0);
    this.startedAt.set(key, Date.now());
  }

  // ==================== 诊断查询 ====================

  /**
   * 返回所有托管服务的运行时诊断数据。
   * 供 IPC handler（services:lifecycleStats）调用。
   */
  getStats(): ServiceLifecycleStats[] {
    const now = Date.now();
    return [...this.services.entries()].map(([key, entry]) => {
      const running = entry.process.running;
      const startedAt = this.startedAt.get(key);
      return {
        key,
        label: entry.label,
        running,
        pid: entry.process.pid ?? undefined,
        restartCount: this.restartCounts.get(key) ?? 0,
        lastCrashAt: this.lastCrashAt.get(key),
        uptimeMs: running && startedAt ? now - startedAt : undefined,
      };
    });
  }

  /**
   * 返回指定服务的统计数据（无则返回 undefined）。
   */
  getServiceStats(key: string): ServiceLifecycleStats | undefined {
    return this.getStats().find((s) => s.key === key);
  }

  // ==================== 生命周期 ====================

  /**
   * 清理所有注册服务的事件监听（应用退出时调用）。
   */
  destroy(): void {
    for (const key of [...this.cleanupFns.keys()]) {
      this.unregister(key);
    }
    this.restartCounts.clear();
    this.lastCrashAt.clear();
    this.startedAt.clear();
    log.info("[ProcessLifecycle] Destroyed, all listeners removed");
  }

  // ==================== 内部工具 ====================

  /**
   * 向所有 BrowserWindow 广播 IPC 消息。
   */
  private _broadcast(channel: string, data: unknown): void {
    try {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, data);
        }
      });
    } catch (e) {
      log.warn(`[ProcessLifecycle] Broadcast failed (${channel}):`, e);
    }
  }
}

// ==================== 单例导出 ====================

/**
 * 全局 ProcessLifecycleManager 单例。
 *
 * 在 main.ts 中：
 * ```ts
 * import { processLifecycleManager } from "./services/utils/processLifecycle";
 *
 * // 应用启动时注册
 * processLifecycleManager.register({ key: "lanproxy", label: "Lanproxy", process: lanproxy });
 * processLifecycleManager.register({ key: "fileServer", label: "File Server", process: fileServer });
 *
 * // 成功启动后记录
 * processLifecycleManager.recordStarted("lanproxy");
 *
 * // 应用退出前清理
 * processLifecycleManager.destroy();
 * ```
 */
export const processLifecycleManager = new ProcessLifecycleManager();
