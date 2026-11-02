import { describe, expect, it, vi } from "vitest";
import { stopManagedProcesses } from "./stopManagedProcesses";

describe("shutdown managed processes", () => {
  it("waits for every process to confirm exit", async () => {
    let finish!: (value: { success: boolean }) => void;
    const delayed = new Promise<{ success: boolean }>((resolve) => {
      finish = resolve;
    });
    let done = false;
    const stop = vi.fn(() => delayed);
    const shutdown = stopManagedProcesses([
      { stopAsync: stop },
      { stopAsync: async () => ({ success: true }) },
    ]).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    finish({ success: true });
    await shutdown;
    expect(done).toBe(true);
  });
  it("attempts all stops and reports failure instead of claiming all stopped", async () => {
    const other = vi.fn(async () => ({ success: true }));
    await expect(
      stopManagedProcesses([
        { stopAsync: async () => ({ success: false, message: "still alive" }) },
        { stopAsync: other },
      ]),
    ).rejects.toThrow("still alive");
    expect(other).toHaveBeenCalledOnce();
  });
});
