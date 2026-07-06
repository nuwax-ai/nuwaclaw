/**
 * HTTP 请求体 JSON 解析（UTF-8 安全）
 *
 * 必须使用 Buffer.concat 后再 toString('utf-8')。
 * 若对 chunk 逐个 body += chunk，会在分包边界切断多字节 UTF-8 字符，
 * 导致中文在 Windows / lanproxy 小包场景下变成 ? 或 U+FFFD。
 */

import type { IncomingMessage } from "http";

const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

export interface ParseHttpJsonBodyOptions {
  /** 超过此字节数则拒绝请求；省略表示不限制 */
  maxBodySize?: number;
}

export function parseHttpJsonBody(
  req: IncomingMessage,
  options?: ParseHttpJsonBodyOptions,
): Promise<unknown> {
  const maxBodySize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodySize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });

    req.on("error", reject);
  });
}
