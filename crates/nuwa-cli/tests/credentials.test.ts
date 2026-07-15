import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("credentials", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-creds-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("readCredentials returns {} when the file doesn't exist yet", async () => {
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials()).toEqual({});
  });

  it("writeCredentials creates the file with 0600 permissions", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({ domain: "https://example.com", savedKey: "sk" });
    const filePath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("updateCredentials merges into the existing file rather than replacing it", async () => {
    const { writeCredentials, updateCredentials, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({ domain: "https://example.com", username: "alice" });
    updateCredentials({ savedKey: "sk-1" });
    expect(readCredentials()).toEqual({
      domain: "https://example.com",
      username: "alice",
      savedKey: "sk-1",
    });
  });

  it("stores and resolves savedKey by domain + username without SQLite", async () => {
    const {
      writeCredentials,
      getSavedKeyForAccount,
      rememberSavedKeyForAccount,
      savedKeyAccountKey,
    } = await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "global-key",
      savedKeys: {
        [savedKeyAccountKey("https://example.com", "bob")]: "bob-key",
      },
    });

    expect(getSavedKeyForAccount("https://example.com", "bob")).toBe("bob-key");
    expect(getSavedKeyForAccount("https://example.com", "alice")).toBe(
      "global-key",
    );
    expect(getSavedKeyForAccount("https://example.com", "charlie")).toBe(
      undefined,
    );
    expect(
      rememberSavedKeyForAccount("https://example.com", "alice", "alice-key"),
    ).toMatchObject({
      [savedKeyAccountKey("https://example.com", "bob")]: "bob-key",
      [savedKeyAccountKey("https://example.com", "alice")]: "alice-key",
    });
  });

  it("readCredentials returns {} for a corrupted file instead of throwing", async () => {
    const filePath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not json");
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials()).toEqual({});
  });

  it("clearSessionKeepingSavedKey drops token/lastRegAt but keeps domain/username/computerName/savedKey", async () => {
    const { writeCredentials, clearSessionKeepingSavedKey, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "我的电脑001",
      savedKey: "sk-1",
      savedKeys: { "example.com_alice": "sk-1" },
      token: "one-shot-token",
      lastRegAt: "2026-01-01T00:00:00.000Z",
    });
    clearSessionKeepingSavedKey();
    expect(readCredentials()).toEqual({
      domain: "https://example.com",
      username: "alice",
      computerName: "我的电脑001",
      savedKey: "sk-1",
      savedKeys: { "example.com_alice": "sk-1" },
    });
  });
});
