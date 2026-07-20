/**
 * 跨引擎重启记住 project → session_id，供 devcomputer reload 后恢复会话。
 * reload 前从即将销毁的引擎抓取；chat 成功时也会更新。
 */

const projectToSessionId = new Map<string, string>();

export function rememberProjectSession(
  projectKey: string,
  sessionId: string,
): void {
  if (!projectKey || !sessionId) return;
  projectToSessionId.set(projectKey, sessionId);
}

export function resolveProjectSession(projectKey: string): string | undefined {
  if (!projectKey) return undefined;
  return projectToSessionId.get(projectKey);
}

/** reload 前从引擎会话列表写入 registry（优先 request.session_id，否则取最后一个） */
export function captureSessionsForProject(
  projectKey: string,
  sessionIds: string[],
  preferredSessionId?: string,
): void {
  if (!projectKey || sessionIds.length === 0) return;
  const hit = preferredSessionId
    ? sessionIds.find((id) => id === preferredSessionId)
    : undefined;
  rememberProjectSession(projectKey, hit ?? sessionIds[sessionIds.length - 1]);
}

/** 测试用 */
export function clearProjectSessionRegistry(): void {
  projectToSessionId.clear();
}
