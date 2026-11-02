import { open } from "node:fs/promises";

const DEFAULT_LOG_LIST = 2000;
const MAX_LOG_LIST = 10000;
const READ_CHUNK_BYTES = 64 * 1024;
/** 单次查询最多扫描 4 MiB；更早的完整日志仍可从日志目录查看。 */
export const MAX_LOG_TAIL_BYTES = 4 * 1024 * 1024;

/**
 * 从文件尾部异步读取非空日志行，保留时间顺序及按行 offset 的分页语义。
 * 不解码整个文件；达到字节预算时丢弃左侧被截断的行，避免 UTF-8 半字符。
 */
export async function readLogTail(
  logPath: string,
  count: number = DEFAULT_LOG_LIST,
  offset: number = 0,
): Promise<string[]> {
  const limit = Number.isFinite(count)
    ? Math.min(Math.max(1, Math.floor(count)), MAX_LOG_LIST)
    : DEFAULT_LOG_LIST;
  const safeOffset = Number.isFinite(offset)
    ? Math.max(0, Math.floor(offset))
    : 0;

  let file;
  try {
    file = await open(logPath, "r");
  } catch (error) {
    // 轮转/跨日切换可能恰好移走文件，下次刷新会重新打开当前路径。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  try {
    let position = (await file.stat()).size;
    let totalBytes = 0;
    let completeLines = 0;
    let hasLineBytes = false;
    const chunks: Buffer[] = [];

    while (
      position > 0 &&
      totalBytes < MAX_LOG_TAIL_BYTES &&
      completeLines < safeOffset + limit
    ) {
      const length = Math.min(
        position,
        READ_CHUNK_BYTES,
        MAX_LOG_TAIL_BYTES - totalBytes,
      );
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, position);
      // 文件在查询中被截短：本轮不拼接不连续的字节，下次刷新重试。
      if (bytesRead !== length) return [];
      chunks.push(chunk);
      totalBytes += bytesRead;
      for (let i = bytesRead - 1; i >= 0; i--) {
        if (chunk[i] === 0x0a) {
          if (hasLineBytes) completeLines++;
          hasLineBytes = false;
        } else {
          hasLineBytes = true;
        }
      }
    }

    const content = Buffer.concat(chunks.reverse(), totalBytes);
    // 非文件开头的第一个片段可能只有半行；先按字节跳过再解码。
    const start = position > 0 ? content.indexOf(0x0a) + 1 : 0;
    if (position > 0 && start === 0) return [];
    const lines = content
      .subarray(start)
      .toString("utf-8")
      .split("\n")
      .filter(Boolean);
    const end = Math.max(0, lines.length - safeOffset);
    return lines.slice(Math.max(0, end - limit), end);
  } finally {
    await file.close();
  }
}
