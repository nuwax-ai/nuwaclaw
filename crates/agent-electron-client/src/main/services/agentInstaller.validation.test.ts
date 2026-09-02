/**
 * Unit tests: agentInstaller download artifact validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./system/appPaths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./system/appPaths")>()),
  getAppDataDir: () => "/tmp/nuwaclaw-test",
}));

import {
  inspectDownloadedArtifact,
  isNonRetryableDownloadError,
} from "./agentInstaller";

describe("inspectDownloadedArtifact", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-installer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws API error for JSON 4010 response and removes bad file", () => {
    const filePath = path.join(tmpDir, "bad.zip");
    const url =
      "https://testagent.example.com/api/f/s3/agent_package/20260627/test.zip";
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        code: "4010",
        message: "未登录或登录超时",
        success: false,
      }),
    );

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url,
        contentType: "application/json",
      }),
    ).toThrow(
      /Download returned API error \(4010\): 未登录或登录超时.*url=.*content-type=application\/json/s,
    );
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("accepts valid zip magic bytes", () => {
    const filePath = path.join(tmpDir, "good.zip");
    fs.writeFileSync(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
      }),
    ).not.toThrow();
  });

  it("accepts valid gzip magic bytes for tar.gz url", () => {
    const filePath = path.join(tmpDir, "good.tar.gz");
    fs.writeFileSync(filePath, Buffer.from([0x1f, 0x8b, 0x08, 0x00]));

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.tar.gz",
      }),
    ).not.toThrow();
  });

  it("rejects .zip url when content is JSON API error", () => {
    const filePath = path.join(tmpDir, "fake.zip");
    fs.writeFileSync(
      filePath,
      '{"code":"4010","message":"not logged in","success":false}',
    );

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
      }),
    ).toThrow(/Download returned API error \(4010\)/);
  });

  it("rejects content-type application/json without archive magic", () => {
    const filePath = path.join(tmpDir, "plain.txt");
    fs.writeFileSync(filePath, "not-json-and-not-archive");

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
        contentType: "application/json",
      }),
    ).toThrow(
      /Download content-type mismatch: expected archive, got application\/json/,
    );
  });

  it("rejects empty downloaded file", () => {
    const filePath = path.join(tmpDir, "empty.zip");
    fs.writeFileSync(filePath, "");

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
      }),
    ).toThrow(/Downloaded file is empty/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("rejects invalid zip magic for .zip url", () => {
    const filePath = path.join(tmpDir, "garbage.zip");
    fs.writeFileSync(filePath, "not-json-and-not-archive");

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
      }),
    ).toThrow(/Downloaded file is not a valid zip \(magic=/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("does not treat JSON with message-only as API error", () => {
    const filePath = path.join(tmpDir, "config.zip");
    fs.writeFileSync(filePath, '{"message":"hello"}');

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
      }),
    ).toThrow(/Downloaded file is not a valid zip/);
  });

  it("does not treat success JSON as API error", () => {
    const filePath = path.join(tmpDir, "success.zip");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ code: "0000", message: "ok", success: true }),
    );

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
        contentType: "application/json",
      }),
    ).toThrow(
      /Download content-type mismatch: expected archive, got application\/json/,
    );
  });

  it("keeps file when deleteOnFailure is false", () => {
    const filePath = path.join(tmpDir, "keep.zip");
    fs.writeFileSync(
      filePath,
      '{"code":"4010","message":"auth failed","success":false}',
    );

    expect(() =>
      inspectDownloadedArtifact(filePath, {
        url: "https://example.com/agent.zip",
        deleteOnFailure: false,
      }),
    ).toThrow(/Download returned API error \(4010\)/);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("isNonRetryableDownloadError", () => {
  it("returns true for API auth errors", () => {
    expect(
      isNonRetryableDownloadError(
        "Download returned API error (4010): 未登录或登录超时 [url=https://example.com/pkg.zip]",
      ),
    ).toBe(true);
  });

  it("returns true for content-type and magic validation errors", () => {
    expect(
      isNonRetryableDownloadError(
        "Download content-type mismatch: expected archive, got application/json",
      ),
    ).toBe(true);
    expect(
      isNonRetryableDownloadError(
        "Downloaded file is not a valid zip (magic=7b22636f)",
      ),
    ).toBe(true);
  });

  it("returns false for transient network errors", () => {
    expect(isNonRetryableDownloadError("Download timeout")).toBe(false);
    expect(isNonRetryableDownloadError("HTTP 500: Internal Server Error")).toBe(
      false,
    );
  });
});
