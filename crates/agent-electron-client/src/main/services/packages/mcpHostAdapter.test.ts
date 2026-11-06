import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const mocks = vi.hoisted(() => ({ bundled: vi.fn<() => string | null>() }));
vi.mock("./packageLocator", () => ({ getBundledMcpProxyDir: mocks.bundled }));

let directory: string;
let bundled: string;
function prepareResource(target: string) {
  const packageDir = path.dirname(
    createRequire(import.meta.url).resolve(
      "@nuwax-ai/mcp-proxy-ts/package.json",
    ),
  );
  cpSync(
    path.join(packageDir, "dist", "host"),
    path.join(target, "dist", "host"),
    { recursive: true },
  );
  writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ type: "module" }),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NUWAX_MCP_PROXY_LOCAL_PATH", undefined);
  directory = mkdtempSync(path.join(os.tmpdir(), "mcp-host-adapter-"));
  bundled = path.join(directory, "resource");
  prepareResource(bundled);
  mocks.bundled.mockReturnValue(bundled);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("MCP host adapter resource loading", () => {
  it("从打包资源的原生 ESM 加载真实改写器，并保留配置与工具过滤", async () => {
    const { loadHostAdapter } = await import("./mcpHostAdapter");
    const host = loadHostAdapter();
    const result = host.rewriteServersToProxyCommands(
      {
        sample: { command: "node", args: ["server.js"], allowTools: ["read"] },
      },
      {
        proxyScriptPath: "/fixture/proxy.js",
        nodeBinPath: "/fixture/node",
        configDir: path.join(directory, "configs"),
      },
    );
    const configIndex = result!.sample.args.indexOf("--config-file");
    const configPath = result!.sample.args[configIndex + 1];
    expect(result!.sample.command).toBe("/fixture/node");
    expect(result!.sample.args).toContain("--allow-tools");
    expect(result!.sample.args).toContain("read");
    expect(existsSync(configPath)).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      mcpServers: {
        sample: { command: "node", args: ["server.js"], allowTools: ["read"] },
      },
    });
    expect(loadHostAdapter()).toBe(host);
  });

  it("资源缺失时给出准备指令，补齐后可以重新加载", async () => {
    const { loadHostAdapter } = await import("./mcpHostAdapter");
    mocks.bundled.mockReturnValue(null);
    expect(() => loadHostAdapter()).toThrow("prepare:mcp-proxy");
    const missing = path.join(directory, "missing");
    mkdirSync(missing);
    mocks.bundled.mockReturnValue(missing);
    expect(() => loadHostAdapter()).toThrow("Host adapter missing:");
    mocks.bundled.mockReturnValue(bundled);
    expect(loadHostAdapter().rewriteServersToProxyCommands).toBeTypeOf(
      "function",
    );
  });

  it("有效的本地开发覆盖优先于打包资源，无效覆盖回退到资源", async () => {
    const local = path.join(directory, "local");
    prepareResource(local);
    vi.stubEnv("NUWAX_MCP_PROXY_LOCAL_PATH", local);
    const first = await import("./mcpHostAdapter");
    expect(first.loadHostAdapter().rewriteServersToProxyCommands).toBeTypeOf(
      "function",
    );
    expect(mocks.bundled).not.toHaveBeenCalled();
    vi.resetModules();
    vi.stubEnv("NUWAX_MCP_PROXY_LOCAL_PATH", path.join(directory, "absent"));
    const second = await import("./mcpHostAdapter");
    expect(second.loadHostAdapter().rewriteServersToProxyCommands).toBeTypeOf(
      "function",
    );
    expect(mocks.bundled).toHaveBeenCalledOnce();
  });
});
