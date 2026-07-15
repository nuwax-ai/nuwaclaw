import * as net from "node:net";

export const CLI_AGENT_PORT = 60016;
export const CLI_FILE_SERVER_PORT = 60015;

export interface FindAvailablePortOptions {
  host?: string;
  maxAttempts?: number;
  exclude?: Iterable<number>;
}

function listenErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: string }).code)
    : undefined;
}

export async function isPortAvailable(
  port: number,
  host = "127.0.0.1",
): Promise<boolean> {
  await validateTcpPort(port);
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err) => {
      const code = listenErrorCode(err);
      if (code === "EADDRINUSE" || code === "EACCES") {
        resolve(false);
        return;
      }
      reject(err);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function findAvailablePort(
  preferredPort: number,
  options: FindAvailablePortOptions = {},
): Promise<number> {
  await validateTcpPort(preferredPort);
  const host = options.host ?? "127.0.0.1";
  const maxAttempts = options.maxAttempts ?? 100;
  const excluded = new Set(options.exclude ?? []);

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    if (excluded.has(candidate)) continue;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  throw new Error(
    `从端口 ${preferredPort} 起连续 ${maxAttempts} 个端口都不可用`,
  );
}

export async function validateTcpPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口必须是 1-65535 的整数，收到 ${port}`);
  }
}
