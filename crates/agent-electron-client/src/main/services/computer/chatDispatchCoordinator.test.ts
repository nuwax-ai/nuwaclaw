import { describe, it, expect, beforeEach } from "vitest";
import {
  ChatDispatchCoordinator,
  resolveChatDispatchKey,
} from "./chatDispatchCoordinator";

describe("resolveChatDispatchKey", () => {
  it("prefers agent_work_dir then project_id", () => {
    expect(
      resolveChatDispatchKey({
        user_id: "u1",
        agent_work_dir: "1554103",
        project_id: "other",
        prompt: "hi",
      } as any),
    ).toBe("1554103");
    expect(
      resolveChatDispatchKey({
        user_id: "u1",
        project_id: "1554103",
        prompt: "hi",
      } as any),
    ).toBe("1554103");
  });
});

describe("ChatDispatchCoordinator", () => {
  let coordinator: ChatDispatchCoordinator;

  beforeEach(() => {
    coordinator = new ChatDispatchCoordinator();
  });

  it("only the latest bump is current for a key", () => {
    const gen1 = coordinator.bumpArrival("project-a", "rid-1");
    const gen2 = coordinator.bumpArrival("project-a", "rid-2");

    expect(gen1).toBe(1);
    expect(gen2).toBe(2);
    expect(coordinator.isLatest("project-a", gen1)).toBe(false);
    expect(coordinator.isLatest("project-a", gen2)).toBe(true);
    expect(coordinator.isLatest("project-b", gen2)).toBe(false);
  });

  it("runDispatch serializes handlers per key", async () => {
    const order: string[] = [];
    const gen1 = coordinator.bumpArrival("project-a", "rid-1");
    let releaseFirst!: () => void;
    const firstBlock = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.runDispatch("project-a", gen1, async () => {
      order.push("first-start");
      await firstBlock;
      order.push("first-end");
      return "first";
    });

    await new Promise((resolve) => setImmediate(resolve));

    const gen2 = coordinator.bumpArrival("project-a", "rid-2");
    const second = coordinator.runDispatch(
      "project-a",
      gen2,
      async (isLatest) => {
        order.push("second-start");
        expect(isLatest()).toBe(true);
        order.push("second-end");
        return "second";
      },
    );

    releaseFirst();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
  });

  it("stale turn skips fn when superseded before slot", async () => {
    coordinator.bumpArrival("project-a", "rid-1");
    coordinator.bumpArrival("project-a", "rid-2");

    let ran = false;
    const result = await coordinator.runDispatch("project-a", 1, async () => {
      ran = true;
      return "ok";
    });

    expect(result).toBeUndefined();
    expect(ran).toBe(false);
  });
});
