/**
 * 命令沙箱实现（非 Docker）
 *
 * 支持：
 * - none（直接执行）
 * - macos-seatbelt（sandbox-exec）
 * - linux-bwrap（bubblewrap）
 * - windows-codex（Codex helper）
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import log from "electron-log";
import { SandboxManager } from "./SandboxManager";
import { checkCommand } from "../system/shellEnv";
import type {
  CleanupResult,
  ExecuteOptions,
  ExecuteResult,
  FileInfo,
  SandboxConfig,
  WindowsCodexMode,
  Workspace,
} from "@shared/types/sandbox";
import {
  FileOperationError,
  SandboxError,
  SandboxErrorCode,
  WorkspaceError,
  toSandboxError,
} from "@shared/errors/sandbox";

interface CommandSandboxOptions {
  linuxBwrapPath?: string;
  windowsCodexHelperPath?: string;
  windowsCodexMode?: WindowsCodexMode;
  windowsCodexPrivateDesktop?: boolean;
}

interface Invocation {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/**
 * 三端命令沙箱（不依赖容器）
 */
export class CommandSandbox extends SandboxManager {
  private readonly options: CommandSandboxOptions;
  private backendAvailable: boolean = false;

  constructor(config: SandboxConfig, options: CommandSandboxOptions = {}) {
    super(config);
    this.options = options;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.config.workspaceRoot, { recursive: true });
    log.debug("[CommandSandbox] config:", {
      type: this.config.type,
      platform: this.config.platform,
      enabled: this.config.enabled,
      workspaceRoot: this.config.workspaceRoot,
      memoryLimit: this.config.memoryLimit,
      cpuLimit: this.config.cpuLimit,
      networkEnabled: this.config.networkEnabled,
      options: {
        linuxBwrapPath: this.options.linuxBwrapPath,
        windowsCodexHelperPath: this.options.windowsCodexHelperPath,
        windowsCodexMode: this.options.windowsCodexMode,
        windowsCodexPrivateDesktop: this.options.windowsCodexPrivateDesktop,
      },
    });
    this.backendAvailable = await this.checkBackendAvailable();
    if (!this.backendAvailable) {
      throw new SandboxError(
        `沙箱后端不可用: ${this.config.type}`,
        SandboxErrorCode.SANDBOX_UNAVAILABLE,
      );
    }
    this.initialized = true;
    log.info("[CommandSandbox] initialized:", this.config.type);
  }

  async isAvailable(): Promise<boolean> {
    this.backendAvailable = await this.checkBackendAvailable();
    return this.backendAvailable;
  }

  async createWorkspace(sessionId: string): Promise<Workspace> {
    if (this.workspaces.has(sessionId)) {
      throw new WorkspaceError(
        `工作区已存在: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_EXISTS,
        { sessionId },
      );
    }

    const workspaceId = this.generateWorkspaceId(sessionId);
    const workspaceRoot = path.join(this.config.workspaceRoot, workspaceId);

    try {
      await this.createWorkspaceDirectories(workspaceRoot);

      const workspace: Workspace = {
        id: workspaceId,
        sessionId,
        rootPath: workspaceRoot,
        projectsPath: path.join(workspaceRoot, "projects"),
        nodeModulesPath: path.join(workspaceRoot, "node_modules"),
        pythonEnvPath: path.join(workspaceRoot, "python-env"),
        binPath: path.join(workspaceRoot, "bin"),
        cachePath: path.join(workspaceRoot, "cache"),
        sandboxConfig: this.config,
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        retentionPolicy: this.createDefaultRetentionPolicy(),
        status: "active",
      };

      this.workspaces.set(sessionId, workspace);
      this.emitEvent("workspace:created", { workspace });
      return workspace;
    } catch (error) {
      await this.cleanupWorkspaceDirectory(workspaceRoot);
      throw toSandboxError(
        error,
        "工作区创建失败",
        SandboxErrorCode.WORKSPACE_CREATE_FAILED,
        { sessionId },
      );
    }
  }

  async destroyWorkspace(sessionId: string): Promise<void> {
    const workspace = this.validateWorkspaceExists(sessionId);
    workspace.status = "destroying";

    try {
      if (workspace.retentionPolicy.mode !== "always") {
        await this.cleanupWorkspaceDirectory(workspace.rootPath);
      }
      workspace.status = "destroyed";
      this.workspaces.delete(sessionId);
      this.emitEvent("workspace:destroyed", {
        workspaceId: workspace.id,
        sessionId,
      });
    } catch (error) {
      workspace.status = "error";
      throw toSandboxError(
        error,
        "工作区销毁失败",
        SandboxErrorCode.WORKSPACE_DESTROY_FAILED,
        { sessionId, workspaceId: workspace.id },
      );
    }
  }

  async execute(
    sessionId: string,
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const workspace = this.validateWorkspaceExists(sessionId);
    const startTime = Date.now();
    const timeout = options.timeout ?? 300000;
    const cwd = this.resolveExecutionCwd(workspace, options.cwd);

    log.info("[CommandSandbox] execute:", {
      type: this.config.type,
      sessionId,
      command,
      args,
      cwd,
    });
    this.emitEvent("execute:start", { sessionId, command, args });

    try {
      const invocation = await this.buildInvocation(
        workspace,
        cwd,
        command,
        args,
        options,
      );
      const run = await this.runInvocation(invocation, timeout);

      const result: ExecuteResult = {
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        duration: Date.now() - startTime,
        command,
        args,
      };

      this.updateLastAccessed(sessionId);
      this.emitEvent("execute:complete", { sessionId, result });
      return result;
    } catch (error) {
      this.emitEvent("execute:error", {
        sessionId,
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      throw toSandboxError(
        error,
        "命令执行失败",
        SandboxErrorCode.EXECUTION_FAILED,
        {
          sessionId,
        },
      );
    }
  }

  async readFile(sessionId: string, filePath: string): Promise<string> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);

    try {
      const content = await fsp.readFile(filePath, "utf-8");
      this.updateLastAccessed(sessionId);
      return content;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileOperationError(
          `文件未找到: ${filePath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          { sessionId, cause: error as Error },
        );
      }
      throw new FileOperationError(
        `文件读取失败: ${filePath}`,
        SandboxErrorCode.FILE_READ_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async writeFile(
    sessionId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);

    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content, "utf-8");
      this.updateLastAccessed(sessionId);
    } catch (error) {
      throw new FileOperationError(
        `文件写入失败: ${filePath}`,
        SandboxErrorCode.FILE_WRITE_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async readDir(sessionId: string, dirPath: string): Promise<FileInfo[]> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, dirPath);

    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const infos = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          const st = await fsp.stat(fullPath);
          const item: FileInfo = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: st.size,
            modifiedAt: st.mtime,
          };
          return item;
        }),
      );
      this.updateLastAccessed(sessionId);
      return infos;
    } catch (error) {
      throw new FileOperationError(
        `目录读取失败: ${dirPath}`,
        SandboxErrorCode.DIRECTORY_OPERATION_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async deleteFile(sessionId: string, filePath: string): Promise<void> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);

    try {
      await fsp.rm(filePath, { recursive: true, force: true });
      this.updateLastAccessed(sessionId);
    } catch (error) {
      throw new FileOperationError(
        `文件删除失败: ${filePath}`,
        SandboxErrorCode.FILE_DELETE_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async cleanup(): Promise<CleanupResult> {
    const result: CleanupResult = {
      deletedCount: 0,
      freedSpace: 0,
      errors: [],
    };

    for (const workspace of this.listWorkspaces()) {
      try {
        result.freedSpace += await this.getDirectorySize(workspace.rootPath);
        await this.destroyWorkspace(workspace.sessionId);
        result.deletedCount += 1;
      } catch (error) {
        result.errors.push(
          `cleanup failed (${workspace.sessionId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }

  private async checkBackendAvailable(): Promise<boolean> {
    const type = this.config.type;
    if (type === "none") {
      log.debug("[CommandSandbox] type=none, skipping backend check");
      return true;
    }

    if (type === "macos-seatbelt") {
      const result =
        process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
      log.debug("[CommandSandbox] macos-seatbelt check:", {
        platform: process.platform,
        exists: fs.existsSync("/usr/bin/sandbox-exec"),
        result,
      });
      return result;
    }

    if (type === "linux-bwrap") {
      if (process.platform !== "linux") {
        log.debug(
          "[CommandSandbox] linux-bwrap: not linux, platform=",
          process.platform,
        );
        return false;
      }
      if (
        this.options.linuxBwrapPath &&
        fs.existsSync(this.options.linuxBwrapPath)
      ) {
        log.debug(
          "[CommandSandbox] linux-bwrap: bundled path exists:",
          this.options.linuxBwrapPath,
        );
        return true;
      }
      const result = checkCommand("bwrap");
      log.debug("[CommandSandbox] linux-bwrap: bwrap in PATH:", result);
      return result;
    }

    if (type === "windows-codex") {
      if (process.platform !== "win32") {
        log.debug(
          "[CommandSandbox] windows-codex: not win32, platform=",
          process.platform,
        );
        return false;
      }
      const result =
        !!this.options.windowsCodexHelperPath &&
        fs.existsSync(this.options.windowsCodexHelperPath);
      log.debug("[CommandSandbox] windows-codex check:", {
        helperPath: this.options.windowsCodexHelperPath,
        exists: this.options.windowsCodexHelperPath
          ? fs.existsSync(this.options.windowsCodexHelperPath)
          : false,
        result,
      });
      return result;
    }

    log.debug("[CommandSandbox] unknown type:", type);
    return false;
  }

  private async buildInvocation(
    workspace: Workspace,
    cwd: string,
    command: string,
    args: string[],
    options: ExecuteOptions,
  ): Promise<Invocation> {
    const type = this.config.type;

    if (type === "none") {
      return {
        command,
        args,
        cwd,
        env: options.env,
      };
    }

    if (type === "macos-seatbelt") {
      const profile = await this.ensureSeatbeltProfile(workspace);
      return {
        command: "/usr/bin/sandbox-exec",
        args: ["-f", profile, command, ...args],
        cwd,
        env: options.env,
      };
    }

    if (type === "linux-bwrap") {
      const bwrapPath = this.options.linuxBwrapPath || "bwrap";
      const bwrapArgs: string[] = [
        "--die-with-parent",
        "--new-session",
        "--unshare-user-try",
        "--unshare-pid",
        "--unshare-uts",
        "--unshare-cgroup-try",
        ...(this.config.networkEnabled === false ? ["--unshare-net"] : []),
        "--dev-bind",
        "/dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        workspace.rootPath,
        workspace.rootPath,
        "--chdir",
        cwd,
        "--",
        command,
        ...args,
      ];
      log.debug("[CommandSandbox] linux-bwrap invocation:", {
        bwrapPath,
        argsCount: bwrapArgs.length,
        networkEnabled: this.config.networkEnabled,
        workspaceRoot: workspace.rootPath,
        cwd,
      });
      return {
        command: bwrapPath,
        args: bwrapArgs,
        cwd,
        env: options.env,
      };
    }

    if (type === "windows-codex") {
      const helper = this.options.windowsCodexHelperPath;
      if (!helper || !fs.existsSync(helper)) {
        throw new SandboxError(
          "Codex helper 未找到",
          SandboxErrorCode.SANDBOX_UNAVAILABLE,
        );
      }

      const helperArgs = [
        "run",
        "--mode",
        this.options.windowsCodexMode ?? "unelevated",
        "--cwd",
        cwd,
        ...(this.options.windowsCodexPrivateDesktop
          ? ["--private-desktop"]
          : []),
        "--",
        command,
        ...args,
      ];

      log.debug("[CommandSandbox] windows-codex invocation:", {
        helper,
        mode: this.options.windowsCodexMode ?? "unelevated",
        privateDesktop: this.options.windowsCodexPrivateDesktop,
        cwd,
      });
      return {
        command: helper,
        args: helperArgs,
        cwd,
        env: options.env,
      };
    }

    throw new SandboxError(
      `不支持的沙箱类型: ${String(type)}`,
      SandboxErrorCode.CONFIG_INVALID,
    );
  }

  private resolveExecutionCwd(workspace: Workspace, cwd?: string): string {
    const base = workspace.projectsPath;
    const resolved = cwd
      ? path.isAbsolute(cwd)
        ? path.resolve(cwd)
        : path.resolve(base, cwd)
      : base;
    this.validatePathInWorkspace(workspace, resolved);
    return resolved;
  }

  private async runInvocation(
    invocation: Invocation,
    timeout: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }> {
    log.debug("[CommandSandbox] runInvocation:", {
      command: invocation.command,
      args: invocation.args,
      cwd: invocation.cwd,
      envKeys: invocation.env ? Object.keys(invocation.env) : [],
      timeout,
    });

    return new Promise((resolve, reject) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          ...(invocation.env ?? {}),
        },
        shell: false,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        log.debug("[CommandSandbox] runInvocation completed:", {
          exitCode: code,
          timedOut,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
          stderrPreview: stderr.slice(0, 200),
        });
        resolve({
          stdout,
          stderr,
          exitCode: code ?? (timedOut ? 137 : 1),
          timedOut,
        });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        log.debug("[CommandSandbox] runInvocation error:", error.message);
        reject(error);
      });
    });
  }

  private async createWorkspaceDirectories(
    workspaceRoot: string,
  ): Promise<void> {
    const dirs = [
      workspaceRoot,
      path.join(workspaceRoot, "projects"),
      path.join(workspaceRoot, "node_modules"),
      path.join(workspaceRoot, "python-env"),
      path.join(workspaceRoot, "bin"),
      path.join(workspaceRoot, "cache"),
    ];

    for (const dir of dirs) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  private async ensureSeatbeltProfile(workspace: Workspace): Promise<string> {
    const profilePath = path.join(workspace.rootPath, ".seatbelt.sb");
    if (!fs.existsSync(profilePath)) {
      const profile = "(version 1)\n(allow default)\n";
      await fsp.writeFile(profilePath, profile, "utf-8");
    }
    return profilePath;
  }

  private async cleanupWorkspaceDirectory(dirPath: string): Promise<void> {
    await fsp.rm(dirPath, { recursive: true, force: true });
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      let total = 0;
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await this.getDirectorySize(full);
        } else {
          const st = await fsp.stat(full);
          total += st.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}

export default CommandSandbox;
