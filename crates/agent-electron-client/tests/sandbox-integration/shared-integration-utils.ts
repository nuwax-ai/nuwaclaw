import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const TIMEOUT_MS = 10000;

/**
 * 在 macOS seatbelt profile 下执行命令
 */
export async function runInSeatbelt(
  profileContent: string,
  shellCommand: string,
): Promise<ExecResult> {
  const tmpProfile = `/tmp/nuwax-test-${Date.now()}.sb`;
  const cmd = `echo '${profileContent.replace(/'/g, "'\\''")}' > ${tmpProfile} && sandbox-exec -f ${tmpProfile} /bin/sh -c '${shellCommand.replace(/'/g, "'\\''")}' ; rm -f ${tmpProfile}`;
  try {
    const { stdout, stderr, signal, code } = await execAsync(cmd, {
      timeout: TIMEOUT_MS,
      shell: "/bin/sh",
    });
    return {
      exitCode: code ?? 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      timedOut: signal === "SIGTERM",
    };
  } catch (e: any) {
    return {
      exitCode: e.code ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      timedOut: e.signal === "SIGTERM",
    };
  }
}

/**
 * 在 bwrap 下执行命令
 */
export async function runInBwrap(
  bwrapArgs: string[],
  shellCommand: string,
): Promise<ExecResult> {
  try {
    const { stdout, stderr, signal, code } = await execAsync(
      `bwrap ${bwrapArgs.join(" ")} /bin/sh -c '${shellCommand.replace(/'/g, "'\\''")}'`,
      { timeout: TIMEOUT_MS, shell: "/bin/sh" }
    );
    return {
      exitCode: code ?? 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      timedOut: signal === "SIGTERM",
    };
  } catch (e: any) {
    return {
      exitCode: e.code ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      timedOut: e.signal === "SIGTERM",
    };
  }
}

export function expectBlocked(result: ExecResult): void {
  // exitCode !== 0 或 stdout/stderr 包含 permission/operation not permitted 等关键字
  const blocked = result.exitCode !== 0 ||
    /permission|operation not permitted|denied|not allowed|read-only/i.test(result.stderr) ||
    /permission|operation not permitted|denied|not allowed|read-only/i.test(result.stdout);
  if (!blocked) {
    throw new Error(
      `Expected operation to be blocked, but it succeeded.\nExit code: ${result.exitCode}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`
    );
  }
}

export function expectAllowed(result: ExecResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Expected operation to be allowed, but it failed.\nExit code: ${result.exitCode}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`
    );
  }
}