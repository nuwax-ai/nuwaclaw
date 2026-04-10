/**
 * Process tree kill utility.
 *
 * Kills a process and all its descendants to prevent zombie processes.
 *
 * Strategy (Unix):
 * 1. Try process group kill (-pid) — works when spawned with detached: true
 *    and setsid() succeeds (PGID = pid).
 * 2. Fall back to recursive descendant kill via `pgrep -P` — handles the case
 *    where detached: true didn't create a new process group (e.g. dev mode
 *    under make → Electron, where all processes share the terminal's PGID).
 * 3. Kill the root process directly.
 *
 * Windows: Uses taskkill /T /F /PID for tree kill.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import log from "electron-log";
import { createPlatformAdapter } from "../system/platformAdapter";

const isWindows = (): boolean => createPlatformAdapter().isWindows;

/**
 * Kill a process tree (the process and all its descendants).
 *
 * @param pid - Process ID to kill
 * @param signal - Signal to send (default: SIGTERM). Ignored on Windows (always force-kills).
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (isWindows()) {
    return killProcessTreeWindows(pid);
  }
  return killProcessTreeUnix(pid, signal);
}

/**
 * Kill a process tree with graceful escalation:
 * 1. Send SIGTERM to the process tree
 * 2. Wait up to `timeoutMs` for the root process to exit
 * 3. If still alive, send SIGKILL to the process tree
 *
 * @param pid - Process ID to kill
 * @param timeoutMs - Time to wait before escalating to SIGKILL (default: 5000ms)
 */
export async function killProcessTreeGraceful(
  pid: number,
  timeoutMs = 5000,
): Promise<void> {
  // Step 1: Send SIGTERM to the entire tree
  try {
    await killProcessTree(pid, "SIGTERM");
  } catch (e) {
    log.warn(`[processTree] SIGTERM failed for pid ${pid}:`, e);
  }

  // Step 2: Wait for root process to exit
  const alive = await waitForExit(pid, timeoutMs);

  // Step 3: Escalate to SIGKILL if still alive
  if (alive) {
    log.warn(
      `[processTree] Process ${pid} still alive after ${timeoutMs}ms, sending SIGKILL`,
    );
    try {
      await killProcessTree(pid, "SIGKILL");
    } catch (e) {
      log.warn(`[processTree] SIGKILL failed for pid ${pid}:`, e);
    }
  }
}

/** 系统保留 / 非用户进程 PID 上限，按端口清进程时跳过 */
const SYSTEM_PID_CEILING = 4;

/**
 * 从 Windows `netstat -ano` 标准输出中解析「本机在该 TCP 端口上 LISTENING」的 PID。
 * 用于 uv 已退出但子进程仍占用端口、ManagedProcess 已无 PID 等场景的兜底排查。
 */
export function collectListeningPidsOnPortFromNetstatStdout(
  stdout: string,
  port: number,
): number[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return [];
  }
  const portSuffix = `:${port}`;
  const localMarkers = [
    `127.0.0.1${portSuffix}`,
    `0.0.0.0${portSuffix}`,
    `[::1]${portSuffix}`,
    `[::ffff:127.0.0.1]${portSuffix}`,
    `[::]${portSuffix}`,
    `*${portSuffix}`,
  ];
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const isListening = /\bLISTENING\b/i.test(line) || line.includes("监听");
    if (!isListening) {
      continue;
    }
    if (!localMarkers.some((m) => line.includes(m))) {
      continue;
    }
    const m =
      line.match(/\bLISTENING\s+(\d+)\s*$/i) || line.match(/监听\s+(\d+)\s*$/);
    if (!m) {
      continue;
    }
    const pid = parseInt(m[1], 10);
    if (Number.isFinite(pid) && pid > SYSTEM_PID_CEILING) {
      pids.add(pid);
    }
  }
  return [...pids];
}

/**
 * Windows：按 TCP 端口清理 LISTENING 进程（整树终止）。
 * 在 stopWindowsMcp / 手动重启 GUI MCP 时，作为 taskkill 跟踪 PID 之外的第二道防线。
 */
export async function killProcessTreesListeningOnTcpPortWindows(
  port: number,
  timeoutMsPerTree = 3000,
): Promise<void> {
  if (!isWindows()) {
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return;
  }

  return new Promise((resolve) => {
    execFile("netstat", ["-ano"], { windowsHide: true }, (err, stdout) => {
      void (async () => {
        if (err) {
          log.warn("[processTree] netstat -ano failed:", err);
          resolve();
          return;
        }
        const raw = collectListeningPidsOnPortFromNetstatStdout(stdout, port);
        const own = process.pid;
        const pids = raw.filter(
          (pid) => pid > SYSTEM_PID_CEILING && pid !== own,
        );
        if (pids.length > 0) {
          log.info(
            `[processTree] port ${port} TCP LISTENING -> taskkill tree for PIDs: ${pids.join(", ")}`,
          );
        }
        for (const pid of pids) {
          try {
            await killProcessTreeGraceful(pid, timeoutMsPerTree);
          } catch (e) {
            log.warn(
              `[processTree] killProcessTreeGraceful pid=${pid} port=${port}:`,
              e,
            );
          }
        }
        resolve();
      })();
    });
  });
}

