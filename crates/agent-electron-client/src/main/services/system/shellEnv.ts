/**
 * Shell Environment Manager - 跨平台 Shell 环境管理
 *
 * 功能:
 * - 检测可用 shell
 * - 工具路径管理
 * - PATH 配置
 * - Windows/macOS/Linux 兼容
 */

import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import log from "electron-log";
import {
  createPlatformAdapter,
  getCurrentPlatform,
  type Platform,
} from "./platformAdapter";

// ==================== Types ====================
export type { Platform } from "./platformAdapter";

export interface ShellInfo {
  name: string;
  path: string;
  version?: string;
  isAvailable: boolean;
}

export interface ToolInfo {
  name: string;
  path?: string;
  version?: string;
  isAvailable: boolean;
}

export interface ShellEnvironment {
  platform: Platform;
  shell: ShellInfo;
  tools: Map<string, ToolInfo>;
  path: string[];
  homeDir: string;
}

// ==================== Platform Detection ====================

/**
 * 获取当前平台
 */
export function getPlatform(): Platform {
  return getCurrentPlatform();
}

/**
 * 检测是否为 Windows
 */
export function isWindows(): boolean {
  return createPlatformAdapter().isWindows;
}

/**
 * 检测是否为 macOS
 */
export function isMacOS(): boolean {
  return createPlatformAdapter().isMacOS;
}

/**
 * 检测是否为 Linux
 */
export function isLinux(): boolean {
  return createPlatformAdapter().isLinux;
}

// ==================== Shell Detection ====================

/**
 * 检测可用的 shell
 */
export async function detectShell(): Promise<ShellInfo> {
  const platform = getPlatform();
  const adapter = createPlatformAdapter(platform);

  const shellCandidates: Array<{
    name: string;
    path: string;
    args?: string[];
  }> = [];

  if (adapter.isMacOS) {
    // macOS: zsh (默认), bash
    shellCandidates.push(
      { name: "zsh", path: "/bin/zsh", args: ["--version"] },
      { name: "bash", path: "/bin/bash", args: ["--version"] },
    );
  } else if (adapter.isLinux) {
    // Linux: bash
    shellCandidates.push(
      { name: "bash", path: "/bin/bash", args: ["--version"] },
      { name: "sh", path: "/bin/sh" },
    );
  } else if (adapter.isWindows) {
    // Windows: PowerShell, cmd, Git Bash
    shellCandidates.push(
      {
        name: "powershell",
        path: "powershell.exe",
        args: ["-Command", "$PSVersionTable.PSVersion.ToString()"],
      },
      { name: "cmd", path: "cmd.exe", args: ["/c", "ver"] },
    );

    // 检查 Git Bash
    const gitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (fs.existsSync(gitBashPath)) {
      shellCandidates.push({
        name: "bash",
        path: gitBashPath,
        args: ["--version"],
      });
    }

    // 检查 WSL
    try {
      const wslResult = await checkCommand("wsl.exe");
      if (wslResult) {
        shellCandidates.push({ name: "wsl", path: "wsl.exe" });
      }
    } catch {}
  }

  // 尝试找到可用的 shell
  for (const shell of shellCandidates) {
    try {
      const version = await getCommandVersion(shell.path, shell.args);
      return {
        name: shell.name,
        path: shell.path,
        version: version ?? undefined,
        isAvailable: true,
      };
    } catch {
      continue;
    }
  }

  // 返回默认
  return {
    name: adapter.isWindows ? "powershell" : "bash",
    path: "",
    isAvailable: false,
  };
}

/**
 * 检测命令是否存在
 */
export async function checkCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const adapter = createPlatformAdapter();
    const { command: checkCmd, args } = adapter.getCommandProbe(cmd);

    const proc = spawn(checkCmd, args, {
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => resolve(false));
  });
}

/**
 * 获取命令版本
 */
export async function getCommandVersion(
  cmd: string,
  args?: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args || ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", () => {
      const match = stdout.match(/(\d+\.\d+\.\d+[\d.]*)/);
      resolve(match ? match[1] : stdout.trim() || null);
    });

    proc.on("error", () => resolve(null));
  });
}

// ==================== Essential Tools ====================

/**
 * 必需的工具列表
 */
export const ESSENTIAL_TOOLS = [
  // 文件操作
  "ls",
  "cd",
  "pwd",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "cat",
  "echo",
  // 文本处理
  "grep",
  "sed",
  "awk",
  "sort",
  "uniq",
  "head",
  "tail",
  "wc",
  // 进程/网络
  "ps",
  "kill",
  "find",
  "xargs",
  "curl",
  "wget",
  // Git (可选)
  "git",
  // Node.js
  "node",
  "npm",
  "npx",
];

