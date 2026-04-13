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
import { createPlatformAdapter } from "../system/platformAdapter";
import type {
  SandboxMode,
  SandboxType,
  WindowsSandboxMode,
} from "@shared/types/sandbox";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";

// ============================================================================
// 类型
// ============================================================================

/**
 * Windows 网络隔离策略
 *
 * 定义 Windows 沙箱中网络访问控制的实现方式：
 *
 * - `env-stub`: 当前实现。通过清空环境变量（HTTP_PROXY 等）阻止依赖
 *   环境变量的 HTTP 客户端发起请求。属于 best-effort，原生 socket
 *   客户端可以绕过此限制。
 *
 * - `wfp-block`: 计划于 v1.1 实现。通过 Windows Filtering Platform (WFP)
 *   在内核级别阻断沙箱进程的出站/入站网络连接。由
 *   `nuwax-sandbox-helper.exe` 调用 WFP API，在创建受限进程前插入
 *   过滤规则，进程退出后自动移除。此方式可实现与 macOS seatbelt
 *   `(deny network*)` / Linux bwrap `--unshare-net` 同等的隔离强度。
 *
 * @see https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page
 */
export type WindowsNetworkPolicy = "env-stub" | "wfp-block";

/** 沙箱调用器配置 */
export interface SandboxInvokerOptions {
  /** Linux bwrap 二进制路径（可选，默认 PATH 查找） */
  linuxBwrapPath?: string;
  /** Windows sandbox helper 路径 */
  windowsSandboxHelperPath?: string;
  /** Windows sandbox 模式 */
  windowsSandboxMode?: WindowsSandboxMode;
  /**
   * Windows 网络隔离策略（可选，默认 `env-stub`）。
   * 当前仅 `env-stub` 已实现；`wfp-block` 为 v1.1 预留，传入时暂回退到 `env-stub`。
   */
  windowsNetworkPolicy?: WindowsNetworkPolicy;
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
    const platformAdapter = createPlatformAdapter();

    switch (this.type) {
      case "none":
        return true;

      case "macos-seatbelt":
        return (
          platformAdapter.isMacOS && fs.existsSync("/usr/bin/sandbox-exec")
        );

      case "linux-bwrap": {
        if (!platformAdapter.isLinux) return false;
        if (
          this.options.linuxBwrapPath &&
          fs.existsSync(this.options.linuxBwrapPath)
        ) {
          return true;
        }
        return checkCommand("bwrap");
      }

      case "windows-sandbox": {
        if (!platformAdapter.isWindows) return false;
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

  /**
   * 构建 Windows Sandbox helper 调用
   *
   * **网络隔离限制 (Network Isolation Limitation)**:
   *
   * 当前 Windows 沙箱的网络隔离仅通过环境变量置空（env-stub）实现，
   * 即移除 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 等环境变量来
   * 阻止依赖环境变量的 HTTP 客户端发起网络请求。
   *
   * 此方式属于 best-effort（尽力而为），存在以下局限：
   * - 原生 socket 客户端（如直接调用 Winsock API 的程序）可以绕过
   * - 不依赖环境变量的 HTTP 库（如硬编码代理的客户端）不受影响
   * - 无法阻止 DNS 解析和 ICMP 流量
   *
   * 与 macOS seatbelt (`(deny network*)`) 和 Linux bwrap (`--unshare-net`)
   * 的内核级网络隔离不同，Windows 端目前无法在进程级别实现完全的网络隔离。
   *
   * **未来计划**：v1.1 版本将集成 WFP (Windows Filtering Platform) 实现
   * 内核级网络过滤，通过 `nuwax-sandbox-helper.exe` 调用 WFP API 来
   * 阻断沙箱进程的出站/入站连接。届时 `WindowsNetworkPolicy` 类型
   * 将新增 `wfp-block` 选项。
   *
   * @see https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page
   */
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
      // 网络隔离：当前仅为 env-stub 级别（best-effort），非内核级隔离
      // 见本方法的 JSDoc 了解限制详情；v1.1 将通过 WFP 实现真正的网络隔离
      network_access: params.networkEnabled,
      sandbox_mode: sandboxMode, // strict/compat/permissive — Rust helper uses this for APPDATA allowance
    };

    // Writable roots:
    // - strict: only keep the first root (workspace-first contract)
    // - compat/permissive: keep full writable roots list
    if (winMode === "workspace-write" && params.writablePaths.length > 0) {
      sandboxPolicy.writable_roots =
        sandboxMode === "strict"
          ? [params.writablePaths[0]]
          : params.writablePaths;
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
    // Only valid for the "run" subcommand.
    if (sandboxMode === "permissive" && subcommand === "run") {
      helperArgs.push("--no-write-restricted");
    }

    // Serve mode: never enable WRITE_RESTRICTED.
    // WRITE_RESTRICTED adds restricting SIDs (logon, everyone, capability) to the
    // token, which blocks the restricted process from spawning child processes.
    // In serve mode the ACP engine (claude-code-acp-ts / nuwaxcode) MUST spawn
    // MCP server sub-processes during session/new — restricting SIDs causes
    // EPERM on every child spawn, making the session unusable.
    //
    // Filesystem write protection in serve mode is enforced by:
    // 1. DACL ACEs (ALLOW paths applied by the sandbox helper)
    // 2. sandboxed-bash MCP + sandboxed-fs MCP (tool-level interception)
    // 3. evaluateStrictWritePermission proactive guard (nuwaxcode)
    const serveWriteRestricted = false;
    if (subcommand === "serve") {
      log.info(
        "[SandboxInvoker] WRITE_RESTRICTED disabled for serve mode (spawn EPERM prevention)",
      );
    }

    helperArgs.push("--", params.command, ...params.args);

    log.info("[SandboxInvoker] windows-sandbox invocation:", {
      helper,
      subcommand,
      sandboxMode,
      winMode,
      serveWriteRestricted,
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
      // strict mode keeps a minimal exec surface and does not include
      // startup chain allowlist entries.
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
    // 对每个可写路径，同时允许 process-exec（引擎内部二进制如 rg 需要执行）
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
            lines.push(`(allow process-exec (subpath "${p}"))`);
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
