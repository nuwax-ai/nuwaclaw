/**
 * 沙箱工作空间核心类型定义
 * 基于 Harness 架构的多平台沙箱工作空间系统
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 支持的平台类型
 */
export type Platform = "darwin" | "win32" | "linux";

/**
 * 沙箱类型
 * - docker: Docker 容器（全平台）
 * - macos-seatbelt: macOS seatbelt（sandbox-exec）
 * - linux-bwrap: Linux bubblewrap
 * - windows-sandbox: Windows Sandbox helper
 * - wsl: Windows Subsystem for Linux（兼容保留）
 * - firejail: Firejail（兼容保留）
 * - none: 无沙箱（直接执行）
 */
export type SandboxType =
  | "docker"
  | "macos-seatbelt"
  | "linux-bwrap"
  | "windows-sandbox"
  | "wsl"
  | "firejail"
  | "none";

/**
 * 沙箱策略模式
 * - off: 关闭沙箱
 * - non-main: 仅高风险命令走沙箱
 * - all: 所有命令走沙箱
 */
export type SandboxMode = "off" | "non-main" | "all";

/**
 * 沙箱后端
 * - auto: 按平台自动选择
 */
export type SandboxBackend =
  | "auto"
  | "docker"
  | "macos-seatbelt"
  | "linux-bwrap"
  | "windows-sandbox";

/**
 * 降级策略
 * - degrade_to_off: 后端不可用时降级为 off
 * - fail_closed: 后端不可用时阻断执行
 */
export type SandboxFallback = "degrade_to_off" | "fail_closed";

/**
 * Windows Restricted Token 沙箱模式
 */
export type WindowsSandboxMode = "unelevated" | "elevated";

/**
 * 统一沙箱策略
 */
export interface SandboxPolicy {
  enabled: boolean;
  mode: SandboxMode;
  backend: SandboxBackend;
  fallback: SandboxFallback;
  windows: {
    sandbox: {
      mode: WindowsSandboxMode;
      privateDesktop: boolean;
    };
  };
}

/**
 * 单个后端能力状态
 */
export interface SandboxCapabilityItem {
  available: boolean;
  reason?: string;
  binaryPath?: string;
}

/**
 * 多后端能力探测结果
 */
export interface SandboxCapabilities {
  platform: Platform;
  recommendedBackend: SandboxBackend;
  docker: SandboxCapabilityItem;
  macosSeatbelt: SandboxCapabilityItem;
  linuxBwrap: SandboxCapabilityItem;
  windowsSandbox: SandboxCapabilityItem;
}

/**
 * 权限级别
 * - 0: 完全受限（只读）
 * - 1: 标准模式（需要确认）
 * - 2: 开发模式（宽松确认）
 * - 3: 无限制（谨慎使用）
 */
export type PermissionLevel = 0 | 1 | 2 | 3;

/**
 * CP 工作流检查点
 */
export type Checkpoint = "CP1" | "CP2" | "CP3" | "CP4" | "CP5";

/**
 * 检查点状态
 */
export type CheckpointStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

/**
 * 质量门禁状态
 */
export type GateStatus = "pending" | "passed" | "failed";

// ============================================================================
// 进程级沙箱（ACP 引擎）
// ============================================================================

/**
 * ACP 引擎进程级沙箱配置
 * 用于将整个引擎进程包裹在沙箱后端中
 */
export interface SandboxProcessConfig {
  /** 是否启用沙箱包装 */
  enabled: boolean;
  /** 已解析的沙箱后端类型 */
  type: SandboxType;
  /** 用户工作区目录（可写） */
  projectWorkspaceDir: string;
  /** 是否允许网络访问（引擎需要 API 调用） */
  networkEnabled: boolean;
  /** 降级策略 */
  fallback: SandboxFallback;
  /** Linux bwrap 二进制路径（可选） */
  linuxBwrapPath?: string;
  /** Windows Restricted helper 路径（可选） */
  windowsSandboxHelperPath?: string;
  /** Windows Restricted 模式（可选） */
  windowsSandboxMode?: WindowsSandboxMode;
  /** Windows Restricted 私有桌面（可选） */
  windowsSandboxPrivateDesktop?: boolean;
}

