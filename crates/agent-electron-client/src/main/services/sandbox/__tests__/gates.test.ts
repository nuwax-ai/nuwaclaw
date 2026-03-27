/**
 * CP4 质量门禁测试
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_SANDBOX_CONFIG } from "../types";

describe("CP4 Quality Gates", () => {
  describe("Gate 1: config-validate", () => {
    it("应该有有效的模式", () => {
      const validModes = ["off", "on-demand", "non-main", "all"];
      expect(validModes).toContain(DEFAULT_SANDBOX_CONFIG.mode);
    });

    it("应该有有效的平台配置", () => {
      const config = DEFAULT_SANDBOX_CONFIG;

      if (config.platform?.darwin) {
        expect(["seatbelt", "none"]).toContain(config.platform.darwin.type);
      }

      if (config.platform?.linux) {
        expect(["bubblewrap", "none"]).toContain(config.platform.linux.type);
      }

      if (config.platform?.win32) {
        expect(["codex", "none"]).toContain(config.platform.win32.type);
      }
    });

    it("应该有有效的资源配置", () => {
      const config = DEFAULT_SANDBOX_CONFIG;

      expect(config.resources?.memory).toMatch(/^\d+[gm]$/);
      expect(config.resources?.cpu).toBeGreaterThan(0);
      expect(config.resources?.timeout).toBeGreaterThan(0);
    });
  });

  describe("Gate 2: platform-detect", () => {
    it("应该检测到支持的平台", () => {
      const platform = process.platform;
      const supportedPlatforms = ["darwin", "linux", "win32"];

      expect(supportedPlatforms).toContain(platform);
    });
  });

  describe("Gate 3: sandbox-init", () => {
    it("应该能够导入 AutoSandbox", async () => {
      const { AutoSandbox } = await import("../AutoSandbox");
      expect(AutoSandbox).toBeDefined();
    });

    it("应该能够创建 AutoSandbox 实例", async () => {
      const { AutoSandbox } = await import("../AutoSandbox");
      const sandbox = new AutoSandbox();
      expect(sandbox).toBeDefined();
    });

    it("应该能够初始化", async () => {
      const { AutoSandbox } = await import("../AutoSandbox");
      const sandbox = new AutoSandbox();

      await expect(
        sandbox.initialize(DEFAULT_SANDBOX_CONFIG),
      ).resolves.not.toThrow();
    });
  });

  describe("Gate 4: execute-test", () => {
    it("应该能够执行简单命令", async () => {
      const { AutoSandbox } = await import("../AutoSandbox");
      const sandbox = new AutoSandbox();
      await sandbox.initialize(DEFAULT_SANDBOX_CONFIG);

      const result = await sandbox.execute("echo test", "/tmp");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("test");
    });
  });

  describe("Gate 5: integration-test", () => {
    it("应该通过完整的集成测试", async () => {
      const { AutoSandbox } = await import("../AutoSandbox");
      const sandbox = new AutoSandbox();

      // 初始化
      await sandbox.initialize(DEFAULT_SANDBOX_CONFIG);

      // 执行命令
      const result = await sandbox.execute("ls -la", "/tmp");
      expect(result.exitCode).toBe(0);

      // 检查状态
      const status = sandbox.getStatus();
      expect(status.available).toBe(true);

      // 清理
      await sandbox.cleanup();
    });
  });
});
