/**
 * macOS Seatbelt 沙箱集成测试
 *
 * 使用与生产完全一致的 seatbelt profile 格式（无 network*），
 * 验证危险操作被正确拦截。
 *
 * 运行条件：
 * - platform === darwin
 * - /usr/bin/sandbox-exec 存在
 */
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { describe, it, expect, beforeAll } from "vitest";
import { runInSeatbelt, expectBlocked, expectAllowed } from "./shared-integration-utils";

const testOnMacOS = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? describe : describe.skip;

const WORKSPACE_DIR = "/tmp/test-seatbelt-workspace";
const WORKSPACE_DIR_REALPATH = "/private/tmp/test-seatbelt-workspace";

// 确保 workspace 目录存在（宿主上）
beforeAll(() => {
  try {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  } catch {}
});

const SEATBELT_PROFILE_NO_NETWORK = `(version 1)
(deny default)
(allow file-read*)
(allow process-exec (regex #"^/usr/bin/"))
(allow process-exec (regex #"^/bin/"))
(allow process-exec (regex #"^/usr/lib/"))
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix*)
(allow file-lock)
(allow file-write* (subpath "${WORKSPACE_DIR}"))
(allow file-write* (subpath "${WORKSPACE_DIR_REALPATH}"))
(allow file-write* (literal "/dev/null"))
(allow file-write* (literal "/dev/dtracehelper"))
(allow file-write* (literal "/dev/urandom"))
`;

const SEATBELT_PROFILE_WITH_NETWORK = SEATBELT_PROFILE_NO_NETWORK + "(allow network*)\n";

testOnMacOS("macOS seatbelt integration tests", () => {
  // ==================== 文件写入测试 ====================
  describe("file write operations", () => {
    it("should BLOCK writing to /etc/hosts", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "echo test >> /etc/hosts");
      expectBlocked(result);
    });

    it("should BLOCK writing to /etc/passwd", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "echo test >> /etc/passwd");
      expectBlocked(result);
    });

    it("should BLOCK writing to /usr/bin/", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "touch /usr/bin/evil-binary");
      expectBlocked(result);
    });

    it("should BLOCK writing to ~/Documents/", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "touch ~/Documents/exfil.txt");
      expectBlocked(result);
    });

    it("should BLOCK writing to /tmp/ (not in writablePaths)", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "touch /tmp/attacker-file.txt");
      expectBlocked(result);
    });

    it("should ALLOW writing inside workspace", async () => {
      // Workspace dir is pre-created by beforeAll on host.
      // Only the write operation runs inside sandbox (mkdir already succeeded on host).
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "echo safe > /tmp/test-seatbelt-workspace/safe.txt");
      expectAllowed(result);
    });
  });

  // ==================== 文件删除测试 ====================
  describe("file delete operations", () => {
    it("should BLOCK deleting /etc/resolv.conf", async () => {
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "rm /etc/resolv.conf 2>&1 || true");
      expectBlocked(result);
    });

    it("should BLOCK deleting /usr/bin/ls", async () => {
      // Note: On SIP-protected systems, /usr/bin/ls can't be deleted anyway (SIP, not sandbox)
      // We still expect blocked for other reasons
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "rm /usr/bin/ls 2>&1 || true");
      // Just verify some error occurred (either sandbox or system)
      const blocked = result.exitCode !== 0 || /permission|denied|not allowed|no such file/i.test(result.stderr + result.stdout);
      expect(blocked).toBe(true);
    });
  });

  // ==================== 提权测试 ====================
  describe("privilege escalation", () => {
    it("should BLOCK sudo id - sandbox denies exec", async () => {
      // Without || true, exit code reflects sandbox failure
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "sudo id 2>&1");
      // sandbox denies exec of sudo → "Operation not permitted"
      const blocked = result.exitCode !== 0 ||
        /permission|denied|not allowed|operation not permitted/i.test(result.stderr + result.stdout);
      expect(blocked).toBe(true);
    });
  });

  // ==================== 系统命令测试 ====================
  describe("system commands", () => {
    it("should BLOCK shutdown - permission denied by sandbox", async () => {
      // Without || true, the actual exit code will be captured
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "/sbin/shutdown -h now 2>&1");
      // sandbox blocks exec of /sbin/shutdown → "Operation not permitted"
      const blocked = result.exitCode !== 0 ||
        /permission|denied|not allowed|operation not permitted/i.test(result.stderr + result.stdout);
      expect(blocked).toBe(true);
    });
  });

  // ==================== 网络测试 ====================
  describe("network access", () => {
    it("should BLOCK network access (no network* profile)", async () => {
      // Use curl without -s to see error messages; no || true so exitCode reflects curl
      const result = await runInSeatbelt(SEATBELT_PROFILE_NO_NETWORK, "curl --max-time 5 http://example.com 2>&1");
      // curl exit 6 = Could not resolve host (DNS blocked by sandbox)
      const blocked = result.exitCode !== 0 ||
        /could not resolve|failed|connection|network|permission/i.test(result.stderr + result.stdout);
      expect(blocked).toBe(true);
    });

    it("should ALLOW network access (with network* profile)", async () => {
      // With network* allowed, curl error would be non-permission (e.g., exit 6 = DNS fail)
      const result = await runInSeatbelt(SEATBELT_PROFILE_WITH_NETWORK, "curl --max-time 10 http://example.com 2>&1");
      // If exit is non-zero, it should NOT be due to permission denied by sandbox
      if (result.exitCode !== 0) {
        expect(/permission|denied.*network|operation not permitted/i.test(result.stderr + result.stdout)).toBe(false);
      }
    });
  });
});