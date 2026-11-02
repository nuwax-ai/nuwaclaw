// @nuwax-ai/agent-kit — service start retry primitive shared by nuwa-cli & nuwaclaw.
//
// Hosts own spawn / stop / port sweep / product lifecycle. This module only
// provides the isomorphic "attempt → backoff → retry" skeleton so Windows cold
// start flakes (file-server / lanproxy health timeouts) are handled the same way
// in every host. Logger is injected so agent-kit never depends on electron-log.

import { delay } from "./health.js";

/** Default max attempts (including the first try). */
export const DEFAULT_START_MAX_ATTEMPTS = 3;

/**
 * Backoff after each failure (ms): wait 1s after 1st fail, 2s after 2nd, then
 * the 3rd attempt. Index = failedAttempts - 1.
 */
export const DEFAULT_START_BACKOFF_MS = [1000, 2000, 4000] as const;

/** Minimal logger contract — hosts bind electron-log / console / nuwa-cli logger. */
export interface StartRetryLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface StartRetryOptions {
  /** Log / error label, e.g. "FileServer" / "Lanproxy". */
  label: string;
  /** Max attempts including the first; default 3. */
  maxAttempts?: number;
  /** Backoff delays between attempts; default 1s / 2s / 4s. */
  backoffMs?: readonly number[];
  /** Optional abort for the whole retry sequence (checked between attempts). */
  signal?: AbortSignal;
  /** Host logger; default is silent (no console noise in library code). */
  logger?: StartRetryLogger;
}

export interface StartAttemptResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

const silentLogger: StartRetryLogger = {
  info: () => {},
  warn: () => {},
};

/**
 * Run a full start attempt function with limited retries and exponential-ish backoff.
 *
 * `attemptFn` must clean up on failure (stop process / free port) so the next
 * attempt does not hit a false "already running" success.
 */
export async function withStartRetry<T extends StartAttemptResult>(
  attemptFn: (attempt: number, maxAttempts: number) => Promise<T>,
  options: StartRetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_START_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_START_BACKOFF_MS;
  const logger = options.logger ?? silentLogger;
  const signal = options.signal;
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      return (
        lastResult ??
        ({
          success: false,
          error: `${options.label} start aborted`,
        } as T)
      );
    }

    logger.info(`[${options.label}] start attempt ${attempt}/${maxAttempts}`);
    lastResult = await attemptFn(attempt, maxAttempts);

    if (lastResult.success) {
      if (attempt > 1) {
        logger.info(
          `[${options.label}] succeeded on attempt ${attempt}/${maxAttempts}`,
        );
      }
      return lastResult;
    }

    logger.warn(
      `[${options.label}] attempt ${attempt}/${maxAttempts} failed: ${lastResult.error ?? "unknown"}`,
    );

    if (attempt < maxAttempts) {
      const waitMs =
        backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 1000;
      await delay(waitMs, signal);
    }
  }

  return (
    lastResult ??
    ({
      success: false,
      error: `${options.label} start failed with no attempt result`,
    } as T)
  );
}
