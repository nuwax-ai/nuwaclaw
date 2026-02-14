// Mock 数据服务 - 模拟后端 API
// 用于前端开发和调试，无需启动后端服务

import { checkAllPermissions, openSystemSettings } from "./permissions";
import type { PermissionCategory, PermissionsState } from "./permissions";

// Agent 状态
export type AgentStatus =
  | "idle"
  | "starting"
  | "running"
  | "busy"
  | "error"
  | "stopped";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

// 权限数据改为使用 permissions 服务的完整列表（含平台过滤），保证权限菜单与配置一致

// 模拟数据
const mockLogs: LogEntry[] = [
  { id: "1", timestamp: "14:30:25", level: "info", message: "系统启动完成" },
  {
    id: "2",
    timestamp: "14:30:26",
    level: "success",
    message: "连接到服务器成功",
  },
  { id: "3", timestamp: "14:30:27", level: "info", message: "等待任务指令..." },
];

// Mock 服务类
class MockService {
  private status: AgentStatus = "idle";
  private sessionId: string = "";
  private logs: LogEntry[] = [...mockLogs];
  private callbacks: Map<string, ((...args: any[]) => void)[]> = new Map();

  // 获取状态
  async getStatus() {
    return {
      status: this.status,
      session_id: this.sessionId || undefined,
    };
  }

  // 启动 Agent
  async startAgent(): Promise<boolean> {
    this.status = "starting";
    this.addLog("info", "正在启动 Agent...");
    this.notify("statusChange", this.status);

    // 模拟启动延迟
    await this.delay(1500);

    this.status = "running";
    this.sessionId = this.generateSessionId();
    this.addLog("success", `Agent 启动成功，会话 ID: ${this.sessionId}`);
    this.notify("statusChange", this.status);
    return true;
  }

  // 停止 Agent
  async stopAgent(): Promise<boolean> {
    this.addLog("info", "正在停止 Agent...");
    this.status = "stopped";
    this.sessionId = "";
    this.addLog("success", "Agent 已停止");
    this.notify("statusChange", this.status);
    return true;
  }

  // 获取日志
  async getLogs(): Promise<LogEntry[]> {
    return [...this.logs];
  }

  // 获取连接信息
  getConnectionInfo() {
    // 如果没有 session，返回空状态
    if (!this.sessionId) {
      return {
        id: "",
        server: "",
        status: "disconnected",
      };
    }
    return {
      id: this.sessionId,
      server: "localhost:21116",
      status: this.status === "running" ? "connected" : "disconnected",
    };
  }

  // 获取权限状态：使用 permissions 服务的完整列表与平台检测，保证权限菜单全部接入
  async getPermissions(): Promise<PermissionsState> {
    const state = await checkAllPermissions();
    return state;
  }

  // 刷新权限状态
  async refreshPermissions(): Promise<PermissionsState> {
    await this.delay(300);
    return this.getPermissions();
  }

  // 打开系统偏好设置：委托给 permissions 服务，使用正确的系统设置 URL
  async openSystemPreferences(permissionId: string): Promise<boolean> {
    this.addLog("info", `正在打开系统偏好设置: ${permissionId}`);
    return openSystemSettings(permissionId as PermissionCategory);
  }

  // 添加日志
  private addLog(level: LogEntry["level"], message: string) {
    const log: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    this.logs = [log, ...this.logs].slice(0, 100);
    this.notify("logChange", log);
  }

  // 事件订阅，返回取消订阅函数
  on(event: string, callback: (...args: any[]) => void) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
    // 返回取消订阅函数
    return () => {
      const callbacks = this.callbacks.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  // 事件通知
  private notify(event: string, data: any) {
    const callbacks = this.callbacks.get(event) || [];
    callbacks.forEach((cb) => cb(data));
  }

  // 工具函数
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateSessionId(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// 单例
const mockService = new MockService();

// 便捷函数
export const startAgent = () => mockService.startAgent();
export const stopAgent = () => mockService.stopAgent();
export const getConnectionInfo = () => mockService.getConnectionInfo();
export const getPermissions = () => mockService.getPermissions();
export const refreshPermissions = () => mockService.refreshPermissions();
export const openSystemPreferences = (permissionId: string) =>
  mockService.openSystemPreferences(permissionId);
export const onStatusChange = (cb: (...args: any[]) => void): (() => void) =>
  mockService.on("statusChange", cb);
export const onLogChange = (cb: (...args: any[]) => void): (() => void) =>
  mockService.on("logChange", cb);
