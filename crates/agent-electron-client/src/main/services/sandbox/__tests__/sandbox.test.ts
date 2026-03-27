/**
 * 沙箱测试 - 基础功能测试
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AutoSandbox } from "../AutoSandbox";
import { DEFAULT_SANDBOX_CONFIG } from "../types";
import * as os from "os";

describe("AutoSandbox", () => {
  let sandbox: AutoSandbox;

  beforeAll(async () => {
    sandbox = new AutoSandbox();
    await sandbox.initialize(DEFAULT_SANDBOX_CONFIG);
  });

  afterAll(async () => {
    await sandbox.cleanup();
  });

  describe("初始化", () => {
    it("应该成功初始化", () => {
      expect(sandbox).toBeDefined();
    });

    it("应该返回可用状态", async () => {
      const available = await sandbox.isAvailable();
      expect(typeof available).toBe("boolean");
    });

    it("应该返回正确的平台", () => {
      const status = sandbox.getStatus();
      expect(status.platform).toBe(os.platform());
    });
  });

  describe("命令执行", () => {
    it("应该成功执行简单命令", async () => {
      const result = await sandbox.execute("echo test", "/tmp");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("test");
    });

    it("应该捕获 stderr", async () => {
      const result = await sandbox.execute("bash -c 'echo error >&2'", "/tmp");
      expect(result.stderr.trim()).toBe("error");
    });

    it("应该返回非零退出码（错误命令）", async () => {
      const result = await sandbox.execute("exit 1", "/tmp");
      expect(result.exitCode).toBe(1);
    });

    it("应该支持超时", async () => {
      const start = Date.now();
      const result = await sandbox.execute("sleep 10", "/tmp", {
        timeout: 1,
      });
      const duration = Date.now() - start;

      // 应该在 2 秒内超时
      expect(duration).toBeLessThan(2000);
    }, 5000);
  });

  describe("文件操作", () => {
    const testFile = `/tmp/sandbox-test-${Date.now()}.txt`;

    afterAll(async () => {
      try {
        const fs = require("fs").promises;
        await fs.unlink(testFile);
      } catch {
        // 忽略
      }
    });

    it("应该成功写入文件", async () => {
      await sandbox.writeFile(testFile, "test content");

      const fs = require("fs").promises;
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("test content");
    });

    it("应该成功读取文件", async () => {
      const content = await sandbox.readFile(testFile);
      expect(content.trim()).toBe("test content");
    });
  });

  describe("平台特定", () => {
    it("macOS 应该使用 seatbelt", () => {
      if (os.platform() === "darwin") {
        const status = sandbox.getStatus();
        expect(status.type).toBe("seatbelt");
      }
    });

    it("Linux 应该使用 bubblewrap", () => {
      if (os.platform() === "linux") {
        const status = sandbox.getStatus();
        expect(["bubblewrap", "none"]).toContain(status.type);
      }
    });

    it("Windows 应该使用 codex", () => {
      if (os.platform() === "win32") {
        const status = sandbox.getStatus();
        expect(["codex", "none"]).toContain(status.type);
      }
    });
  });
});
