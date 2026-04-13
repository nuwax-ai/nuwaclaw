/**
 * Docker 沙箱实现
 *
 * 使用 Docker 容器提供隔离的执行环境
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import log from "electron-log";
import { SandboxManager } from "./SandboxManager";
import type {
  SandboxConfig,
  Workspace,
  ExecuteOptions,
  ExecuteResult,
  FileInfo,
  SandboxStatus,
  CleanupResult,
  ContainerInfo,
} from "@shared/types/sandbox";
import {
  SandboxError,
  SandboxErrorCode,
  ExecutionError,
  FileOperationError,
  WorkspaceError,
  toSandboxError,
} from "@shared/errors/sandbox";

const execAsync = promisify(exec);

/**
 * Docker 沙箱配置
 */
export interface DockerSandboxConfig extends SandboxConfig {
  /** Docker 镜像名称 */
  dockerImage: string;
  /** Docker Host 地址（可选） */
  dockerHost?: string;
}

/**
 * Docker 沙箱实现
 */
export class DockerSandbox extends SandboxManager {
  private containerIds: Map<string, string> = new Map();
  private dockerConfig: DockerSandboxConfig;
  private dockerAvailable: boolean = false;
  private dockerVersion: string | null = null;

  constructor(config: DockerSandboxConfig) {
    super(config);
    this.dockerConfig = config;

    // 验证配置
    if (config.type !== "docker") {
      throw new SandboxError(
        'DockerSandbox 需要 type 为 "docker"',
        SandboxErrorCode.CONFIG_INVALID,
      );
    }
  }

  // ============================================================================
  // 初始化与可用性检查
  // ============================================================================

  async init(): Promise<void> {
    log.info("[DockerSandbox] Initializing Docker sandbox...");
    log.debug("[DockerSandbox] config:", {
      type: this.config.type,
      platform: this.config.platform,
      enabled: this.config.enabled,
      workspaceRoot: this.config.workspaceRoot,
      memoryLimit: this.config.memoryLimit,
      cpuLimit: this.config.cpuLimit,
      networkEnabled: this.config.networkEnabled,
      dockerImage: this.dockerConfig.dockerImage,
      dockerHost: this.dockerConfig.dockerHost,
    });

    try {
      // 检查 Docker 是否可用
      this.dockerAvailable = await this.checkDockerAvailable();

      if (!this.dockerAvailable) {
        throw new SandboxError(
          "Docker 不可用，请确保 Docker Desktop 已安装并运行",
          SandboxErrorCode.DOCKER_UNAVAILABLE,
        );
      }

      // 拉取镜像（如果需要）
      await this.ensureImageExists();

      this.initialized = true;
      log.info("[DockerSandbox] Initialization complete");
    } catch (error) {
      log.error("[DockerSandbox] Initialization failed:", error);
      throw toSandboxError(
        error,
        "Docker 沙箱初始化失败",
        SandboxErrorCode.SANDBOX_UNAVAILABLE,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.dockerAvailable) {
      this.dockerAvailable = await this.checkDockerAvailable();
    }
    return this.dockerAvailable;
  }

  /**
   * 检查 Docker 是否可用
   */
  private async checkDockerAvailable(): Promise<boolean> {
    try {
      const { stdout: versionOut } = await execAsync("docker --version", {
        timeout: 5000,
      });

      // 提取版本号
      const match = versionOut.match(/Docker version ([\d.]+)/);
      this.dockerVersion = match ? match[1] : versionOut.trim();
      log.debug("[DockerSandbox] docker --version:", versionOut.trim());

      // 检查 Docker daemon 是否运行
      const { stdout: infoOut } = await execAsync("docker info", {
        timeout: 5000,
      });
      log.debug(
        "[DockerSandbox] docker info (first 500 chars):",
        infoOut.slice(0, 500),
      );

      log.info(
        "[DockerSandbox] Docker available, version:",
        this.dockerVersion,
      );
      return true;
    } catch (error) {
      log.warn("[DockerSandbox] Docker unavailable:", error);
      return false;
    }
  }

  /**
   * 验证 Docker 镜像名称
   * 只允许字母、数字、冒号、斜杠、点、下划线和连字符
   */
  private validateImageName(image: string): void {
    if (!/^[a-zA-Z0-9_/.:-]+$/.test(image)) {
      throw new SandboxError(
        `Invalid Docker image name: ${image}`,
        SandboxErrorCode.CONFIG_INVALID,
      );
    }
  }

  /**
   * 验证容器 ID
   * 只允许字母、数字和连字符
   */
  private validateContainerId(containerId: string): void {
    if (!/^[a-zA-Z0-9-]+$/.test(containerId)) {
      throw new SandboxError(
        `Invalid container ID: ${containerId}`,
        SandboxErrorCode.CONTAINER_OPERATION_FAILED,
      );
    }
  }

  /**
   * 确保镜像存在
   */
  private async ensureImageExists(): Promise<void> {
    const image = this.dockerConfig.dockerImage;
    this.validateImageName(image);

    try {
      // 检查镜像是否存在
      await execAsync(`docker image inspect ${image}`, { timeout: 10000 });
      log.info("[DockerSandbox] Image already exists:", image);
    } catch {
      // 镜像不存在，尝试拉取
      log.info("[DockerSandbox] Pulling image:", image);
      await execAsync(`docker pull ${image}`, { timeout: 300000 }); // 5 分钟超时
      log.info("[DockerSandbox] Image pull complete:", image);
    }
  }

  // ============================================================================
  // 工作区管理
  // ============================================================================

  async createWorkspace(sessionId: string): Promise<Workspace> {
    log.info("[DockerSandbox] Creating workspace:", sessionId);

    // 检查是否已存在
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
      // 创建工作区目录
      await this.createWorkspaceDirectories(workspaceRoot);

      // 启动 Docker 容器
      const containerId = await this.startContainer(sessionId, workspaceRoot);
      this.containerIds.set(sessionId, containerId);

      // 创建工作区对象
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

      // 发出事件
      this.emitEvent("workspace:created", { workspace });

      log.info(
        "[DockerSandbox] Workspace created:",
        sessionId,
        "container:",
        containerId,
      );
      return workspace;
    } catch (error) {
      // 清理已创建的资源
      await this.cleanupFailedWorkspace(sessionId, workspaceRoot);

      throw toSandboxError(
        error,
        "工作区创建失败",
        SandboxErrorCode.WORKSPACE_CREATE_FAILED,
        {
          sessionId,
        },
      );
    }
  }

