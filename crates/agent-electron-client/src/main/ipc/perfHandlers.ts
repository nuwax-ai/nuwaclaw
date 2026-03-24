import { ipcMain } from "electron";
import { getPerfLogger } from "../bootstrap/logConfig";

export function registerPerfHandlers(): void {
  // 渲染进程 fire-and-forget（ipcMain.on，无返回值）
  ipcMain.on("perf:log", (_event, msg: unknown) => {
    if (typeof msg !== "string") return;
    getPerfLogger().info(msg);
  });
}

/**
 * 创建 fileServer stdout 解析器，追踪 create-workspace 请求耗时并写入 perf 日志。
 *
 * stdout 日志格式（来自 nuwax-file-server）：
 *   POST-[requestId] -请求 /api/computer/create-workspace
 *   POST-[requestId] -响应(200) /api/computer/create-workspace
 *
 * 返回的回调传入 ManagedProcess.start({ onStdoutLine }) 即可。
 * 注：Map 条目在正常请求/响应配对后自动删除；若 fileServer 异常重启导致响应缺失，
 *     少量孤立 key 会随 onStdoutLine 闭包一起被 GC，不存在全局泄漏。
 */
export function createFileServerPerfHandler(): (chunk: string) => void {
  const startMap = new Map<string, number>();
  return (chunk: string): void => {
    for (const line of chunk.split("\n")) {
      const reqMatch = line.match(
        /POST-(\[\S+\])\s+-请求\s+\/api\/computer\/create-workspace/,
      );
      if (reqMatch) {
        startMap.set(reqMatch[1], Date.now());
        continue;
      }
      const resMatch = line.match(
        /POST-(\[\S+\])\s+-响应\(\d+\)\s+\/api\/computer\/create-workspace/,
      );
      if (resMatch) {
        const start = startMap.get(resMatch[1]);
        if (start !== undefined) {
          startMap.delete(resMatch[1]);
          getPerfLogger().info(
            `[PERF] create-workspace: ${Date.now() - start}ms  rid=${resMatch[1]}`,
          );
        }
      }
    }
  };
}