/**
 * macOS/Linux：按 TCP 端口清理 LISTENING 进程（整树终止）。
 * macOS 使用 lsof；Linux 优先 lsof，lsof 不可用时回退到 /proc/net/tcp。
 */
export async function killProcessTreesListeningOnTcpPortUnix(
  port: number,
  timeoutMsPerTree = 3000,
): Promise<void> {
  const platformAdapter = createPlatformAdapter();
  if (platformAdapter.isWindows) {
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return;
  }

  // Linux: 优先尝试 lsof，若不可用则回退到 /proc/net/tcp
  if (platformAdapter.isLinux) {
    const pids = await getListeningPidsFromProcNet(port);
    if (pids.length > 0) {
      log.info(
        `[processTree] port ${port} TCP LISTENING (from /proc/net/tcp) -> killing PIDs: ${pids.join(", ")}`,
      );
      for (const pid of pids) {
        try {
          await killProcessTreeGraceful(pid, timeoutMsPerTree);
        } catch (e) {
          log.warn(
            `[processTree] killProcessTreeGraceful pid=${pid} port=${port}:`,
            e,
          );
        }
      }
    }
    return;
  }

  // macOS: 使用 lsof
  return new Promise((resolve) => {
    execFile("lsof", ["-t", "-i", `:${port}`], (err, stdout) => {
      void (async () => {
        if (err || !stdout.trim()) {
          // 无进程占用或 lsof 失败，静默忽略
          resolve();
          return;
        }
        const pids = stdout
          .trim()
          .split("\n")
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isFinite(n) && n > SYSTEM_PID_CEILING);

        // 排除当前进程自己
        const own = process.pid;
        const filteredPids = pids.filter((pid) => pid !== own);

        if (filteredPids.length > 0) {
          log.info(
            `[processTree] port ${port} TCP LISTENING (from lsof) -> killing PIDs: ${filteredPids.join(", ")}`,
          );
        }
        for (const pid of filteredPids) {
          try {
            await killProcessTreeGraceful(pid, timeoutMsPerTree);
          } catch (e) {
            log.warn(
              `[processTree] killProcessTreeGraceful pid=${pid} port=${port}:`,
              e,
            );
          }
        }
        resolve();
      })();
    });
  });
}

/**
 * Linux 专用：从 /proc/net/tcp 解析占用指定端口的 PID 列表。
 * /proc/net/tcp 的本地地址是十六进制表示，inode 可用于关联 /proc/{pid}/fd。
 * 注意：仅匹配 IPv4 (0.0.0.0 和 127.0.0.1) 和 IPv6 (::1) 的 LISTEN 套接字。
 *
 * @param port 十进制端口号
 * @returns PID 列表
 */
function getListeningPidsFromProcNet(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const pids = new Set<number>();
    const portHex = port.toString(16).toUpperCase().padStart(4, "0");

    // 读取 /proc/net/tcp
    fs.readFile("/proc/net/tcp", "utf8", (err, data) => {
      if (err) {
        log.warn("[processTree] Failed to read /proc/net/tcp:", err);
        resolve([]);
        return;
      }

      const lines = data.split("\n").slice(1); // 跳过标题行
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10) continue;

        const localAddress = fields[1];
        const inode = fields[9];

        // 检查是否为 LISTEN 状态且端口匹配
        const isListening = fields[3] === "0A"; // 0A = LISTEN in hex
        const portMatch = localAddress.endsWith(`:${portHex}`);

        if (!isListening || !portMatch || !inode) continue;

        // 查找拥有此 inode 的进程
        const inodeNum = parseInt(inode, 10);
        if (!Number.isFinite(inodeNum)) continue;

        // 遍历 /proc/*/fd，寻找 socket:[inode] 符号链接
        try {
          const procEntries = fs.readdirSync("/proc");
          for (const entryName of procEntries) {
            if (entryName === "." || entryName === "..") continue;
            const pid = parseInt(entryName, 10);
            if (!Number.isFinite(pid) || pid <= SYSTEM_PID_CEILING) continue;

            const fdDir = `/proc/${pid}/fd`;
            try {
              const fdEntries = fs.readdirSync(fdDir);
              for (const fdEntry of fdEntries) {
                try {
                  const linkTarget = fs.readlinkSync(`${fdDir}/${fdEntry}`);
                  if (linkTarget === `socket:[${inodeNum}]`) {
                    pids.add(pid);
                  }
                } catch {
                  // 权限不足或 fd 已消失，跳过
                }
              }
            } catch {
              // 进程已退出或无权限
            }
          }
        } catch {
          // /proc 读取失败
        }
      }

      // 排除当前进程
      pids.delete(process.pid);
      resolve([...pids]);
    });
  });
}