  async destroyWorkspace(sessionId: string): Promise<void> {
    log.info("[DockerSandbox] Destroying workspace:", sessionId);

    const workspace = this.validateWorkspaceExists(sessionId);

    try {
      workspace.status = "destroying";

      // 停止并删除容器
      const containerId = this.containerIds.get(sessionId);
      if (containerId) {
        await this.stopContainer(containerId);
        this.containerIds.delete(sessionId);
      }

      // 删除工作区目录（根据保留策略）
      if (workspace.retentionPolicy.mode !== "always") {
        await this.deleteWorkspaceDirectory(workspace.rootPath);
      }

      // 从映射中移除
      this.workspaces.delete(sessionId);

      // 发出事件
      this.emitEvent("workspace:destroyed", {
        workspaceId: workspace.id,
        sessionId,
      });

      log.info("[DockerSandbox] Workspace destruction complete:", sessionId);
    } catch (error) {
      workspace.status = "error";
      throw toSandboxError(
        error,
        "工作区销毁失败",
        SandboxErrorCode.WORKSPACE_DESTROY_FAILED,
        {
          sessionId,
          workspaceId: workspace.id,
        },
      );
    }
  }

  // ============================================================================
  // 命令执行
  // ============================================================================

  async execute(
    sessionId: string,
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.updateLastAccessed(sessionId);

    const containerId = this.containerIds.get(sessionId);
    if (!containerId) {
      throw new ExecutionError(
        "容器未运行",
        SandboxErrorCode.CONTAINER_OPERATION_FAILED,
        {
          sessionId,
        },
      );
    }

    const startTime = Date.now();
    const timeout = options.timeout || 300000; // 默认 5 分钟

    log.info(
      "[DockerSandbox] Executing command:",
      sessionId,
      command,
      args.join(" "),
    );
    log.debug("[DockerSandbox] execute detail:", {
      sessionId,
      command,
      args,
      timeout,
      cwd: options.cwd,
      envKeys: options.env ? Object.keys(options.env) : [],
    });

    // 发出执行开始事件
    this.emitEvent("execute:start", { sessionId, command, args });

    try {
      // 构建 docker exec 命令
      const dockerArgs = this.buildDockerExecArgs(
        containerId,
        command,
        args,
        options,
      );

      const result = await this.executeDockerCommand(dockerArgs, timeout);

      const executeResult: ExecuteResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        duration: Date.now() - startTime,
        command,
        args,
      };

      // 发出执行完成事件
      this.emitEvent("execute:complete", { sessionId, result: executeResult });

      return executeResult;
    } catch (error) {
      const executeResult: ExecuteResult = {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        timedOut: false,
        duration: Date.now() - startTime,
        command,
        args,
      };

      this.emitEvent("execute:error", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        command,
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

  // ============================================================================
  // 文件操作
  // ============================================================================

  async readFile(sessionId: string, filePath: string): Promise<string> {
    const workspace = this.validateWorkspaceExists(sessionId);
    this.validatePathInWorkspace(workspace, filePath);

    try {
      // 直接从主机文件系统读取（因为目录已挂载）
      const content = await fs.readFile(filePath, "utf-8");
      this.updateLastAccessed(sessionId);
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileOperationError(
          `文件未找到: ${filePath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          {
            sessionId,
            cause: error as Error,
          },
        );
      }
      throw new FileOperationError(
        `文件读取失败: ${filePath}`,
        SandboxErrorCode.FILE_READ_FAILED,
        {
          sessionId,
          cause: error as Error,
        },
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
      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(filePath, content, "utf-8");
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
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const fileInfos: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(fullPath);

        fileInfos.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime,
        });
      }

      this.updateLastAccessed(sessionId);
      return fileInfos;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileOperationError(
          `目录未找到: ${dirPath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          { sessionId, cause: error as Error },
        );
      }
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
      await fs.unlink(filePath);
      this.updateLastAccessed(sessionId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileOperationError(
          `文件未找到: ${filePath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          {
            sessionId,
            cause: error as Error,
          },
        );
      }
      throw new FileOperationError(
        `文件删除失败: ${filePath}`,
        SandboxErrorCode.FILE_DELETE_FAILED,
        { sessionId, cause: error as Error },
      );
    }
  }

  // ============================================================================
  // 清理
  // ============================================================================

  async cleanup(): Promise<CleanupResult> {
    log.info("[DockerSandbox] Starting cleanup...");

    const result: CleanupResult = {
      deletedCount: 0,
      freedSpace: 0,
      errors: [],
    };

    // 停止所有容器
    for (const [sessionId, containerId] of this.containerIds) {
      try {
        await this.stopContainer(containerId);
        result.deletedCount++;
      } catch (error) {
        result.errors.push(`停止容器失败 ${sessionId}: ${error}`);
      }
    }

    this.containerIds.clear();

    // 清理工作区目录
    for (const [sessionId, workspace] of this.workspaces) {
      try {
        if (workspace.retentionPolicy.mode !== "always") {
          const size = await this.getDirectorySize(workspace.rootPath);
          await this.deleteWorkspaceDirectory(workspace.rootPath);
          result.freedSpace += size;
        }
      } catch (error) {
        result.errors.push(`清理工作区失败 ${sessionId}: ${error}`);
      }
    }

    this.workspaces.clear();

    log.info("[DockerSandbox] Cleanup complete:", result);
    this.emitEvent("cleanup:complete", { result });

    return result;
  }

  // ============================================================================
  // Docker 特有方法
  // ============================================================================

  /**
   * 列出所有容器
   */
  async listContainers(): Promise<ContainerInfo[]> {
    try {
      const { stdout } = await execAsync(
        'docker ps -a --filter "name=nuwax-sandbox-" --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.CreatedAt}}"',
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const containers: ContainerInfo[] = [];

      for (const line of lines) {
        const [id, name, image, status, createdAt] = line.split("\t");

        // 从容器名称中提取 sessionId
        const sessionMatch = name.match(/nuwax-sandbox-(.+)/);
        const sessionId = sessionMatch ? sessionMatch[1] : undefined;

        containers.push({
          id,
          name,
          image,
          status: this.parseDockerStatus(status),
          sessionId,
          createdAt: new Date(createdAt),
        });
      }

      return containers;
    } catch (error) {
      log.error("[DockerSandbox] Failed to list containers:", error);
      return [];
    }
  }

  /**
   * 获取容器日志
   */
  async getContainerLogs(sessionId: string): Promise<string> {
    const containerId = this.containerIds.get(sessionId);
    if (!containerId) {
      throw new SandboxError(
        "容器未找到",
        SandboxErrorCode.CONTAINER_OPERATION_FAILED,
        {
          sessionId,
        },
      );
    }

    this.validateContainerId(containerId);

    try {
      const { stdout } = await execAsync(`docker logs ${containerId}`, {
        timeout: 10000,
      });
      return stdout;
    } catch (error) {
      log.error("[DockerSandbox] Failed to get container logs:", error);
      return "";
    }
  }

  /**
   * 获取沙箱状态（包含 Docker 信息）
   */
  async getStatus(): Promise<SandboxStatus> {
    const baseStatus = await super.getStatus();

    return {
      ...baseStatus,
      docker: {
        running: this.dockerAvailable,
        containerCount: this.containerIds.size,
        version: this.dockerVersion || undefined,
      },
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 创建工作区目录结构
   */
  private async createWorkspaceDirectories(
    workspaceRoot: string,
  ): Promise<void> {
    const directories = [
      workspaceRoot,
      path.join(workspaceRoot, "projects"),
      path.join(workspaceRoot, "node_modules"),
      path.join(workspaceRoot, "python-env"),
      path.join(workspaceRoot, "bin"),
      path.join(workspaceRoot, "cache"),
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * 启动 Docker 容器
   */
  private async startContainer(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<string> {
    const containerName = `nuwax-sandbox-${sessionId}`;
    const image = this.dockerConfig.dockerImage;

    // 构建容器参数
    const args = [
      "run",
      "-d",
      "--name",
      containerName,
      // 挂载工作区
      "-v",
      `${workspaceRoot}:/workspace`,
      // 内存限制
      "--memory",
      this.config.memoryLimit || "2g",
      // CPU 限制
      "--cpus",
      String(this.config.cpuLimit || 2),
      // 禁用网络（如果配置）
      ...(this.config.networkEnabled === false ? ["--network", "none"] : []),
      // 工作目录
      "-w",
      "/workspace",
      // 环境变量
      "-e",
      "HOME=/workspace",
      "-e",
      "PATH=/usr/local/bin:/usr/bin:/bin:/workspace/bin",
      // 镜像
      image,
      // 保持容器运行
      "tail",
      "-f",
      "/dev/null",
    ];

    log.debug("[DockerSandbox] startContainer args:", args.join(" "));

    const { stdout } = await execAsync(`docker ${args.join(" ")}`, {
      timeout: 60000,
    });
    const containerId = stdout.trim();

    log.info(
      "[DockerSandbox] Container started:",
      containerId,
      "name:",
      containerName,
    );
    return containerId;
  }

  /**
   * 停止并删除容器
   */
  private async stopContainer(containerId: string): Promise<void> {
    this.validateContainerId(containerId);

    try {
      await execAsync(`docker stop ${containerId}`, { timeout: 30000 });
      await execAsync(`docker rm ${containerId}`, { timeout: 30000 });
      log.info("[DockerSandbox] Container stopped and removed:", containerId);
    } catch (error) {
      log.error("[DockerSandbox] Failed to stop container:", error);
      throw error;
    }
  }

  /**
   * 构建 docker exec 参数
   */
  private buildDockerExecArgs(
    containerId: string,
    command: string,
    args: string[],
    options: ExecuteOptions,
  ): string[] {
    const dockerArgs = ["exec"];

    // 工作目录
    if (options.cwd) {
      dockerArgs.push("-w", options.cwd);
    }

    // 环境变量
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        dockerArgs.push("-e", `${key}=${value}`);
      }
    }

    // 执行命令
    dockerArgs.push(containerId, command, ...args);

    log.debug("[DockerSandbox] docker exec args:", dockerArgs.join(" "));
    return dockerArgs;
  }

  /**
   * 执行 Docker 命令
   */
  private async executeDockerCommand(
    dockerArgs: string[],
    timeout: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", dockerArgs, { shell: false });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      // 超时处理
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        log.debug("[DockerSandbox] docker exec completed:", {
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
        log.debug("[DockerSandbox] docker exec error:", error.message);
        reject(error);
      });
    });
  }

  /**
   * 解析 Docker 状态字符串
   */
  private parseDockerStatus(
    status: string,
  ): "running" | "exited" | "paused" | "created" {
    if (status.includes("Up")) return "running";
    if (status.includes("Exited")) return "exited";
    if (status.includes("Paused")) return "paused";
    return "created";
  }

  /**
   * 获取目录大小
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      let totalSize = 0;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * 删除工作区目录
   */
  private async deleteWorkspaceDirectory(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      log.error("[DockerSandbox] Failed to delete directory:", dirPath, error);
      throw error;
    }
  }

  /**
   * 清理失败的工作区
   */
  private async cleanupFailedWorkspace(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<void> {
    try {
      // 停止可能已创建的容器
      const containerId = this.containerIds.get(sessionId);
      if (containerId) {
        await this.stopContainer(containerId);
        this.containerIds.delete(sessionId);
      }

      // 删除目录
      await this.deleteWorkspaceDirectory(workspaceRoot);
    } catch (error) {
      log.error("[DockerSandbox] Error cleaning failed workspace:", error);
    }
  }
}

export default DockerSandbox;