// ============================================================================
// 沙箱配置
// ============================================================================

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 沙箱类型 */
  type: SandboxType;
  /** 运行平台 */
  platform: Platform;
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 内存限制（如 "2g"） */
  memoryLimit?: string;
  /** CPU 核心数限制 */
  cpuLimit?: number;
  /** 磁盘配额（如 "10g"） */
  diskQuota?: string;
  /** 是否允许网络访问 */
  networkEnabled?: boolean;
  /** Docker 镜像名称（仅 Docker 沙箱） */
  dockerImage?: string;
  /** Docker Host 地址（可选） */
  dockerHost?: string;
  /** 只读模式（禁止写入操作） */
  readOnly?: boolean;
  /** WSL 发行版名称（仅 WSL 沙箱） */
  wslDistribution?: string;
  /** Firejail 配置目录（仅 Firejail 沙箱） */
  firejailProfileDir?: string;
}

// ============================================================================
// 工作区
// ============================================================================

/**
 * 工作区
 */
export interface Workspace {
  /** 工作区唯一标识 */
  id: string;
  /** 关联的会话 ID */
  sessionId: string;
  /** 工作区根路径 */
  rootPath: string;
  /** 项目目录路径 */
  projectsPath: string;
  /** node_modules 路径 */
  nodeModulesPath: string;
  /** Python 虚拟环境路径 */
  pythonEnvPath: string;
  /** bin 目录路径 */
  binPath: string;
  /** 缓存目录路径 */
  cachePath: string;
  /** 沙箱配置 */
  sandboxConfig: SandboxConfig;
  /** 创建时间 */
  createdAt: Date;
  /** 最后访问时间 */
  lastAccessedAt: Date;
  /** 保留策略 */
  retentionPolicy: RetentionPolicy;
  /** 工作区状态 */
  status: WorkspaceStatus;
}

/**
 * 工作区状态
 */
export type WorkspaceStatus =
  | "creating"
  | "active"
  | "inactive"
  | "destroying"
  | "destroyed"
  | "error";

/**
 * 创建工作区选项
 */
export interface CreateWorkspaceOptions {
  /** 保留策略 */
  retention?: Partial<RetentionPolicy>;
  /** 平台覆盖 */
  platform?: Platform;
  /** 沙箱类型覆盖 */
  sandboxType?: SandboxType;
  /** 自定义工作区路径 */
  customPath?: string;
}

// ============================================================================
// 命令执行
// ============================================================================

/**
 * 命令执行选项
 */
export interface ExecuteOptions {
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 最大内存使用 */
  maxMemory?: string;
  /** 标准输入输出模式 */
  stdio?: "pipe" | "inherit";
  /** 权限级别 */
  permissionLevel?: PermissionLevel;
  /** 是否需要权限检查 */
  skipPermissionCheck?: boolean;
}

/**
 * 命令执行结果
 */
export interface ExecuteResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 执行时长（毫秒） */
  duration: number;
  /** 命令 */
  command: string;
  /** 参数 */
  args: string[];
}

// ============================================================================
// 文件操作
// ============================================================================

/**
 * 文件信息
 */
export interface FileInfo {
  /** 文件名 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间 */
  modifiedAt: Date;
  /** 权限 */
  permissions?: string;
}

// ============================================================================
// 保留策略
// ============================================================================

/**
 * 保留策略
 */
export interface RetentionPolicy {
  /** 保留模式
   * - always: 始终保留
   * - timeout: 超时后清理
   * - manual: 手动清理
   */
  mode: "always" | "timeout" | "manual";
  /** 最大保留时间（毫秒） */
  maxAge?: number;
  /** 最大工作区数量 */
  maxWorkspaces?: number;
  /** 最大占用空间 */
  maxSize?: string;
  /** 错误时是否保留 */
  preserveOnError?: boolean;
}

