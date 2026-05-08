import { loader } from "@monaco-editor/react";

function resolveVsBaseUrl(): string {
  // dev: http://localhost:60173/
  // prod: file://.../dist/index.html (vite base './')
  // 统一用 URL 解析，避免 Windows 路径分隔符影响
  return new URL("./monaco/vs", window.location.href).toString();
}

export type MonacoBootstrapStatus = "pending" | "ready" | "failed";

export interface MonacoBootstrapState {
  status: MonacoBootstrapStatus;
  vsBaseUrl: string;
  loaderUrl: string;
  reason?: string;
  updatedAt: number;
}

type MonacoBootstrapListener = (state: MonacoBootstrapState) => void;

const MONACO_LOADER_PROBE_TIMEOUT_MS = 4000;

const vsBaseUrl = resolveVsBaseUrl();
const loaderUrl = new URL(
  "loader.js",
  `${vsBaseUrl.replace(/\/+$/, "")}/`,
).toString();

let bootstrapState: MonacoBootstrapState = {
  status: "pending",
  vsBaseUrl,
  loaderUrl,
  updatedAt: Date.now(),
};

const listeners = new Set<MonacoBootstrapListener>();

function setBootstrapState(
  status: MonacoBootstrapStatus,
  reason?: string,
): void {
  bootstrapState = {
    status,
    reason,
    vsBaseUrl,
    loaderUrl,
    updatedAt: Date.now(),
  };
  for (const listener of listeners) {
    listener(bootstrapState);
  }
}

export function getMonacoBootstrapState(): MonacoBootstrapState {
  return bootstrapState;
}

export function subscribeMonacoBootstrapState(
  listener: MonacoBootstrapListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function probeMonacoLoader(): Promise<void> {
  const protocol = new URL(loaderUrl).protocol;
  if (protocol === "file:") {
    setBootstrapState("ready");
    console.info("[MonacoInit] skip loader probe for file protocol", {
      vsBaseUrl,
      loaderUrl,
    });
    return;
  }

  try {
    const response = await withTimeout(
      fetch(loaderUrl, { method: "GET", cache: "no-store" }),
      MONACO_LOADER_PROBE_TIMEOUT_MS,
    );
    if (response.ok) {
      setBootstrapState("ready");
      console.info("[MonacoInit] loader probe success", {
        vsBaseUrl,
        loaderUrl,
      });
      return;
    }
    const reason = `HTTP ${response.status}`;
    setBootstrapState("failed", reason);
    console.error("[MonacoInit] loader probe failed", {
      vsBaseUrl,
      loaderUrl,
      reason,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    setBootstrapState("failed", reason);
    console.error("[MonacoInit] loader probe failed", {
      vsBaseUrl,
      loaderUrl,
      reason,
    });
  }
}

loader.config({
  paths: {
    vs: vsBaseUrl,
  },
});

void probeMonacoLoader();
