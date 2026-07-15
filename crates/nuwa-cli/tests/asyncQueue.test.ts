import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../src/core/serve/asyncQueue.js";

describe("AsyncQueue", () => {
  it("resolves next() immediately when an item was already pushed", async () => {
    const q = new AsyncQueue<string>();
    q.push("a");
    expect(await q.next()).toBe("a");
  });

  it("preserves FIFO order across multiple pushes", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    expect(await q.next()).toBe(1);
    expect(await q.next()).toBe(2);
    expect(await q.next()).toBe(3);
  });

  it("resolves a pending next() as soon as an item is pushed later", async () => {
    const q = new AsyncQueue<string>();
    const pending = q.next();
    q.push("late");
    expect(await pending).toBe("late");
  });

  it("close() makes a pending next() resolve to undefined", async () => {
    const q = new AsyncQueue<string>();
    const pending = q.next();
    q.close();
    expect(await pending).toBeUndefined();
  });

  it("next() after close() (with nothing queued) resolves to undefined immediately", async () => {
    const q = new AsyncQueue<string>();
    q.close();
    expect(await q.next()).toBeUndefined();
  });

  it("still drains items queued before close() was called", async () => {
    const q = new AsyncQueue<string>();
    q.push("a");
    q.close();
    expect(await q.next()).toBe("a");
    expect(await q.next()).toBeUndefined();
  });
});
