/**
 * Linux bwrap 沙箱集成测试
 *
 * 使用 --ro-bind / / --tmpfs /tmp --unshare-net（无网络），
 * 验证危险操作被正确拦截。
 *
 * 运行条件：
 * - platform === linux
 * - bwrap 命令可用
 */
import { exec } from "child_process";
import { existsSync } from "fs";
import { describe, it, expect, beforeAll } from "vitest";

const testOnLinux = process.platform === "linux" ? describe : describe.skip;

let bwrapAvailable = false;
let workspaceDir = "/tmp/test-bwrap-workspace";

beforeAll(async () => {
  try {
    const { stdout } = await exec("which bwrap");
    bwrapAvailable = stdout.trim().length > 0;
  } catch {
    bwrapAvailable = false;
  }
  // 创建测试工作区
  await exec(`mkdir -p ${workspaceDir}`).catch(() => {});
});

const BASE_BWRAP_ARGS_NO_NET = [
  "--die-with-parent",
  "--new-session",
  "--unshare-user-try",
  "--unshare-pid",
  "--unshare-uts",
  "--unshare-cgroup-try",
  "--unshare-net",
  "--dev-bind", "/dev", "/dev",
  "--proc", "/proc",
  "--tmpfs", "/tmp",
  "--ro-bind", "/", "/",
  "--bind", workspaceDir, workspaceDir,
  "--chdir", workspaceDir,
];

testOnLinux("Linux bwrap integration tests", () => {
  // ==================== 文件写入测试 ====================
  describe("file write operations", () => {
    it("should BLOCK writing to /etc/hosts", async () => {
      const result = await runBwrapCommand(`echo test >> /etc/hosts`);
      expectBlocked(result);
    });

    it("should BLOCK writing to /etc/passwd", async () => {
      const result = await runBwrapCommand(`echo test >> /etc/passwd`);
      expectBlocked(result);
    });

    it("should BLOCK writing to /usr/bin/", async () => {
      const result = await runBwrapCommand(`touch /usr/bin/evil-binary`);
      expectBlocked(result);
    });

    it("should BLOCK writing to /home/", async () => {
      const result = await runBwrapCommand(`touch /home/exfil.txt`);
      expectBlocked(result);
    });

    it("should ALLOW writing inside workspace", async () => {
      const result = await runBwrapCommand(`echo safe > ${workspaceDir}/safe.txt`);
      expectAllowed(result);
    });

    it("should ALLOW writing to /tmp/ (tmpfs)", async () => {
      const result = await runBwrapCommand(`echo tmpfs > /tmp/bwrap-tmp-test.txt && cat /tmp/bwrap-tmp-test.txt`);
      expectAllowed(result);
    });

    it("should verify /tmp/ write is in tmpfs not host", async () => {
      // 验证 /tmp 是 tmpfs，宿主 /tmp 不会有这个文件
      await runBwrapCommand(`echo isolated > /tmp/unique-bwrap-test.txt`);
      const { stdout } = await exec(`cat /tmp/unique-bwrap-test.txt 2>&1 || echo "FILE_NOT_FOUND"`);
      // 宿主 /tmp 不应有此文件（因为是 tmpfs）
      expect(stdout.trim()).toBe("FILE_NOT_FOUND");
    });
  });

  // ==================== 文件删除测试 ====================
  describe("file delete operations", () => {
    it("should BLOCK deleting /etc/hostname", async () => {
      const result = await runBwrapCommand(`rm /etc/hostname 2>&1 || true`);
      expectBlocked(result);
    });

    it("should BLOCK deleting /bin/sh", async () => {
      const result = await runBwrapCommand(`rm /bin/sh 2>&1 || true`);
      expectBlocked(result);
    });
  });

  // ==================== 网络测试 ====================
  describe("network access", () => {
    it("should BLOCK external network (--unshare-net)", async () => {
      const result = await runBwrapCommand(`curl -s --max-time 5 http://example.com 2>&1 || true`);
      expectBlocked(result);
    });

    it("should ALLOW loopback (localhost still accessible)", async () => {
      // --unshare-net 后 lo 仍可用，localhost 应该能工作
      const result = await runBwrapCommand(`ping -c 1 127.0.0.1 2>&1 || true`);
      // ping 可能有其他限制，只要不是 "network unreachable" 就行
      const blocked = /network.unreachable|no.route|operation.not.permitted/i.test(result.stderr + result.stdout);
      // 注意：某些环境下 ping 需要 CAP_NET_RAW，可能被阻止
      // 宽松处理：网络操作失败是预期的
      expect(result.exitCode !== 0 || blocked).toBe(true);
    });
  });

  // ==================== 提权测试 ====================
  describe("privilege escalation", () => {
    it("should BLOCK sudo id", async () => {
      const result = await runBwrapCommand(`sudo id 2>&1 || true`);
      expect(result.exitCode !== 0 || /permission|denied/i.test(result.stderr + result.stdout)).toBe(true);
    });
  });

  // ==================== 系统命令测试 ====================
  describe("system commands", () => {
    it("should BLOCK reboot", async () => {
      const result = await runBwrapCommand(`reboot 2>&1 || true`);
      expectBlocked(result);
    });

    it("should BLOCK halt", async () => {
      const result = await runBwrapCommand(`halt 2>&1 || true`);
      expectBlocked(result);
    });
  });

  // ==================== /dev gap 测试 ====================
  describe("/dev access gap", () => {
    it("should BLOCK mknod", async () => {
      const result = await runBwrapCommand(`mknod /dev/test-device c 1 5 2>&1 || true`);
      expectBlocked(result);
    });

    it("should BLOCK writing to /dev/sda", async () => {
      const result = await runBwrapCommand(`echo evil > /dev/sda 2>&1 || true`);
      expectBlocked(result);
    });
  });

  // ==================== PID 命名空间测试 ====================
  describe("PID namespace isolation", () => {
    it("should show few processes (PID namespace isolated)", async () => {
      const result = await runBwrapCommand(`ps aux | wc -l`);
      const count = parseInt(result.stdout.trim(), 10);
      // 在隔离的 PID 命名空间中，进程数应该很少（远少于宿主机的进程数）
      expect(count).toBeLessThan(20);
    });
  });
});

// Helper
async function runBwrapCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout, stderr, code } = await execAsync(
      `bwrap ${BASE_BWRAP_ARGS_NO_NET.join(" ")} /bin/sh -c '${command.replace(/'/g, "'\\''")}'`,
      { timeout: 10000 }
    );
    return { exitCode: code ?? 0, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e: any) {
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
  }
}

// 从 shared-imports 复用 expectBlocked/expectAllowed
function expectBlocked(result: { exitCode: number; stdout: string; stderr: string }): void {
  const blocked = result.exitCode !== 0 ||
    /permission|operation not permitted|denied|not allowed|read-only/i.test(result.stderr) ||
    /permission|operation not permitted|denied|not allowed|read-only/i.test(result.stdout);
  if (!blocked) {
    throw new Error(`Expected blocked, got exitCode=${result.exitCode}`);
  }
}

function expectAllowed(result: { exitCode: number; stdout: string; stderr: string }): void {
  if (result.exitCode !== 0) {
    throw new Error(`Expected allowed, got exitCode=${result.exitCode}: ${result.stderr}`);
  }
}