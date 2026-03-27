/**
 * 沙箱配置管理器
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import Store from "electron-store";
import type { SandboxConfig, SandboxMode } from "./types";
import { DEFAULT_SANDBOX_CONFIG } from "./types";

export class SandboxConfigManager {
  private store: Store;

  constructor() {
    this.store = new Store({
      name: "sandbox-config",
      defaults: {
        config: DEFAULT_SANDBOX_CONFIG,
      },
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): SandboxConfig {
    return this.store.get("config", DEFAULT_SANDBOX_CONFIG) as SandboxConfig;
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<SandboxConfig>): void {
    const current = this.getConfig();
    const merged = this.deepMerge(current, updates);
    this.store.set("config", merged);
  }

  /**
   * 设置沙箱模式
   */
  setMode(mode: SandboxMode): void {
    this.updateConfig({ mode });
  }

  /**
   * 获取当前模式
   */
  getMode(): SandboxMode {
    return this.getConfig().mode;
  }

  /**
   * 是否启用沙箱
   */
  isEnabled(sessionId?: string): boolean {
    const mode = this.getMode();

    switch (mode) {
      case "off":
        return false;
      case "on-demand":
        return false;
      case "non-main":
        return sessionId !== "main";
      case "all":
        return true;
      default:
        return false;
    }
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    this.store.set("config", DEFAULT_SANDBOX_CONFIG);
  }

  /**
   * 深度合并对象
   */
  private deepMerge(base: any, overrides: any): any {
    const result = { ...base };

    for (const key in overrides) {
      if (
        typeof overrides[key] === "object" &&
        !Array.isArray(overrides[key]) &&
        overrides[key] !== null
      ) {
        result[key] = this.deepMerge(result[key] || {}, overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }

    return result;
  }
}
