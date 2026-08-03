// @nuwax-ai/agent-kit — health polling primitives shared by nuwa-cli & nuwaclaw.
//
// Host differences (fetch vs http.request; isPidAlive vs process.kill(0)) are
// injected via `fetchImpl` / `isAlive`. The polling骨架, envelope判定 and
// abortable sleep are shared. Requires Node ≥ 20.3 (AbortSignal.any/timeout);
// both hosts run Node 22+.

export interface HealthCheckOptions {
  timeoutMs?: number;
  intervalMs?: number;
  perRequestTimeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface HealthResult {
  healthy: boolean;
  error?: string;
}

/** Abortable sleep — resolves immediately on abort without throwing. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Per-request deadline, combined with an optional external abort signal. */
function combinedSignal(
  perRequestMs: number,
  signal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(perRequestMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

// ---- file-server -----------------------------------------------------------

export interface FileServerHealthOptions extends HealthCheckOptions {
  port: number;
  hostname?: string;
}

/**
 * Poll `GET /health` until `status === "ok"`, timeout, or signal abort.
 * Returns `{ healthy, error }` (nuwa-cli takes `.healthy`; nuwaclaw uses the
 * full result).
 */
export async function waitForFileServerHealth(
  opts: FileServerHealthOptions,
): Promise<HealthResult> {
  const {
    port,
    hostname = "127.0.0.1",
    timeoutMs = 10_000,
    intervalMs = 200,
    perRequestTimeoutMs = 1500,
    signal,
    fetchImpl = fetch,
  } = opts;
  if (signal?.aborted) return { healthy: false };
  const url = `http://${hostname}:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) return { healthy: false };
    try {
      const res = await fetchImpl(url, {
        signal: combinedSignal(perRequestTimeoutMs, signal),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body?.status === "ok") return { healthy: true };
      }
    } catch {
      // not ready / aborted
    }
    if (signal?.aborted) return { healthy: false };
    await delay(intervalMs, signal);
  } while (Date.now() < deadline);
  return { healthy: false };
}

// ---- lanproxy --------------------------------------------------------------

export interface LanproxyTunnelEnvelope {
  code?: string;
  success?: boolean;
  data?: { online?: boolean };
}

/** lanproxy 的「成功」业务码（envelope.code 命中即视为隧道健康）。 */
export const LANPROXY_OK_CODE = "0000";

/** Pure envelope predicate — any of the three fields marks the tunnel up. */
export function isLanproxyTunnelEnvelopeHealthy(
  envelope: LanproxyTunnelEnvelope,
): boolean {
  return (
    envelope.code === LANPROXY_OK_CODE ||
    envelope.success === true ||
    envelope.data?.online === true
  );
}

export interface LanproxyTunnelHealthOptions extends HealthCheckOptions {
  domain: string;
  configKey: string;
}

/** Poll the cloud tunnel health endpoint until the envelope is healthy. */
export async function waitForLanproxyTunnel(
  opts: LanproxyTunnelHealthOptions,
): Promise<HealthResult> {
  const {
    domain,
    configKey,
    timeoutMs = 15_000,
    intervalMs = 500,
    perRequestTimeoutMs = 5000,
    signal,
    fetchImpl = fetch,
  } = opts;
  if (!domain || !configKey || signal?.aborted) return { healthy: false };
  const base = domain.replace(/\/+$/, "");
  const url = `${base}/api/sandbox/config/health/${encodeURIComponent(configKey)}`;
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) return { healthy: false };
    try {
      const res = await fetchImpl(url, {
        signal: combinedSignal(perRequestTimeoutMs, signal),
      });
      if (res.ok) {
        const envelope = (await res.json()) as LanproxyTunnelEnvelope;
        if (isLanproxyTunnelEnvelopeHealthy(envelope)) return { healthy: true };
      }
    } catch {
      // tunnel not reachable / aborted
    }
    if (signal?.aborted) return { healthy: false };
    await delay(intervalMs, signal);
  } while (Date.now() < deadline);
  return { healthy: false };
}

// ---- process liveness ------------------------------------------------------

export interface ProcessLivenessOptions {
  pid: number;
  stabilizeMs?: number;
  signal?: AbortSignal;
  /** Host-injected liveness check (nuwa-cli: isPidAlive; nuwaclaw: process.kill(0)). */
  isAlive: (pid: number) => boolean;
}

/** Confirm a process stays alive across a stabilize window. */
export async function confirmProcessHealthy(
  opts: ProcessLivenessOptions,
): Promise<boolean> {
  const { pid, stabilizeMs = 1000, signal, isAlive } = opts;
  if (signal?.aborted) return false;
  if (!isAlive(pid)) return false;
  if (stabilizeMs > 0) await delay(stabilizeMs, signal);
  if (signal?.aborted) return false;
  return isAlive(pid);
}