/**
 * 跨平台：按 TCP 端口清理 LISTENING 进程（整树终止）。
 * Windows 调用 killProcessTreesListeningOnTcpPortWindows，
 * macOS/Linux 调用 killProcessTreesListeningOnTcpPortUnix。
 */
export async function killProcessTreesListeningOnTcpPort(
  port: number,
  timeoutMsPerTree = 3000,
): Promise<void> {
  if (isWindows()) {
    return killProcessTreesListeningOnTcpPortWindows(port, timeoutMsPerTree);
  }
  return killProcessTreesListeningOnTcpPortUnix(port, timeoutMsPerTree);
}

// ==================== Internal ====================

function killProcessTreeWindows(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "taskkill",
      ["/T", "/F", "/PID", String(pid)],
      { windowsHide: true },
      (err) => {
        if (err) {
          // taskkill returns exit code 128 if process not found — treat as success
          const code = (err as any).code;
          if (code === 128 || code === "ESRCH") {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      },
    );
  });
}

/**
 * Kill a process and all its descendants on Unix.
 *
 * Two strategies, tried in order:
 * 1. Process group kill: `kill(-pid, signal)` — fast, kills all processes whose
 *    PGID equals `pid`. Works when child was spawned with `detached: true` and
 *    setsid() actually created a new process group.
 * 2. Recursive descendant kill: walks the process tree using `pgrep -P` and
 *    kills each descendant bottom-up. This handles the case where the process
 *    group was NOT changed (e.g. Electron dev mode under make, where all
 *    processes share the terminal's PGID).
 */
async function killProcessTreeUnix(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  let groupKillWorked = false;

  // Strategy 1: Try process group kill
  try {
    process.kill(-pid, signal);
    groupKillWorked = true;
    log.info(`[processTree] Sent ${signal} to process group -${pid}`);
  } catch (e: any) {
    if (e.code === "ESRCH") {
      // ESRCH from group kill means no process with PGID=pid exists.
      // But the process itself may still be alive with a different PGID
      // (e.g. dev mode where detached: true didn't create a new group).
      log.info(
        `[processTree] No process group -${pid}, falling back to descendant kill`,
      );
    } else {
      log.warn(`[processTree] Group kill failed for pid ${pid}:`, e.message);
    }
  }

  // Strategy 2: Recursive descendant kill (always run as safety net)
  if (!groupKillWorked) {
    const descendants = await getDescendants(pid);
    if (descendants.length > 0) {
      log.info(
        `[processTree] Killing ${descendants.length} descendant(s) of pid ${pid}: ${descendants.join(",")}`,
      );
    }
    // Kill bottom-up (children first, then parent)
    for (const childPid of descendants.reverse()) {
      try {
        process.kill(childPid, signal);
      } catch {
        // ESRCH — already dead, ignore
      }
    }
    // Kill root process
    try {
      process.kill(pid, signal);
    } catch (e: any) {
      if (e.code !== "ESRCH") {
        log.warn(`[processTree] Direct kill failed for pid ${pid}:`, e.message);
      }
    }
  }
}

/**
 * Get all descendant PIDs of a process (children, grandchildren, etc.)
 * using `pgrep -P`. Returns PIDs in depth-first order.
 */
async function getDescendants(pid: number): Promise<number[]> {
  const result: number[] = [];
  const children = await getChildPids(pid);
  for (const child of children) {
    result.push(child);
    const grandchildren = await getDescendants(child);
    result.push(...grandchildren);
  }
  return result;
}

/**
 * Get direct child PIDs of a process using `pgrep -P`.
 */
function getChildPids(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-P", String(pid)], (err, stdout) => {
      if (err || !stdout.trim()) {
        // No children or pgrep failed
        resolve([]);
        return;
      }
      const pids = stdout
        .trim()
        .split("\n")
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));
      resolve(pids);
    });
  });
}

/**
 * Check if a process is still alive, polling until timeout.
 * Returns true if still alive, false if exited.
 */
function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        // signal 0 doesn't kill, just checks if process exists
        process.kill(pid, 0);
        // Still alive
        if (Date.now() - start >= timeoutMs) {
          resolve(true);
        } else {
          setTimeout(check, 200);
        }
      } catch {
        // Process gone
        resolve(false);
      }
    };
    check();
  });
}
