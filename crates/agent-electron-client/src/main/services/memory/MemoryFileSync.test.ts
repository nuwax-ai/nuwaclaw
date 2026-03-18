/**
 * 单元测试: MemoryFileSync — destroy 竞态修复 & processPendingSync 守卫
 *
 * 覆盖内容：
 * - destroy() 先设 initialized=false，再清理 timers 和 watcher
 * - processPendingSync() 在 initialized=false 时提前返回
 * - destroy() 后 debounce 定时器触发不会导致错误
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    })),
  },
}));

vi.mock("./utils/hash", () => ({
  calculateHash: vi.fn((s: string) => `hash_${s.length}`),
}));

vi.mock("./utils/chunker", () => ({
  chunkMarkdown: vi.fn(() => []),
  compareChunks: vi.fn(() => ({ added: [], removed: [], unchanged: [] })),
}));

import { MemoryFileSync } from "./MemoryFileSync";
import * as fs from "fs";

describe("MemoryFileSync — destroy race condition", () => {
  let sync: MemoryFileSync;

  beforeEach(() => {
    vi.useFakeTimers();
    sync = new MemoryFileSync();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroy() sets initialized=false before clearing timers", () => {
    // Track the order of operations via spying
    const states: boolean[] = [];

    // Init with minimal mocks
    (sync as any).workspaceDir = "/tmp/test";
    (sync as any).database = {
      setSyncState: vi.fn(),
      getFileHash: vi.fn(),
      getSyncState: vi.fn(),
    };
    (sync as any).initialized = true;

    // Spy on clearAllTimers to record initialized state when it's called
    const origClearAllTimers = (sync as any).clearAllTimers.bind(sync);
    (sync as any).clearAllTimers = () => {
      states.push((sync as any).initialized);
      origClearAllTimers();
    };

    sync.destroy();

    // clearAllTimers should have been called when initialized was already false
    expect(states).toEqual([false]);
    expect(sync.isInitialized()).toBe(false);
  });

  it("processPendingSync returns early when initialized=false", async () => {
    (sync as any).workspaceDir = "/tmp/test";
    (sync as any).database = {
      setSyncState: vi.fn(),
      deleteBySourcePath: vi.fn(),
      deleteFileHash: vi.fn(),
    };
    (sync as any).initialized = false;

    // Set up a pending sync that would normally be processed
    (sync as any).pendingSyncs.set("/tmp/test/file.md", {
      filePath: "/tmp/test/file.md",
      eventType: "change",
      timestamp: Date.now(),
    });

    // syncFile would throw if actually called on uninitialized state
    const syncFileSpy = vi
      .spyOn(sync as any, "syncFile")
      .mockRejectedValue(new Error("should not be called"));

    await (sync as any).processPendingSync("/tmp/test/file.md");

    // syncFile should NOT have been called
    expect(syncFileSpy).not.toHaveBeenCalled();
    // pending sync should still be in the map (not consumed)
    expect((sync as any).pendingSyncs.has("/tmp/test/file.md")).toBe(true);
  });

  it("debounced sync after destroy does not process", async () => {
    (sync as any).workspaceDir = "/tmp/test";
    (sync as any).database = {
      setSyncState: vi.fn(),
    };
    (sync as any).initialized = true;
    (sync as any).debounceMs = 100;

    // Trigger debounced sync
    (sync as any).debounceSync("/tmp/test/MEMORY.md", "change");

    // Destroy before debounce fires
    sync.destroy();

    // The debounce timer should have been cleared by destroy
    // Advancing time should not trigger any processing
    const syncFileSpy = vi.spyOn(sync as any, "syncFile").mockResolvedValue({});
    vi.advanceTimersByTime(200);

    expect(syncFileSpy).not.toHaveBeenCalled();
  });
});
