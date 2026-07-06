import log from "electron-log";
import type { ComputerChatRequest } from "@shared/types/computerTypes";

export interface ChatDispatchContext {
  dispatchKey: string;
  turnGeneration: number;
}

/** Per-project chat dispatch key (aligned with chatEngineKey). */
export function resolveChatDispatchKey(request: ComputerChatRequest): string {
  return (
    request.agent_work_dir ||
    request.project_id ||
    request.session_id ||
    "default"
  );
}

/**
 * Serializes chat dispatch per project key and tracks arrival generation so a
 * later /computer/chat supersedes an earlier one still in setup.
 */
export class ChatDispatchCoordinator {
  private latestGenerationByKey = new Map<string, number>();
  private dispatchTailByKey = new Map<string, Promise<void>>();

  bumpArrival(key: string, requestId?: string): number {
    const next = (this.latestGenerationByKey.get(key) ?? 0) + 1;
    this.latestGenerationByKey.set(key, next);
    log.info(
      `[ChatDispatch] bump: key=${key} gen=${next}${requestId ? ` request_id=${requestId}` : ""}`,
    );
    return next;
  }

  isLatest(key: string, turnGeneration: number): boolean {
    return this.latestGenerationByKey.get(key) === turnGeneration;
  }

  /**
   * Run dispatch fn serially per key. Returns undefined when this turn was
   * superseded before fn ran.
   */
  async runDispatch<T>(
    key: string,
    turnGeneration: number,
    fn: (isLatest: () => boolean) => Promise<T>,
  ): Promise<T | undefined> {
    const prev = this.dispatchTailByKey.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.dispatchTailByKey.set(
      key,
      prev.then(() => gate),
    );

    await prev;

    try {
      if (!this.isLatest(key, turnGeneration)) {
        log.info(
          `[ChatDispatch] skip stale dispatch: key=${key} gen=${turnGeneration} latest=${this.latestGenerationByKey.get(key)}`,
        );
        return undefined;
      }
      const isLatest = () => this.isLatest(key, turnGeneration);
      return await fn(isLatest);
    } finally {
      release();
    }
  }

  /** Test helper */
  reset(): void {
    this.latestGenerationByKey.clear();
    this.dispatchTailByKey.clear();
  }
}

export const chatDispatchCoordinator = new ChatDispatchCoordinator();
