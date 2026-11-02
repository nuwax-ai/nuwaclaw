/**
 * parseHttpJsonBody UTF-8 分块解析单测
 *
 * 回归：body += chunk 会在 HTTP chunk 边界切断多字节字符，导致中文变成/?。
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import type { IncomingMessage } from "http";
import { parseHttpJsonBody } from "./parseHttpJsonBody";

function mockIncomingMessage(chunks: Buffer[]): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.destroy = (() => req) as IncomingMessage["destroy"];
  queueMicrotask(() => {
    for (const chunk of chunks) {
      req.emit("data", chunk);
    }
    req.emit("end");
  });
  return req;
}

describe("parseHttpJsonBody", () => {
  it("preserves Chinese when body arrives in small UTF-8 chunks", async () => {
    const payload = {
      user_id: "u1",
      prompt: "你好",
      system_prompt:
        "你是 deepagents-flow-ts 助手，可用工具：get_weather:根据城市查询天气",
    };
    const raw = Buffer.from(JSON.stringify(payload), "utf-8");

    const chunks: Buffer[] = [];
    for (let i = 0; i < raw.length; i += 7) {
      chunks.push(raw.subarray(i, i + 7));
    }
    expect(chunks.length).toBeGreaterThan(1);

    const parsed = (await parseHttpJsonBody(
      mockIncomingMessage(chunks),
    )) as typeof payload;
    expect(parsed.prompt).toBe("你好");
    expect(parsed.system_prompt).toBe(payload.system_prompt);
  });

  it("returns empty object for empty body", async () => {
    const parsed = await parseHttpJsonBody(mockIncomingMessage([]));
    expect(parsed).toEqual({});
  });

  it("rejects when body exceeds maxBodySize", async () => {
    const chunk = Buffer.from('{"a":1}', "utf-8");
    await expect(
      parseHttpJsonBody(mockIncomingMessage([chunk]), { maxBodySize: 3 }),
    ).rejects.toThrow("Request body too large");
  });

  it("rejects invalid JSON", async () => {
    const bad = Buffer.from("{not-json", "utf-8");
    await expect(
      parseHttpJsonBody(mockIncomingMessage([bad])),
    ).rejects.toThrow();
  });
});
