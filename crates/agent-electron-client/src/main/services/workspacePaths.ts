import * as path from "path";

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
  const normalizedBase = path.normalize(baseWorkspaceDir);
  const suffixSegments = [
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
    userId,
    projectId,
  ];

  if (pathEndsWithSegments(normalizedBase, suffixSegments)) {
    return normalizedBase;
  }

  return path.join(normalizedBase, ...suffixSegments);
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
