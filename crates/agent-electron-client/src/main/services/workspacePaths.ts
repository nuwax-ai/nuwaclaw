import * as fs from "fs";
import * as path from "path";
import {
  extractNormalProjectContainerPid,
  isNormalProjectServiceType,
} from "./computer/agentWorkDir";

const COMPUTER_PROJECT_WORKSPACE_SEGMENT = "computer-project-workspace";

function pathEndsWithSegments(candidate: string, suffixSegments: string[]) {
  const candidateSegments = path
    .normalize(candidate)
    .split(path.sep)
    .filter(Boolean);
  if (candidateSegments.length < suffixSegments.length) return false;

  const offset = candidateSegments.length - suffixSegments.length;
  return suffixSegments.every(
    (segment, index) => candidateSegments[offset + index] === segment,
  );
}

export function resolveComputerProjectWorkspaceDir(
  baseWorkspaceDir: string,
  userId: string,
  projectId: string,
): string {
  return resolveWorkspaceDirWithSuffix(baseWorkspaceDir, [
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
    userId,
    projectId,
  ]);
}

const NORMAL_PROJECT_SEGMENT = "normalProject";

/**
 * 常规项目（normalProject）工作区目录：
 * {base}/computer-project-workspace/{userId}/normalProject/{projectId}。
 *
 * 本机镜像云端容器布局 /home/user/normalProject/{project_id}（rcoder 侧
 * chat 物化与 agent-runner 终端推导同根）——chat 建目录与 ttyd 终端 cwd
 * 推导共用本函数作为单一事实源，保证两层目录对得上。
 */
export function resolveNormalProjectWorkspaceDir(
  baseWorkspaceDir: string,
  userId: string,
  projectId: string,
): string {
  return resolveWorkspaceDirWithSuffix(baseWorkspaceDir, [
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
    userId,
    NORMAL_PROJECT_SEGMENT,
    projectId,
  ]);
}

function resolveWorkspaceDirWithSuffix(
  baseWorkspaceDir: string,
  suffixSegments: string[],
): string {
  const normalizedBase = path.normalize(baseWorkspaceDir);

  if (pathEndsWithSegments(normalizedBase, suffixSegments)) {
    return normalizedBase;
  }

  return path.join(normalizedBase, ...suffixSegments);
}

/**
 * 在 computer-project-workspace/<userId>/normalProject/<projectId> 层按
 * projectId 反查唯一可用工作区（userId 层任意）。
 *
 * 与 findProjectWorkspaceByProjectId 同款保护：userId 轨道不可信（开发代理
 * 写死 local / 跨端 userId 不一致）时精确拼接目录不存在，按 projectId 扫描
 * normalProject 层；命中恰好一个非空目录则返回，0 个或多个返回 null。
 * 两个 id 空间不同（conversationId vs 常规项目 id），不与 agent-runner 层
 * 跨层反查。
 */
