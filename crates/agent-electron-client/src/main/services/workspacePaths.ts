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
 * 替换字符串中的 {PREFIX_WORKSPACE_DIR} 占位符
 *
 * @param value - 原始字符串（command 或 args 中的单个元素）
 * @param actualPrefix - 实际替换路径（由 path.join 生成，自动适配当前平台）
 * @returns 替换后的字符串
 *
 * Windows 路径处理：
 * - actualPrefix 由 path.join() 生成，Windows 上自动使用反斜杠 `\`
 * - 替换后保持当前平台的原生路径格式，不做正斜杠统一
 * - 这样 Windows 上的子进程能正确识别路径
 */
export function resolveWorkspacePrefix(
  value: string,
  actualPrefix: string,
): string {
  if (!value.includes(PREFIX_WORKSPACE_DIR_VAR)) return value;
  return value.replaceAll(PREFIX_WORKSPACE_DIR_VAR, actualPrefix);
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