const ESSENTIAL_TOOLS_WINDOWS = [
  "dir",
  "cd",
  "type",
  "echo",
  "mkdir",
  "del",
  "copy",
  "move",
  "findstr", // Windows grep
  "where",
];

/**
 * 检测必需工具
 */
export async function detectTools(): Promise<Map<string, ToolInfo>> {
  const adapter = createPlatformAdapter();
  const tools = new Map<string, ToolInfo>();
  const toolsToCheck = adapter.isWindows
    ? ESSENTIAL_TOOLS_WINDOWS
    : ESSENTIAL_TOOLS;

  for (const tool of toolsToCheck) {
    const isAvailable = await checkCommand(tool);

    let version: string | undefined;
    if (isAvailable) {
      version = (await getCommandVersion(tool)) || undefined;
    }

    tools.set(tool, {
      name: tool,
      isAvailable,
      version,
    });
  }

  return tools;
}

// ==================== PATH Management ====================

/**
 * 获取系统 PATH
 */
export function getSystemPath(): string[] {
  const adapter = createPlatformAdapter();
  const pathEnv = process.env.PATH || "";
  return pathEnv.split(adapter.pathDelimiter).filter(Boolean);
}

/**
 * 获取用户 Home 目录
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

/**
 * 获取默认工作目录
 */
export function getDefaultWorkspace(): string {
  const home = getHomeDir();
  return path.join(home, "NuwaxAgent", "workspace");
}

// ==================== Environment Builder ====================

/**
 * 构建 Agent 运行环境
 */
export async function buildAgentEnvironment(options?: {
  workspaceDir?: string;
  includeTools?: boolean;
}): Promise<{
  env: Record<string, string>;
  shell: ShellInfo;
  workspace: string;
}> {
  const platform = getPlatform();
  const adapter = createPlatformAdapter(platform);
  const home = getHomeDir();
  const workspace = options?.workspaceDir || getDefaultWorkspace();

  // 确保工作目录存在
  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }

  // 检测 shell
  const shell = await detectShell();

  // 构建环境变量
  const env: Record<string, string> = {
    ...process.env,

    // Home 目录
    HOME: home,

    // 工作目录
    WORKSPACE: workspace,
    PWD: workspace,

    // 语言环境
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
  };

  // 平台特定配置
  if (adapter.isMacOS) {
    // macOS
    env.SHELL = "/bin/zsh";
    env.EDITOR = "vim";
    env.VISUAL = "vim";
  } else if (adapter.isLinux) {
    // Linux
    env.SHELL = "/bin/bash";
    env.EDITOR = "vim";
    env.VISUAL = "vim";
  } else if (adapter.isWindows) {
    // Windows
    env.SHELL = "powershell.exe";
    env.EDITOR = "notepad";
  }

  // 可选: 检测并添加工具路径
  if (options?.includeTools) {
    const tools = await detectTools();

    // 添加找到的工具路径
    const toolPaths: string[] = [];
    for (const [name, info] of tools) {
      if (info.isAvailable && info.path) {
        const dir = path.dirname(info.path);
        if (!toolPaths.includes(dir)) {
          toolPaths.push(dir);
        }
      }
    }

    // 添加到 PATH 前面
    if (toolPaths.length > 0) {
      const currentPath = env.PATH || "";
      env.PATH =
        toolPaths.join(adapter.pathDelimiter) +
        adapter.pathDelimiter +
        currentPath;
    }
  }

  log.info(
    `[Shell] Agent environment: platform=${platform}, shell=${shell.name}, workspace=${workspace}`,
  );

  return { env, shell, workspace };
}

/**
 * 检查环境就绪状态
 */
export async function checkEnvironmentReady(): Promise<{
  ready: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  const adapter = createPlatformAdapter();

  // 检查 shell
  const shell = await detectShell();
  if (!shell.isAvailable) {
    issues.push(`Shell not found`);
  }

  // 检查核心工具
  const criticalTools = adapter.isWindows
    ? ["where", "dir", "type"]
    : ["ls", "cat", "grep"];

  for (const tool of criticalTools) {
    const isAvailable = await checkCommand(tool);
    if (!isAvailable) {
      issues.push(`Missing tool: ${tool}`);
    }
  }

  // 检查工作目录
  const workspace = getDefaultWorkspace();
  if (!fs.existsSync(workspace)) {
    try {
      fs.mkdirSync(workspace, { recursive: true });
    } catch (error) {
      issues.push(`Cannot create workspace: ${error}`);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}

export default {
  // Platform
  getPlatform,
  isWindows,
  isMacOS,
  isLinux,

  // Shell
  detectShell,
  checkCommand,
  getCommandVersion,

  // Tools
  detectTools,
  ESSENTIAL_TOOLS,

  // PATH
  getSystemPath,
  getHomeDir,
  getDefaultWorkspace,

  // Environment
  buildAgentEnvironment,
  checkEnvironmentReady,
};
