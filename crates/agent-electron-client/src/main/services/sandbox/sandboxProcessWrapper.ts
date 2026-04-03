/**
 * ACP 引擎进程级沙箱桥接模块
 *
 * 提供 buildSandboxedSpawnArgs() 将 ACP 引擎的 spawn 参数
 * 包装为沙箱化的调用参数，供 acpClient.ts 使用。
 *
 * @version 1.0.0
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { CommandSandbox } from "./CommandSandbox";
import type { Invocation } from "./CommandSandbox";
import type {
  SandboxConfig,
  SandboxProcessConfig,
  Platform,
} from "@shared/types/sandbox";

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
      "[SandboxProcessWrapper] Docker 进程级沙箱暂不支持（Phase 2），跳过包装",
    );
    return {
      command: originalCommand,
      args: originalArgs,
      cleanupSandbox: NOOP_CLEANUP,
    };
  }

  // 创建临时 CommandSandbox 实例用于构建调用
  const tempConfig: SandboxConfig = {
    type,
    platform: os.platform() as Platform,
    enabled: true,
    workspaceRoot: path.join(os.homedir(), ".nuwaclaw", "sandboxes"),
    networkEnabled,
  };

  const options = {
    linuxBwrapPath: sandboxConfig.linuxBwrapPath,
    windowsSandboxHelperPath: sandboxConfig.windowsSandboxHelperPath,
    windowsSandboxMode: sandboxConfig.windowsSandboxMode,
  };

  const sandbox = new CommandSandbox(tempConfig, options);

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
    const invocation: Invocation = await sandbox.buildProcessInvocation(
      originalCommand,
      originalArgs,
      cwd,
      {
        writablePaths,
        networkEnabled,
      },
    );

    log.info("[SandboxProcessWrapper] 沙箱包装成功:", {
      type,
      originalCommand,
      wrappedCommand: invocation.command,
      writablePaths,
    });

    // 为 macOS seatbelt profile 文件注册清理
    let profilePath: string | null = null;
    if (
      type === "macos-seatbelt" &&
      invocation.command === "/usr/bin/sandbox-exec" &&
      invocation.args[0] === "-f"
    ) {
      profilePath = invocation.args[1];
    }

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
    log.error("[SandboxProcessWrapper] 沙箱包装失败:", error);
    throw error;
  }
}
