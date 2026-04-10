/**
 * ACP 引擎进程级沙箱桥接模块
 *
 * 提供 buildSandboxedSpawnArgs() 将 ACP 引擎的 spawn 参数
 * 包装为沙箱化的调用参数，供 acpClient.ts 使用。
 *
 * 内部直接使用 SandboxInvoker 构建调用，不再创建临时 CommandSandbox 实例。
 *
 * @version 2.0.0
 * @updated 2026-04-03
 */

import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { SandboxInvoker } from "./SandboxInvoker";
import type { Invocation } from "./SandboxInvoker";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

const NOOP_CLEANUP = () => {};

export interface SandboxedSpawn {
  /** 包装后的命令（可能是 sandbox-exec / bwrap / nuwax sandbox helper） */
  command: string;
  /** 包装后的参数 */
  args: string[];
  /** 清理沙箱临时资源（如 .sb profile 文件） */
  cleanupSandbox: () => void;
}

/**
 * 为 ACP 引擎进程构建沙箱化的 spawn 参数
 *
 * @param originalCommand 原始二进制路径（或 process.execPath）
 * @param originalArgs 原始参数
 * @param cwd 工作目录
 * @param sandboxConfig 沙箱配置（undefined 表示不启用）
 * @param extraWritablePaths 运行时创建的额外可写路径（如 isolatedHome）
 * @returns 沙箱化的 spawn 参数 + 清理函数
 */
export async function buildSandboxedSpawnArgs(
  originalCommand: string,
  originalArgs: string[],
  cwd: string,
  sandboxConfig: SandboxProcessConfig | undefined,
  extraWritablePaths: string[] = [],
): Promise<SandboxedSpawn> {
  // 未配置沙箱或已禁用，直接返回原始参数
  if (!sandboxConfig?.enabled) {
    return {
      command: originalCommand,
      args: originalArgs,
      cleanupSandbox: NOOP_CLEANUP,
    };
  }

  const { type, projectWorkspaceDir, networkEnabled } = sandboxConfig;

  // Docker 后端暂不支持进程级包装
  if (type === "docker") {
    log.warn(
      "[SandboxProcessWrapper] Docker process-level sandbox not supported yet, skipping wrapping",
    );
    return {
      command: originalCommand,
      args: originalArgs,
      cleanupSandbox: NOOP_CLEANUP,
    };
  }

  // 直接使用 SandboxInvoker 构建调用
  // Windows: serve 子命令根据 sandbox mode 决定是否启用 WRITE_RESTRICTED
  // APPDATA/LOCALAPPDATA 由 Rust helper 的 compute_allow_paths() 根据模式决定
  const invoker = new SandboxInvoker(type, {
    linuxBwrapPath: sandboxConfig.linuxBwrapPath,
    windowsSandboxHelperPath: sandboxConfig.windowsSandboxHelperPath,
    windowsSandboxMode: sandboxConfig.windowsSandboxMode,
    networkEnabled,
    mode: sandboxConfig.mode,
  });

  // 可写路径：工作区 + 额外路径（如 isolatedHome）
  const writablePaths = [projectWorkspaceDir, ...extraWritablePaths].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );

  // 确保可写路径存在（bwrap --bind 要求路径存在）
  for (const wp of writablePaths) {
    if (!fs.existsSync(wp)) {
      fs.mkdirSync(wp, { recursive: true });
    }
  }

  try {
    const invocation: Invocation = await invoker.buildInvocation({
      command: originalCommand,
      args: originalArgs,
      cwd,
      writablePaths,
      networkEnabled,
      subcommand: "serve",
      startupExecAllowlist: [originalCommand],
    });

    log.info("[SandboxProcessWrapper] Sandbox wrapping succeeded:", {
      type,
      mode: sandboxConfig.mode ?? "compat",
      autoFallback: sandboxConfig.autoFallback ?? "startup-only",
      originalCommand,
      wrappedCommand: invocation.command,
      writablePaths,
    });

    // 为 macOS seatbelt profile 文件注册清理
    const profilePath = invocation.seatbeltProfilePath ?? null;

    const cleanupSandbox = () => {
      if (profilePath) {
        try {
          fs.unlinkSync(profilePath);
          log.debug(
            "[SandboxProcessWrapper] 已清理 seatbelt profile:",
            profilePath,
          );
        } catch {
          // 忽略清理错误
        }
      }
    };

    return {
      command: invocation.command,
      args: invocation.args,
      cleanupSandbox,
    };
  } catch (error) {
    log.error("[SandboxProcessWrapper] Sandbox wrapping failed:", error);
    throw error;
  }
}
