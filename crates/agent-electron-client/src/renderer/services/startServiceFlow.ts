/**
 * 手动启动服务流程：先 reg 同步配置，再执行启动。
 * 用于「手动启动单个服务」按钮，保证 lanproxy 等使用最新 serverHost/serverPort。
 * 抽离以便单测断言调用顺序（先 syncConfigToServer，再 startService）。
 */

export interface ManualStartServiceDeps {
  /** 同步配置到后端（/reg），返回最新 serverHost/serverPort 等；返回值本流程未使用 */
  syncConfigToServer: (opts?: { suppressToast?: boolean }) => Promise<unknown>;
  /** 实际启动指定 key 的服务（内部会调 IPC 如 lanproxy.start） */
  startService: (key: string) => Promise<unknown>;
}

export interface ManualStartServiceCallbacks {
  /** reg 调用开始时的回调 */
  onRegStart?: () => void;
  /** reg 调用结束时的回调（无论成功失败） */
  onRegEnd?: () => void;
}

/**
 * 先调用 reg 同步配置，再启动指定服务。
 * 调用顺序保证：syncConfigToServer 完成后再 startService(key)。
 *
 * @param key - 服务标识符（如 'lanproxy', 'agent', 'fileServer'）
 * @param deps - 依赖注入对象，包含 syncConfigToServer 和 startService 方法
 * @param callbacks - 可选回调，用于在 reg 阶段显示 loading
 * @throws 重新抛出 syncConfigToServer 或 startService 的错误
 */
export async function runManualStartService(
  key: string,
  deps: ManualStartServiceDeps,
  callbacks?: ManualStartServiceCallbacks,
): Promise<void> {
  callbacks?.onRegStart?.();
  try {
    await deps.syncConfigToServer({ suppressToast: true });
  } finally {
    callbacks?.onRegEnd?.();
  }
  await deps.startService(key);
}
