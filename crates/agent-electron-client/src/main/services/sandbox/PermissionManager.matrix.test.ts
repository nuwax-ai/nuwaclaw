import { describe, expect, it, vi } from "vitest";
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
import { PermissionManager } from "./PermissionManager";

describe("PermissionManager matrix behavior", () => {
  it("should allow safe commands from safeCommands allowlist", async () => {
    const manager = new PermissionManager();
    const result = await manager.checkPermission(
      "sess-safe",
      "command:execute",
      "git status",
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("Safe command");
  });

  it("should block dangerous commands from blacklist patterns", async () => {
    const manager = new PermissionManager();
    const result = await manager.checkPermission(
      "sess-danger",
      "command:execute",
      "sudo ls /",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("危险操作");
  });

  it("should block sensitive ssh paths", async () => {
    const manager = new PermissionManager();
    const result = await manager.checkPermission(
      "sess-path",
      "file:read",
      "/Users/demo/.ssh/id_rsa",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSH");
  });

  it("should block denied permission types", async () => {
    const manager = new PermissionManager();
    const result = await manager.checkPermission(
      "sess-deny",
      "package:install:system",
      "apt-get install vim",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("被安全策略禁止");
  });
});
