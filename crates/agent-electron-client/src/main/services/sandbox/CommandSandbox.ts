/**
 * 命令沙箱实现（非 Docker）
 *
 * 支持：
 * - none（直接执行）
 * - macos-seatbelt（sandbox-exec）
 * - linux-bwrap（bubblewrap）
 * - windows-sandbox（Windows Sandbox helper）
 *
 * 调用构建委托给 SandboxInvoker，文件操作委托给 SandboxFileOperations。
 *
 * @version 2.0.0
 * @updated 2026-04-03
 */

import { spawn } from "child_process";
import * as fsp from "fs/promises";
import * as path from "path";
import log from "electron-log";
import { SandboxManager } from "./SandboxManager";
import { SandboxInvoker } from "./SandboxInvoker";
import { SandboxFileOperations } from "./SandboxFileOperations";
import type {
  CleanupResult,
  ExecuteOptions,
  ExecuteResult,
  FileInfo,
  SandboxConfig,
  Workspace,
} from "@shared/types/sandbox";
import {
  FileOperationError,
  SandboxError,
  SandboxErrorCode,
  WorkspaceError,
  toSandboxError,
} from "@shared/errors/sandbox";

// Re-export Invocation for backward compatibility
export type { Invocation } from "./SandboxInvoker";

/**
 * 三端命令沙箱（不依赖容器）
 */
export class CommandSandbox extends SandboxManager {
  private readonly invoker: SandboxInvoker;
  private backendAvailable: boolean = false;

  constructor(
    config: SandboxConfig,
    options: {
      linuxBwrapPath?: string;
      windowsSandboxHelperPath?: string;
      windowsSandboxMode?: "read-only" | "workspace-write";
    } = {},
  ) {
    super(config);
    this.invoker = new SandboxInvoker(config.type, {
      linuxBwrapPath: options.linuxBwrapPath,
      windowsSandboxHelperPath: options.windowsSandboxHelperPath,
      windowsSandboxMode: options.windowsSandboxMode,
      networkEnabled: config.networkEnabled,
      mode: config.mode,
    });
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.config.workspaceRoot, { recursive: true });
    log.debug("[CommandSandbox] config:", {
      type: this.config.type,
      platform: this.config.platform,
      enabled: this.config.enabled,
      workspaceRoot: this.config.workspaceRoot,
    });
    this.backendAvailable = await this.invoker.checkAvailable();
    if (!this.backendAvailable) {
      throw new SandboxError(
        `Sandbox backend unavailable: ${this.config.type}`,
        SandboxErrorCode.SANDBOX_UNAVAILABLE,
      );
    }
    this.initialized = true;
    log.info("[CommandSandbox] initialized:", this.config.type);
  }

  async isAvailable(): Promise<boolean> {
    this.backendAvailable = await this.invoker.checkAvailable();
    return this.backendAvailable;
  }

  async createWorkspace(sessionId: string): Promise<Workspace> {
    if (this.workspaces.has(sessionId)) {
      throw new WorkspaceError(
        `Workspace already exists: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_EXISTS,
        { sessionId },
      );
    }

    const workspaceId = this.generateWorkspaceId(sessionId);
    const workspaceRoot = path.join(this.config.workspaceRoot, workspaceId);

    try {
      await SandboxFileOperations.createWorkspaceDirectories(workspaceRoot);

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
      await SandboxFileOperations.cleanupWorkspaceDirectory(workspaceRoot);
      throw toSandboxError(
        error,
        "Failed to create workspace",
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
        await SandboxFileOperations.cleanupWorkspaceDirectory(
          workspace.rootPath,
        );
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
        "Failed to destroy workspace",
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
      const invocation = await this.invoker.buildInvocation({
        command,
        args,
        cwd,
        env: options.env,
        writablePaths: [workspace.rootPath],
        networkEnabled: this.config.networkEnabled !== false,
        subcommand: "run",
        startupExecAllowlist: [command],
      });
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
        "Command execution failed",
        SandboxErrorCode.EXECUTION_FAILED,
        { sessionId },
      );
    }
  }

  async readFile(sessionId: string, filePath: string): Promise<string> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);
    try {
      const content = await SandboxFileOperations.readFileContent(filePath);
      this.updateLastAccessed(sessionId);
      return content;
    } catch (error) {
      // SandboxFileOperations 已经抛出 FileOperationError，直接透传
      if (error instanceof FileOperationError) throw error;
      throw new FileOperationError(
        `File read failed: ${filePath}`,
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
      await SandboxFileOperations.writeFileContent(filePath, content);
      this.updateLastAccessed(sessionId);
    } catch (error) {
      throw new FileOperationError(
        `File write failed: ${filePath}`,
        SandboxErrorCode.FILE_WRITE_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async readDir(sessionId: string, dirPath: string): Promise<FileInfo[]> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, dirPath);
    try {
      const infos = await SandboxFileOperations.readDirectoryEntries(dirPath);
      this.updateLastAccessed(sessionId);
      return infos;
    } catch (error) {
      throw new FileOperationError(
        `Directory read failed: ${dirPath}`,
        SandboxErrorCode.DIRECTORY_OPERATION_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  async deleteFile(sessionId: string, filePath: string): Promise<void> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);
    try {
      await SandboxFileOperations.deletePath(filePath);
      this.updateLastAccessed(sessionId);
    } catch (error) {
      throw new FileOperationError(
        `File delete failed: ${filePath}`,
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
        result.freedSpace += await SandboxFileOperations.getDirectorySize(
          workspace.rootPath,
        );
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

  /**
   * 为长运行进程构建沙箱包装调用（不执行 spawn）
   *
   * 与 execute() 不同，此方法不依赖 Workspace 对象，
   * 而是接受显式的可写路径列表，适用于 ACP 引擎进程级沙箱化。
   *
   * @returns Invocation 对象，调用方自行 spawn
   */
  async buildProcessInvocation(
    command: string,
    args: string[],
    cwd: string,
    options: {
      env?: Record<string, string>;
      writablePaths: string[];
      networkEnabled: boolean;
    },
  ): Promise<import("./SandboxInvoker").Invocation> {
    return this.invoker.buildInvocation({
      command,
      args,
      cwd,
      env: options.env,
      writablePaths: options.writablePaths,
      networkEnabled: options.networkEnabled,
      subcommand: "serve",
    });
  }

  /**
   * 执行沙箱包装后的命令（通用 spawn+capture）
   */
  private async runInvocation(
    invocation: import("./SandboxInvoker").Invocation,
    timeout: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }> {
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

        // Windows Sandbox helper returns JSON: { exit_code, stdout, stderr, timed_out }
        if (invocation.parseJson) {
          try {
            const parsed = JSON.parse(stdout) as {
              exit_code: number;
              stdout: string;
              stderr: string;
              timed_out: boolean;
            };
            resolve({
              stdout: parsed.stdout,
              stderr: parsed.stderr,
              exitCode: parsed.exit_code,
              timedOut: parsed.timed_out,
            });
          } catch {
            resolve({
              stdout,
              stderr,
              exitCode: code ?? (timedOut ? 137 : 1),
              timedOut,
            });
          }
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? (timedOut ? 137 : 1),
            timedOut,
          });
        }
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
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
}

export default CommandSandbox;
