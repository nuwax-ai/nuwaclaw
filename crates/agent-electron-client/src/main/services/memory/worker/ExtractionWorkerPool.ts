/**
 * Extraction Worker Pool
 *
 * 管理 extractionWorker.ts 的生命周期，将 CPU 密集型的正则/评分提取
 * 路由到独立 Worker 线程，避免主线程阻塞。
 *
 * 设计约束：
 *  - 单 Worker 实例（内存提取串行化，无竞态）
 *  - Worker 崩溃时自动重建，pending 任务全部拒绝（保守策略）
 *  - destroy() 后拒绝所有后续调用
 */

import { Worker } from "worker_threads";
import * as path from "path";
import log from "electron-log";
import type { ExtractedMemory } from "../types";

// ==================== Types ====================

interface PendingTask {
  resolve: (memories: ExtractedMemory[]) => void;
  reject: (error: Error) => void;
}

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

// ==================== ExtractionWorkerPool ====================

export class ExtractionWorkerPool {
  private worker: Worker | null = null;
  private pendingTasks = new Map<string, PendingTask>();
  private destroyed = false;
  private taskCounter = 0;

  /**
   * 在 Worker 线程中执行记忆提取（正则+评分）。
   * 返回 Promise，在 Worker 回复后 resolve/reject。
   */
  async extract(
    messages: Array<{ role: string; content: string }>,
    options?: {
      explicitEnabled?: boolean;
      implicitEnabled?: boolean;
      guardLevel?: "strict" | "standard" | "relaxed";
    },
  ): Promise<ExtractedMemory[]> {
    if (this.destroyed) {
      return Promise.reject(
        new Error("ExtractionWorkerPool has been destroyed"),
      );
    }

    if (!this.worker) {
      this._startWorker();
    }

    const taskId = `task-${++this.taskCounter}-${Date.now()}`;

    return new Promise<ExtractedMemory[]>((resolve, reject) => {
      this.pendingTasks.set(taskId, { resolve, reject });

      const req: WorkerRequest = { taskId, messages, options };
      this.worker!.postMessage(req);
    });
  }

  /**
   * 停止 Worker，拒绝所有 pending 任务，不再接受新任务。
   */
  destroy(): void {
    this.destroyed = true;
    this._terminateWorker("Pool destroyed");
    log.info("[ExtractionWorkerPool] Destroyed");
  }

  // ==================== Private ====================

  private _startWorker(): void {
    // Worker 脚本在编译后为 .js，路径与当前文件同目录的 worker/ 子目录
    const workerPath = path.join(__dirname, "extractionWorker.js");

    this.worker = new Worker(workerPath, {
      workerData: { logPrefix: "[ExtractionWorker]" },
    });

    this.worker.on("message", (resp: WorkerResponse) => {
      const pending = this.pendingTasks.get(resp.taskId);
      if (!pending) return;
      this.pendingTasks.delete(resp.taskId);

      if (resp.error) {
        pending.reject(new Error(resp.error));
      } else {
        pending.resolve(resp.memories ?? []);
      }
    });

    this.worker.on("error", (err) => {
      log.error("[ExtractionWorkerPool] Worker error:", err);
      this._terminateWorker(`Worker error: ${err.message}`);
    });

    this.worker.on("exit", (code) => {
      if (code !== 0) {
        log.warn(`[ExtractionWorkerPool] Worker exited with code ${code}`);
        this._terminateWorker(`Worker exited with code ${code}`);
      }
    });

    log.info("[ExtractionWorkerPool] Worker started:", workerPath);
  }

  private _terminateWorker(reason: string): void {
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.terminate().catch(() => {});
      this.worker = null;
    }

    // 拒绝所有 pending 任务
    if (this.pendingTasks.size > 0) {
      const err = new Error(`Worker terminated: ${reason}`);
      for (const pending of this.pendingTasks.values()) {
        pending.reject(err);
      }
      this.pendingTasks.clear();
    }
  }
}

/** 进程级单例 */
export const extractionWorkerPool = new ExtractionWorkerPool();
