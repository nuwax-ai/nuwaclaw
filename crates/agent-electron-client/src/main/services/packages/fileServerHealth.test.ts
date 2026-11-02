/**
 * 单元测试：file-server 健康检查（单次探测 + 轮询就绪）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

const mockRequest = vi.fn();

vi.mock("http", () => ({
  default: {
    request: (...args: unknown[]) => mockRequest(...args),
  },
}));

vi.mock("../constants", () => ({
  LOCALHOST_HOSTNAME: "127.0.0.1",
}));

import {
  checkFileServerHealth,
  waitForFileServerHealth,
} from "./fileServerHealth";

type MockRes = EventEmitter & { statusCode?: number };
type MockReq = EventEmitter & { end: () => void; destroy: () => void };

function makeOkRequest(body: unknown = { status: "ok" }) {
  return (_options: unknown, callback: (res: MockRes) => void): MockReq => {
    const res = new EventEmitter() as MockRes;
    res.statusCode = 200;
    const req = new EventEmitter() as MockReq;
    req.end = () => {
      queueMicrotask(() => {
        callback(res);
        res.emit("data", JSON.stringify(body));
        res.emit("end");
      });
    };
    req.destroy = () => {};
    return req;
  };
}

function makeErrorRequest(message: string) {
  return (): MockReq => {
    const req = new EventEmitter() as MockReq;
    req.end = () => {
      queueMicrotask(() => {
        req.emit("error", new Error(message));
      });
    };
    req.destroy = () => {};
    return req;
  };
}

describe("checkFileServerHealth", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("returns healthy when /health status is ok", async () => {
    mockRequest.mockImplementation(makeOkRequest({ status: "ok" }));
    const result = await checkFileServerHealth(60015);
    expect(result).toEqual({ healthy: true });
  });

  it("returns unhealthy on connection error", async () => {
    mockRequest.mockImplementation(makeErrorRequest("ECONNREFUSED"));
    const result = await checkFileServerHealth(60015);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("waitForFileServerHealth", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves healthy on first successful /health", async () => {
    mockRequest.mockImplementation(makeOkRequest({ status: "ok" }));
    const result = await waitForFileServerHealth(60015, 1000, 10);
    expect(result).toEqual({ healthy: true });
    expect(mockRequest).toHaveBeenCalled();
  });

  it("retries until the server becomes healthy", async () => {
    mockRequest
      .mockImplementationOnce(makeErrorRequest("ECONNREFUSED"))
      .mockImplementationOnce(makeErrorRequest("ECONNREFUSED"))
      .mockImplementation(makeOkRequest({ status: "ok" }));

    const result = await waitForFileServerHealth(60015, 5000, 10);
    expect(result).toEqual({ healthy: true });
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it("returns unhealthy when health never becomes ok within timeout", async () => {
    mockRequest.mockImplementation(makeErrorRequest("ECONNREFUSED"));
    const result = await waitForFileServerHealth(60015, 80, 10);
    expect(result.healthy).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
