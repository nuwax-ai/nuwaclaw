import { describe, it, expect } from "vitest";
import * as net from "node:net";
import { findAvailablePort, isPortAvailable } from "../src/core/ports.js";

async function listen(port = 0): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return server;
}

async function close(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("ports", () => {
  it("detects an occupied port and finds the next available one", async () => {
    const server = await listen();
    try {
      const address = server.address();
      const occupied =
        typeof address === "object" && address ? address.port : 0;
      expect(await isPortAvailable(occupied)).toBe(false);
      expect(await findAvailablePort(occupied)).toBeGreaterThan(occupied);
    } finally {
      await close(server);
    }
  });

  it("skips excluded ports", async () => {
    const server = await listen();
    try {
      const address = server.address();
      const occupied =
        typeof address === "object" && address ? address.port : 0;
      const next = await findAvailablePort(occupied, {
        exclude: [occupied + 1],
      });
      expect(next).toBeGreaterThan(occupied + 1);
    } finally {
      await close(server);
    }
  });
});
