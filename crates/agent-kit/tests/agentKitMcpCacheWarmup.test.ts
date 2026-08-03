import { describe, expect, it, vi } from "vitest";
import {
  MCP_WARMUP_SPECS,
  packageNameFromSpec,
  runMcpCacheWarmup,
  type McpCacheWarmupState,
} from "../src/index.js";

const baseOptions = () => ({
  version: "1.0.0",
  npxDir: "/tmp/test-npx-cache",
  env: {},
  readState: (): McpCacheWarmupState | null => null,
  writeState: vi.fn(),
  pollIntervalMs: 1,
  killGraceMs: 1,
});

describe("agent-kit MCP cache warmup", () => {
  it("parses scoped and unscoped package specs", () => {
    expect(packageNameFromSpec("pkg@latest")).toBe("pkg");
    expect(packageNameFromSpec("@scope/pkg@1.2.3")).toBe("@scope/pkg");
  });

  it("skips when the host cannot resolve npx", async () => {
    const result = await runMcpCacheWarmup({
      ...baseOptions(),
      spawnNpx: null,
    });
    expect(result).toMatchObject({
      skipped: true,
      reason: "npx unavailable",
    });
  });

  it("trusts a matching marker only when every package is cached", async () => {
    const spawnNpx = vi.fn();
    const result = await runMcpCacheWarmup({
      ...baseOptions(),
      spawnNpx,
      readState: () => ({
        version: "1.0.0",
        npxDir: "/tmp/test-npx-cache",
        specs: [...MCP_WARMUP_SPECS],
        warmedAt: 1,
      }),
      isCached: () => true,
    });
    expect(result.reason).toBe("already warmed");
    expect(spawnNpx).not.toHaveBeenCalled();
  });

  it("warms serially, persists success and terminates each process", async () => {
    const cached = new Set<string>();
    const signals: NodeJS.Signals[] = [];
    const spawnNpx = vi.fn((spec: string) => {
      cached.add(packageNameFromSpec(spec));
      return {
        kill: (signal?: NodeJS.Signals) => {
          if (signal) signals.push(signal);
        },
        onClose: new Promise<number | null>(() => {}),
      };
    });
    const writeState = vi.fn();

    const result = await runMcpCacheWarmup({
      ...baseOptions(),
      spawnNpx,
      writeState,
      isCached: (_dir, packageName) => cached.has(packageName),
    });

    expect(result.warmed).toEqual([...MCP_WARMUP_SPECS]);
    expect(result.failed).toEqual([]);
    expect(spawnNpx).toHaveBeenCalledTimes(MCP_WARMUP_SPECS.length);
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGKILL");
    expect(writeState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1.0.0",
        specs: [...MCP_WARMUP_SPECS],
      }),
    );
  });
});