// ============================================================================
// 权限管理
// ============================================================================

/**
 * 权限类型
 */
export type PermissionType =
  | "file:read"
  | "file:write"
  | "file:delete"
  | "command:execute"
  | "network:access"
  | "network:download"
  | "package:install:npm"
  | "package:install:python"
  | "package:install:system";

/**
 * 权限
 */
export interface Permission {
  /** 权限 ID */
  id: string;
  /** 权限类型 */
  type: PermissionType;
  /** 目标资源 */
  target: string;
  /** 关联的会话 ID */
  sessionId: string;
  /** 批准来源
   * - system: 系统自动批准
   * - user: 用户批准
   * - policy: 策略自动批准
   * - denied: 已拒绝
   */
  approvedBy: "system" | "user" | "policy" | "denied";
  /** 批准时间 */
  timestamp: Date;
  /** 原因说明 */
  reason?: string;
}

/**
 * 权限策略
 */
export interface PermissionPolicy {
  /** 自动批准的权限类型 */
  autoApprove: PermissionType[];
  /** 需要确认的权限类型 */
  requireConfirm: PermissionType[];
  /** 禁止的权限类型 */
  denyList: PermissionType[];
  /** 是否只允许工作区内操作 */
  workspaceOnly: boolean;
  /** 安全命令白名单 */
  safeCommands: string[];
}

/**
 * 权限检查结果
 */
export interface PermissionResult {
  /** 是否允许 */
  allowed: boolean;
  /** 原因说明 */
  reason: string;
  /** 请求 ID（如需用户确认） */
  requestId?: string;
}

/**
 * 权限请求
 */
export interface PermissionRequest {
  /** 请求 ID */
  id: string;
  /** 关联的会话 ID */
  sessionId: string;
  /** 权限类型 */
  type: PermissionType;
  /** 目标资源 */
  target: string;
  /** 请求原因 */
  reason?: string;
  /** 请求时间 */
  requestedAt: Date;
  /** 请求状态 */
  status: "pending" | "approved" | "denied";
}

// ============================================================================
// 工作流状态
// ============================================================================

/**
 * 工作流状态
 */
export interface WorkflowState {
  /** 项目名称 */
  project: string;
  /** 版本 */
  version: string;
  /** 类型 */
  type: "sandbox";
  /** 平台 */
  platform: Platform;
  /** 最后更新时间 */
  lastUpdated: string;

  /** 当前任务 */
  currentTask: string | null;
  /** 任务状态 */
  taskStatus: "idle" | "running" | "completed" | "failed";
  /** 当前阶段 */
  stage: Checkpoint | "none";

  /** 检查点状态 */
  checkpoints: Record<Checkpoint, CheckpointStatus>;

  /** 质量门禁状态 */
  gates: Record<string, GateStatus>;

  /** 执行指标 */
  metrics: SandboxMetrics;

  /** 工作区记录 */
  workspaces: Record<string, WorkspaceRecord>;

  /** 最近变更 */
  recentChanges: RecentChange[];
}

/**
 * 工作区记录（用于状态持久化）
 */
export interface WorkspaceRecord {
  /** 创建时间 */
  createdAt: string;
  /** 最后访问时间 */
  lastAccessed: string;
  /** 沙箱类型 */
  sandboxType: SandboxType;
  /** 状态 */
  status: WorkspaceStatus;
}

/**
 * 沙箱执行指标
 */
export interface SandboxMetrics {
  /** 已创建的沙箱数量 */
  sandboxesCreated: number;
  /** 已销毁的沙箱数量 */
  sandboxesDestroyed: number;
  /** 已完成的执行次数 */
  executionsCompleted: number;
  /** 被拦截的执行次数 */
  executionsBlocked: number;
  /** 平均执行时间 */
  averageExecutionTime: number;
  /** 人工干预次数 */
  humanInterventions: number;
}

