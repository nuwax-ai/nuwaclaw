/**
 * 沙箱配置管理器测试
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SandboxConfigManager } from "../SandboxConfigManager";
import { DEFAULT_SANDBOX_CONFIG } from "../types";

describe("SandboxConfigManager", () => {
  let manager: SandboxConfigManager;

  beforeEach(() => {
    manager = new SandboxConfigManager();
  });

  describe("配置管理", () => {
    it("应该返回默认配置", () => {
      const config = manager.getConfig();
      expect(config).toEqual(DEFAULT_SANDBOX_CONFIG);
    });

    it("应该成功更新配置", () => {
      manager.updateConfig({ mode: "all" });
      const config = manager.getConfig();
      expect(config.mode).toBe("all");
    });

    it("应该成功设置模式", () => {
      manager.setMode("off");
      expect(manager.getMode()).toBe("off");
    });

    it("应该重置为默认配置", () => {
      manager.setMode("all");
      manager.reset();
      const config = manager.getConfig();
      expect(config.mode).toBe(DEFAULT_SANDBOX_CONFIG.mode);
    });
  });

  describe("模式检查", () => {
    it("off 模式应该返回 false", () => {
      manager.setMode("off");
      expect(manager.isEnabled()).toBe(false);
    });

    it("on-demand 模式应该返回 false", () => {
      manager.setMode("on-demand");
      expect(manager.isEnabled()).toBe(false);
    });

    it("non-main 模式应该正确区分会话", () => {
      manager.setMode("non-main");
      expect(manager.isEnabled("main")).toBe(false);
      expect(manager.isEnabled("other")).toBe(true);
    });

    it("all 模式应该返回 true", () => {
      manager.setMode("all");
      expect(manager.isEnabled()).toBe(true);
    });
  });
});
