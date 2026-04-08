/**
 * 统一沙箱调用构建器
 *
 * 合并 CommandSandbox 中 buildInvocation() 和 buildProcessInvocation()
 * 的重复平台分支逻辑，提供单一入口构建所有平台的沙箱包装调用。
 *
 * 支持平台：
 * - none（直接执行）
 * - macos-seatbelt（sandbox-exec）
 * - linux-bwrap（bubblewrap）
 * - windows-sandbox（nuwax-sandbox-helper）
 *
 * @version 1.0.0
 * @updated 2026-04-03
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import log from "electron-log";
import { checkCommand } from "../system/shellEnv";
import type {
  SandboxMode,
  SandboxType,
  WindowsSandboxMode,
} from "@shared/types/sandbox";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";

// ============================================================================
// 类型
// ============================================================================

/** 沙箱调用器配置 */
export interface SandboxInvokerOptions {
  /** Linux bwrap 二进制路径（可选，默认 PATH 查找） */
  linuxBwrapPath?: string;
  /** Windows sandbox helper 路径 */
  windowsSandboxHelperPath?: string;
  /** Windows sandbox 模式 */
  windowsSandboxMode?: WindowsSandboxMode;
  /** 是否允许网络访问 */
  networkEnabled?: boolean;
  /** 沙箱模式 */
  mode?: SandboxMode;
}

/** 沙箱调用参数 */
export interface SandboxInvocationParams {
  /** 待包装的命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 可写路径列表 */
  writablePaths: string[];
  /** 是否允许网络访问 */
  networkEnabled: boolean;
  /** 子命令模式：run=捕获输出返回 JSON，serve=双向 stdio 转发 */
  subcommand?: "run" | "serve";
  /** 额外可执行路径白名单（compat 启动链路） */
  startupExecAllowlist?: string[];
}

/** 沙箱包装后的调用描述 */
export interface Invocation {
  /** 包装后的命令（可能是 sandbox-exec / bwrap / nuwax-sandbox-helper） */
  command: string;
  /** 包装后的参数 */
  args: string[];
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** helper run 模式返回 JSON stdout，需要解析 */
  parseJson?: boolean;
  /** macOS seatbelt profile 文件路径（调用方负责清理） */
  seatbeltProfilePath?: string;
}

// ============================================================================
// SandboxInvoker
// ============================================================================

/**
 * 统一沙箱调用构建器
 *
 * 所有平台分支逻辑集中在此类中，CommandSandbox 和 sandboxProcessWrapper
 * 均委托给它来构建调用。
 */
export class SandboxInvoker {
  private readonly type: SandboxType;
  private readonly options: SandboxInvokerOptions;
  /** Resolved sandbox mode (strict / compat / permissive), used by all platform builders */
  private readonly effectiveMode: SandboxMode;

  constructor(type: SandboxType, options: SandboxInvokerOptions = {}) {
    this.type = type;
    this.options = options;
    this.effectiveMode = options.mode ?? "compat";
  }

  /**
   * 统一构建沙箱包装调用
   */
  async buildInvocation(params: SandboxInvocationParams): Promise<Invocation> {
    switch (this.type) {
      case "none":
        return this.buildNone(params);
      case "macos-seatbelt":
        return this.buildSeatbelt(params);
      case "linux-bwrap":
        return this.buildBwrap(params);
      case "windows-sandbox":
        return this.buildWindowsHelper(params);
      case "docker":
        log.warn(
          "[SandboxInvoker] Docker process-level sandbox not supported yet, returning unwrapped call",
        );
        return {
          command: params.command,
          args: params.args,
          cwd: params.cwd,
          env: params.env,
        };
      default:
        throw new SandboxError(
          `不支持的沙箱类型: ${String(this.type)}`,
          SandboxErrorCode.CONFIG_INVALID,
        );
    }
  }

  /**
   * 检测当前后端是否可用
   */
  async checkAvailable(): Promise<boolean> {
    switch (this.type) {
      case "none":
        return true;

      case "macos-seatbelt":
        return (
          process.platform === "darwin" &&
          fs.existsSync("/usr/bin/sandbox-exec")
        );

      case "linux-bwrap": {
        if (process.platform !== "linux") return false;
        if (
          this.options.linuxBwrapPath &&
          fs.existsSync(this.options.linuxBwrapPath)
        ) {
          return true;
        }
        return checkCommand("bwrap");
      }

      case "windows-sandbox": {
        if (process.platform !== "win32") return false;
        return (
          !!this.options.windowsSandboxHelperPath &&
          fs.existsSync(this.options.windowsSandboxHelperPath)
        );
      }

      default:
        return false;
    }
  }

  // ============================================================================
  // 平台实现
  // ============================================================================