export function findNormalProjectWorkspaceByProjectId(
  baseWorkspaceDir: string,
  projectId: string,
  isUsable: (dir: string) => boolean,
): string | null {
  if (!projectId) return null;
  const root = path.join(
    path.normalize(baseWorkspaceDir),
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
  );
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  const hits = entries
    .map((name) => path.join(root, name, NORMAL_PROJECT_SEGMENT, projectId))
    .filter((dir) => isUsable(dir));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 会话项目目录三轨推导的单一事实源（chat 引擎 cwd / codex workspaceDir 覆盖 /
 * devcomputer reload 会话归档共用，防三处实现漂移）。输入 workDirId 为入口
 * （router/IPC）归一化后的 agent_work_dir 或 project_id：
 * - normalProject 业务（service_type 判定；容器物化形态归一为 pid 防御绕过
 *   入口校验的调用方）→ {base}/computer-project-workspace/{userId}/normalProject/{pid}
 * - 本机绝对路径（web 目录弹窗自选）→ 原值直通
 * - 标识符 → {base}/computer-project-workspace/{userId}/{id}（平铺层）
 */
export function resolveAgentProjectDir(
  baseWorkspaceDir: string,
  userId: string,
  workDirId: string,
  serviceType?: string,
): string {
  const containerPid = extractNormalProjectContainerPid(workDirId);
  if (
    containerPid !== null ||
    (isNormalProjectServiceType(serviceType) && !path.isAbsolute(workDirId))
  ) {
    return resolveNormalProjectWorkspaceDir(
      baseWorkspaceDir,
      userId,
      containerPid ?? workDirId,
    );
  }
  if (path.isAbsolute(workDirId)) {
    return workDirId;
  }
  return resolveComputerProjectWorkspaceDir(
    baseWorkspaceDir,
    userId,
    workDirId,
  );
}

/**
 * 在 computer-project-workspace 下按 projectId 反查唯一可用工作区（userId 层任意）。
 *
 * 场景：终端路由的 userId 轨道不可信（开发代理写死 `local`、或云端会话 userId 与本机
 * 落盘轨道不一致）时，精确拼接目录不存在；但引擎真实落盘是
 * computer-project-workspace/{真实userId}/{projectId}。命中恰好一个非空目录则返回，
 * 0 个或多个返回 null（多命中不猜，交由调用方走 fallback）。
 */
export function findProjectWorkspaceByProjectId(
  baseWorkspaceDir: string,
  projectId: string,
  isUsable: (dir: string) => boolean,
): string | null {
  if (!projectId) return null;
  const root = path.join(
    path.normalize(baseWorkspaceDir),
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
  );
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  const hits = entries
    .map((name) => path.join(root, name, projectId))
    .filter((dir) => isUsable(dir));
  return hits.length === 1 ? hits[0] : null;
}

// =============================================================================
// {PREFIX_WORKSPACE_DIR} 路径变量替换
// =============================================================================

/** 路径占位符常量 */
const PREFIX_WORKSPACE_DIR_VAR = "{PREFIX_WORKSPACE_DIR}";

/**
 * 替换字符串中的 {PREFIX_WORKSPACE_DIR} 占位符，并标准化路径分隔符
 *
 * @param value - 原始字符串（command、args 或 env 中的单个元素）
 * @param actualPrefix - 实际替换路径（由 path.join 生成，自动适配当前平台）
 * @returns 替换后的字符串，路径分隔符已统一为当前平台格式
 *
 * 路径处理：
 * - actualPrefix 由 path.join() 生成，Windows 上自动使用反斜杠 `\`
 * - 服务器端下发的路径使用 Linux 正斜杠 `/`
 * - 替换后通过 path.normalize 统一分隔符，避免 Windows 上混合路径导致 ENOENT
 */
export function resolveWorkspacePrefix(
  value: string,
  actualPrefix: string,
): string {
  if (!value.includes(PREFIX_WORKSPACE_DIR_VAR)) return value;
  // path.normalize: 统一路径分隔符（Windows 上 / → \），同时处理冗余分隔符
  // 服务器端下发的路径使用 Linux 正斜杠，替换后的混合路径在 Windows 上会导致 ENOENT
  return path.normalize(
    value.replaceAll(PREFIX_WORKSPACE_DIR_VAR, actualPrefix),
  );
}

/**
 * 批量替换 agent_server 中的 command 和 args 里的 {PREFIX_WORKSPACE_DIR}
 */
export function resolveAgentServerPaths(
  command: string | undefined,
  args: string[] | undefined,
  actualPrefix: string,
): { command?: string; args?: string[] } {
  return {
    command: command ? resolveWorkspacePrefix(command, actualPrefix) : command,
    args: args?.map((a) => resolveWorkspacePrefix(a, actualPrefix)),
  };
}

/**
 * 替换 agent_server.env 中所有值的 {PREFIX_WORKSPACE_DIR}
 *
 * env 的替换路径可能与 command/args 不同：
 * - /devcomputer/chat: 与 command/args 一致（项目工作目录）
 * - /computer/chat: 使用 logs 目录（~/.nuwaclaw/logs/agent_logs）
 */
export function resolveAgentEnvPaths(
  env: Record<string, string> | undefined,
  actualPrefix: string,
): Record<string, string> | undefined {
  if (!env) return env;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveWorkspacePrefix(value, actualPrefix);
  }
  return resolved;
}