/**
 * 最近变更记录
 */
export interface RecentChange {
  /** 时间戳 */
  timestamp: string;
  /** 变更类型 */
  type: "create" | "destroy" | "execute" | "permission" | "cleanup";
  /** 描述 */
  description: string;
  /** 关联的会话 ID */
  sessionId?: string;
}

// ============================================================================
// 质量门禁
// ============================================================================

/**
 * 质量门禁结果
 */
export interface GateResult {
  /** 是否通过 */
  pass: boolean;
  /** 原因说明 */
  reason?: string;
}

/**
 * 质量门禁报告
 */
export interface GateReport {
  /** 各门禁结果 */
  results: Record<string, GateResult>;
  /** 是否全部通过 */
  allPassed: boolean;
}

// ============================================================================
// 清理
// ============================================================================

/**
 * 清理结果
 */
export interface CleanupResult {
  /** 删除的工作区数量 */
  deletedCount: number;
  /** 释放的空间（字节） */
  freedSpace: number;
  /** 错误列表 */
  errors: string[];
}

// ============================================================================
// 沙箱状态
// ============================================================================

/**
 * 沙箱状态
 */
export interface SandboxStatus {
  /** 是否可用 */
  available: boolean;
  /** 沙箱类型 */
  type: SandboxType;
  /** 当前后端 */
  backend?: SandboxBackend;
  /** 平台 */
  platform: Platform;
  /** 活跃工作区数量 */
  activeWorkspaces: number;
  /** 是否发生降级 */
  degraded?: boolean;
  /** 状态说明 */
  reason?: string;
  /** 能力探测快照 */
  capabilities?: SandboxCapabilities;
  /** 总内存使用 */
  totalMemory?: string;
  /** 磁盘使用 */
  diskUsage?: string;
  /** Docker 特有信息 */
  docker?: {
    /** Docker 是否运行 */
    running: boolean;
    /** 容器数量 */
    containerCount: number;
    /** Docker 版本 */
    version?: string;
  };
}

// ============================================================================
// 容器信息（Docker 特有）
// ============================================================================

/**
 * 容器信息
 */
export interface ContainerInfo {
  /** 容器 ID */
  id: string;
  /** 容器名称 */
  name: string;
  /** 镜像名称 */
  image: string;
  /** 状态 */
  status: "running" | "exited" | "paused" | "created";
  /** 关联的会话 ID */
  sessionId?: string;
  /** 创建时间 */
  createdAt: Date;
  /** 端口映射 */
  ports?: string[];
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * 沙箱事件类型
 */
export interface SandboxEvents {
  /** 工作区已创建 */
  "workspace:created": { workspace: Workspace };
  /** 工作区已销毁 */
  "workspace:destroyed": { workspaceId: string; sessionId: string };
  /** 工作区已访问 */
  "workspace:accessed": {
    workspaceId: string;
    sessionId: string;
    timestamp: Date;
  };
  /** 权限请求 */
  "permission:requested": { request: PermissionRequest };
  /** 权限已批准 */
  "permission:approved": { permission: Permission };
  /** 权限已拒绝 */
  "permission:denied": {
    requestId: string;
    sessionId: string;
    reason?: string;
  };
  /** 执行开始 */
  "execute:start": { sessionId: string; command: string; args: string[] };
  /** 执行完成 */
  "execute:complete": { sessionId: string; result: ExecuteResult };
  /** 执行错误 */
  "execute:error": { sessionId: string; error: string; command: string };
  /** 清理开始 */
  "cleanup:start": { reason: string };
  /** 清理完成 */
  "cleanup:complete": { result: CleanupResult };
  /** 沙箱不可用 */
  "sandbox:unavailable": { reason: string };
  /** 沙箱已恢复 */
  "sandbox:recovered": { type: SandboxType };
}