  private buildNone(params: SandboxInvocationParams): Invocation {
    return {
      command: params.command,
      args: params.args,
      cwd: params.cwd,
      env: params.env,
    };
  }

  private async buildSeatbelt(
    params: SandboxInvocationParams,
  ): Promise<Invocation> {
    const mode = this.effectiveMode;
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const profilePath = path.join(
      fs.realpathSync(os.tmpdir()),
      `nuwaclaw-sandbox-${uniqueSuffix}.sb`,
    );
    const profile = this.buildSeatbeltProfile(
      params.command,
      params.writablePaths,
      params.networkEnabled,
      params.startupExecAllowlist,
    );
    await fsp.writeFile(profilePath, profile, "utf-8");
    log.info("[SandboxInvoker] seatbelt profile written:", {
      profilePath,
      mode,
      command: params.command,
      startupExecAllowlistCount: params.startupExecAllowlist?.length ?? 0,
      networkEnabled: params.networkEnabled,
    });

    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-f", profilePath, params.command, ...params.args],
      cwd: params.cwd,
      env: params.env,
      seatbeltProfilePath: profilePath,
    };
  }

  private buildBwrap(params: SandboxInvocationParams): Invocation {
    const bwrapPath = this.options.linuxBwrapPath || "bwrap";
    const mode = this.effectiveMode;
    const permissive = mode === "permissive";
    const strict = mode === "strict";
    const bwrapArgs: string[] = ["--die-with-parent", "--new-session"];

    if (permissive) {
      // 宽松模式用于排障，不作为默认安全策略。
      bwrapArgs.push(
        "--bind",
        "/",
        "/",
        "--dev-bind",
        "/dev",
        "/dev",
        "--proc",
        "/proc",
      );
    } else {
      bwrapArgs.push(
        "--unshare-user-try",
        "--unshare-pid",
        "--unshare-uts",
        "--unshare-cgroup-try",
        ...(params.networkEnabled ? [] : ["--unshare-net"]),
        "--dev-bind",
        "/dev/null",
        "/dev/null",
        "--dev-bind",
        "/dev/urandom",
        "/dev/urandom",
        "--dev-bind",
        "/dev/zero",
        "/dev/zero",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
      );

      if (strict) {
        const roBindTargets = new Set<string>();
        const addRoBind = (p: string) => {
          if (!p || !path.isAbsolute(p) || !fs.existsSync(p)) return;
          roBindTargets.add(p);
          try {
            const resolved = fs.realpathSync(p);
            if (resolved !== p && fs.existsSync(resolved)) {
              roBindTargets.add(resolved);
            }
          } catch {
            // ignore realpath failures
          }
        };

        // Minimal system runtime surface
        for (const p of [
          "/usr",
          "/bin",
          "/sbin",
          "/lib",
          "/lib64",
          "/etc",
          "/opt",
          "/usr/local",
        ]) {
          addRoBind(p);
        }
        // Ensure launched binaries/scripts are visible inside strict bwrap
        addRoBind(path.dirname(params.command));
        for (const arg of params.args) {
          if (!path.isAbsolute(arg)) continue;
          addRoBind(
            fs.existsSync(arg) && fs.statSync(arg).isDirectory()
              ? arg
              : path.dirname(arg),
          );
        }

        for (const p of roBindTargets) {
          bwrapArgs.push("--ro-bind", p, p);
        }
      } else {
        bwrapArgs.push("--ro-bind", "/", "/");
      }

      for (const wp of params.writablePaths) {
        bwrapArgs.push("--bind", wp, wp);
      }
    }

    bwrapArgs.push("--chdir", params.cwd, "--", params.command, ...params.args);

    log.info("[SandboxInvoker] bwrap invocation:", {
      bwrapPath,
      mode,
      permissive,
      networkEnabled: params.networkEnabled,
      cwd: params.cwd,
      writablePathCount: params.writablePaths.length,
    });

    return {
      command: bwrapPath,
      args: bwrapArgs,
      cwd: params.cwd,
      env: params.env,
    };
  }

  private buildWindowsHelper(params: SandboxInvocationParams): Invocation {
    const helper = this.options.windowsSandboxHelperPath;
    if (!helper || !fs.existsSync(helper)) {
      throw new SandboxError(
        "Sandbox helper 未找到",
        SandboxErrorCode.SANDBOX_UNAVAILABLE,
      );
    }

    const sandboxMode = this.effectiveMode;
    const winMode = this.options.windowsSandboxMode ?? "workspace-write";
    const subcommand = params.subcommand ?? "run";

    const sandboxPolicy: Record<string, unknown> = {
      type: winMode === "read-only" ? "read-only" : "workspace-write",
      network_access: params.networkEnabled,
    };

    // Apply mode-dependent writable_roots for workspace-write mode.
    if (winMode === "workspace-write" && params.writablePaths.length > 0) {
      if (sandboxMode === "strict") {
        // Strict: only the project workspace root is writable.
        // Additional paths (e.g. cwd) are excluded to minimise write surface.
        // Safe: guarded by `params.writablePaths.length > 0` above.
        sandboxPolicy.writable_roots = [params.writablePaths[0]!];
      } else {
        sandboxPolicy.writable_roots = params.writablePaths;
      }
    }

    const helperArgs = [
      subcommand,
      "--mode",
      winMode,
      "--cwd",
      params.cwd,
      "--policy-json",
      JSON.stringify(sandboxPolicy),
    ];

    // Permissive mode: relax token-level write restrictions so child
    // processes (e.g. Git Bash) can create pipes and modify DACLs.
    // Only valid for the "run" subcommand — "serve" hardcodes
    // write_restricted=false in the Rust helper.
    if (sandboxMode === "permissive" && subcommand === "run") {
      helperArgs.push("--no-write-restricted");
    }

    helperArgs.push("--", params.command, ...params.args);

    log.info("[SandboxInvoker] windows-sandbox invocation:", {
      helper,
      subcommand,
      sandboxMode,
      winMode,
      cwd: params.cwd,
      policy: sandboxPolicy,
    });

    return {
      command: helper,
      args: helperArgs,
      cwd: params.cwd,
      env: params.env,
      parseJson: subcommand === "run",
    };
  }

  // ============================================================================
  // macOS Seatbelt Profile 构建
  // ============================================================================

  /**
   * 构建 macOS Seatbelt 沙箱 profile
   *
   * 注意：macOS 上 /var 是 /private/var 的符号链接，
   * seatbelt 使用真实路径匹配，因此需要对可写路径做 realpath 解析。
   */
  private buildSeatbeltProfile(
    command: string,
    writablePaths: string[],
    networkEnabled: boolean,
    startupExecAllowlist: string[] = [],
  ): string {
    const mode = this.effectiveMode;
    const permissive = mode === "permissive";
    const compat = mode === "compat";
    const lines: string[] = ["(version 1)", "(deny default)"];
    if (networkEnabled) {
      lines.push("(allow network*)");
    }
    lines.push("(allow file-read*)");

    if (permissive) {
      lines.push(
        "(allow file-write*)",
        "(allow process-exec)",
        "(allow signal)",
      );
      log.warn("[SandboxInvoker] seatbelt permissive mode enabled", {
        command,
        startupExecAllowlistCount: startupExecAllowlist.length,
      });
    } else {
      lines.push(
        '(allow process-exec (regex #"^/usr/bin/"))',
        '(allow process-exec (regex #"^/bin/"))',
        '(allow process-exec (regex #"^/usr/lib/"))',
      );
      const execAllow = new Set<string>([command]);
      if (compat) {
        for (const p of startupExecAllowlist) execAllow.add(p);
      }
      for (const p of execAllow) {
        if (!p || !path.isAbsolute(p)) continue;
        const addPath = (candidate: string) => {
          lines.push(`(allow process-exec (literal "${candidate}"))`);
        };
        addPath(p);
        try {
          const resolved = fs.realpathSync(p);
          if (resolved !== p) addPath(resolved);
        } catch {
          // ignore realpath failures for non-existing startup path
        }
      }
      log.info("[SandboxInvoker] seatbelt exec allowlist resolved", {
        mode,
        command,
        execAllowCount: execAllow.size,
        includeStartupChain: compat,
      });
      lines.push("(allow signal (target self))");
    }

    lines.push(
      "(allow process-fork)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
      "(allow ipc-posix*)",
      "(allow file-lock)",
    );
    // 可写路径 — 同时添加原始路径和 realpath（处理 macOS 符号链接）
    if (!permissive) {
      const seen = new Set<string>();
      for (const wp of writablePaths) {
        const pathsToAdd = [wp];
        try {
          const resolved = fs.realpathSync(wp);
          if (resolved !== wp) {
            pathsToAdd.push(resolved);
          }
        } catch {
          // 路径尚不存在，跳过 realpath
        }
        for (const p of pathsToAdd) {
          if (!seen.has(p)) {
            seen.add(p);
            lines.push(`(allow file-write* (subpath "${p}"))`);
          }
        }
      }
    }
    // 必要的系统写入
    lines.push(
      '(allow file-write* (literal "/dev/null"))',
      '(allow file-write* (literal "/dev/dtracehelper"))',
      '(allow file-write* (literal "/dev/urandom"))',
    );
    return lines.join("\n") + "\n";
  }
}

export default SandboxInvoker;
