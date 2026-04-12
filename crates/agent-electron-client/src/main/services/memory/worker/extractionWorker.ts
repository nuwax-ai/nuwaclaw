/**
 * Memory Extraction Worker Thread
 *
 * 在独立线程中运行 CPU 密集型的记忆提取（正则匹配、评分）。
 * 将 MemoryExtractor 的同步计算从主线程 Event Loop 中解耦，
 * 避免长会话结束时的界面卡顿。
 *
 * 通信协议（postMessage）：
 *   Request  → { taskId, messages, options }
 *   Response → { taskId, memories? , error? }
 */

import { parentPort, workerData } from "worker_threads";

// Worker 启动参数（由 ExtractionWorkerPool 传入）
const _workerData = workerData as { logPrefix?: string };
const LOG_PREFIX = _workerData?.logPrefix ?? "[ExtractionWorker]";

// Worker 内使用 console 而非 electron-log（electron-log 不支持 worker_threads）
function workerLog(level: "info" | "warn" | "error", ...args: unknown[]) {
  console[level](LOG_PREFIX, ...args);
}

if (!parentPort) {
  throw new Error("extractionWorker must run inside a worker_threads context");
}

// ==================== 导入提取逻辑 ====================
// 注意：Worker 中不能使用 Electron API，仅使用纯 Node.js 模块

// 动态导入以避免 Worker 加载时拉入 Electron 依赖
// MemoryExtractor 仅依赖正则/评分工具，不依赖 Electron
import type { ExtractedMemory } from "../types";

// 同步加载提取器（Worker 启动时执行一次）
let extractFn:
  | ((
      messages: Array<{ role: string; content: string }>,
      options?: {
        explicitEnabled?: boolean;
        implicitEnabled?: boolean;
        guardLevel?: "strict" | "standard" | "relaxed";
      },
    ) => Promise<ExtractedMemory[]>)
  | null = null;

async function loadExtractor() {
  try {
    // 使用相对路径动态导入（Worker 的 __dirname 与主线程相同）
    const { MemoryExtractor } = await import("../MemoryExtractor");
    const instance = new MemoryExtractor();
    extractFn = instance.extract.bind(instance);
    workerLog("info", "MemoryExtractor loaded");
  } catch (e) {
    workerLog("error", "Failed to load MemoryExtractor:", e);
    throw e;
  }
}

// ==================== 消息处理 ====================

interface WorkerRequest {
  taskId: string;
  messages: Array<{ role: string; content: string }>;
  options?: {
    explicitEnabled?: boolean;
    implicitEnabled?: boolean;
    guardLevel?: "strict" | "standard" | "relaxed";
  };
}

interface WorkerResponse {
  taskId: string;
  memories?: ExtractedMemory[];
  error?: string;
}

parentPort.on("message", async (req: WorkerRequest) => {
  const { taskId, messages, options } = req;

  try {
    if (!extractFn) {
      await loadExtractor();
    }

    const memories = await extractFn!(messages, options);
    const response: WorkerResponse = { taskId, memories };
    parentPort!.postMessage(response);
  } catch (e) {
    workerLog("error", `Task ${taskId} failed:`, e);
    const response: WorkerResponse = {
      taskId,
      error: e instanceof Error ? e.message : String(e),
    };
    parentPort!.postMessage(response);
  }
});

// 初始化时预加载提取器（减少首次任务延迟）
loadExtractor().catch((e) => {
  workerLog("error", "Pre-load failed:", e);
});
