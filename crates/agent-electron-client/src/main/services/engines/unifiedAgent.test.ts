/**
 * 单元测试: UnifiedAgentService — MCP 配置变更检测 + 懒加载引擎生命周期
 *
 * 覆盖修复内容：
 * 1. rawMcpServersEqual(): 静态辅助方法，同格式比较原始 MCP server 配置
 * 2. detectConfigChange(): 跨格式误判修复验证（通过 rawMcpServersEqual 间接覆盖）
 * 3. 懒加载引擎：init 触发 loadAcpSdk；getOrCreateEngine 创建/复用；destroy 清理引擎
 *
 * 背景：原实现将 proxy 包装格式（currentConfig.mcpServers, command=mcp-proxy）
 *      与原始格式（requestMcpServersEarly, command=uvx/uv/npx）直接比较，
 *      导致配置未变化时仍触发引擎重建（Windows 每次多花 13s）。
 *      修复后，两侧均使用原始格式做同格式比较。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const sandboxPolicyState = {
  current: {
    enabled: true,
    backend: "auto",
    mode: "compat",
    autoFallback: "startup-only",
    windowsMode: "workspace-write",
  },
};

// ───── 必需 Mocks（防止导入链拉起 Electron / IPC 等重模块）──────────────────

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock/appdata"),
    getAppPath: vi.fn(() => "/mock/app"),
    isPackaged: false,
  },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}));

vi.mock("../system/dependencies", () => ({
  default: {
    getAppDataDir: vi.fn(() => "/mock/appdata"),
  },
  getAppEnv: vi.fn(() => ({
    PATH: "/mock/path",
    HOME: "/mock/home",
  })),
  getNodeBinPathWithFallback: vi.fn(() => "/mock/node"),
}));

vi.mock("../memory", () => ({
  memoryService: {
    isInitialized: vi.fn(() => false),
    init: vi.fn().mockResolvedValue(undefined),
    setSchedulerModelConfig: vi.fn(),
    ensureMemoryReadyForSession: vi.fn().mockResolvedValue(undefined),
    onSessionEnd: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./acp/acpClient", () => ({
  loadAcpSdk: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../sandbox/policy", () => ({
  getSandboxPolicy: vi.fn(() => sandboxPolicyState.current),
}));

vi.mock("./acp/acpEngine", () => {
  const createMockEngine = (
    config: { apiKey?: string; baseUrl?: string; model?: string } = {},
  ) => ({
    currentConfig: { apiKey: "k", baseUrl: "u", model: "m", ...config },
    init: vi.fn().mockResolvedValue(true),
    updateConfig: vi.fn(),
    removeAllListeners: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    isReady: true,
    getActivePromptCount: vi.fn(() => 0),
    engineName: "nuwaxcode" as const,
    on: vi.fn(),
  });
  return {
    AcpEngine: vi.fn().mockImplementation(() => createMockEngine()),
  };
});

// ────────────────────────────────────────────────────────────────────────────

import { UnifiedAgentService } from "./unifiedAgent";
import {
  filterBridgeEntries,
  rawMcpServersEqual,
} from "../packages/mcpHelpers";
import type { McpServerEntry } from "../packages/mcp";

// ────────────────────────────────────────────────────────────────────────────
// 辅助：构建 stdio MCP server entry
// ────────────────────────────────────────────────────────────────────────────
function makeStdio(
  command: string,
  args: string[],
  extra?: Partial<McpServerEntry>,
): McpServerEntry {
  return { command, args, ...extra } as McpServerEntry;
}

// ────────────────────────────────────────────────────────────────────────────
// UnifiedAgentService.rawMcpServersEqual
// ────────────────────────────────────────────────────────────────────────────
describe("rawMcpServersEqual", () => {
  const eq = rawMcpServersEqual;

  describe("空值处理", () => {
    it("b 为 undefined 时返回 false（代表首次，无历史快照）", () => {
      const a = { time: makeStdio("/uv", ["tool", "run", "mcp-time"]) };
      expect(eq(a, undefined)).toBe(false);
    });

    it("两侧均为空对象时返回 true", () => {
      expect(eq({}, {})).toBe(true);
    });

    it("a 为空、b 非空时返回 false（服务器被删除）", () => {
      const b = { time: makeStdio("/uv", ["tool", "run", "mcp-time"]) };
      expect(eq({}, b)).toBe(false);
    });

    it("a 非空、b 为空时返回 false（服务器被新增）", () => {
      const a = { time: makeStdio("/uv", ["tool", "run", "mcp-time"]) };
      expect(eq(a, {})).toBe(false);
    });
  });

  describe("相同配置 → 不触发重建", () => {
    it("单个 stdio server，command/args 相同", () => {
      const entry = makeStdio("/uv", ["tool", "run", "mcp-server-time"]);
      expect(eq({ time: entry }, { time: { ...entry } })).toBe(true);
    });

    it("多个 server，key 顺序不同但内容相同", () => {
      const a = {
        fetch: makeStdio("/uv", ["tool", "run", "mcp-server-fetch"]),
        time: makeStdio("/uv", ["tool", "run", "mcp-server-time"]),
      };
      const b = {
        time: makeStdio("/uv", ["tool", "run", "mcp-server-time"]),
        fetch: makeStdio("/uv", ["tool", "run", "mcp-server-fetch"]),
      };
      expect(eq(a, b)).toBe(true);
    });

    it("env 字段不同时仍认为相等（env 每次由 getAppEnv 重新注入）", () => {
      const a = {
        time: makeStdio("/uv", ["tool", "run", "mcp-time"], {
          env: { TZ: "UTC" },
        }),
      };
      const b = {
        time: makeStdio("/uv", ["tool", "run", "mcp-time"], {
          env: { TZ: "Asia/Shanghai" },
        }),
      };
      expect(eq(a, b)).toBe(true);
    });

    it("allowTools 顺序不同时认为相等（排序后比较）", () => {
      const a = {
        time: makeStdio("/uv", ["run", "mcp-time"], {
          allowTools: ["get_time", "convert_time"],
        }),
      };
      const b = {
        time: makeStdio("/uv", ["run", "mcp-time"], {
          allowTools: ["convert_time", "get_time"],
        }),
      };
      expect(eq(a, b)).toBe(true);
    });

    it("denyTools 顺序不同时认为相等（排序后比较）", () => {
      const a = {
        time: makeStdio("/uv", ["run", "mcp-time"], { denyTools: ["b", "a"] }),
      };
      const b = {
        time: makeStdio("/uv", ["run", "mcp-time"], { denyTools: ["a", "b"] }),
      };
      expect(eq(a, b)).toBe(true);
    });
  });

  describe("配置实际变化 → 应触发重建", () => {
    it("command 变化时返回 false", () => {
      const a = { fetch: makeStdio("/uv", ["tool", "run", "mcp-fetch"]) };
      const b = { fetch: makeStdio("/uvx", ["mcp-fetch"]) };
      expect(eq(a, b)).toBe(false);
    });

    it("args 变化时返回 false", () => {
      const a = {
        time: makeStdio("/uv", [
          "tool",
          "run",
          "mcp-time",
          "--local-timezone=UTC",
        ]),
      };
      const b = {
        time: makeStdio("/uv", [
          "tool",
          "run",
          "mcp-time",
          "--local-timezone=Asia/Shanghai",
        ]),
      };
      expect(eq(a, b)).toBe(false);
    });

    it("新增 server 时返回 false", () => {
      const a = {
        time: makeStdio("/uv", ["tool", "run", "mcp-time"]),
        fetch: makeStdio("/uv", ["tool", "run", "mcp-fetch"]),
      };
      const b = { time: makeStdio("/uv", ["tool", "run", "mcp-time"]) };
      expect(eq(a, b)).toBe(false);
    });

    it("删除 server 时返回 false", () => {
      const a = { time: makeStdio("/uv", ["tool", "run", "mcp-time"]) };
      const b = {
        time: makeStdio("/uv", ["tool", "run", "mcp-time"]),
        fetch: makeStdio("/uv", ["tool", "run", "mcp-fetch"]),
      };
      expect(eq(a, b)).toBe(false);
    });

    it("allowTools 内容变化时返回 false", () => {
      const a = {
        time: makeStdio("/uv", ["run", "mcp-time"], {
          allowTools: ["get_time"],
        }),
      };
      const b = {
        time: makeStdio("/uv", ["run", "mcp-time"], {
          allowTools: ["convert_time"],
        }),
      };
      expect(eq(a, b)).toBe(false);
    });

    it("denyTools 内容变化时返回 false", () => {
      const a = {
        srv: makeStdio("/uv", ["run", "srv"], { denyTools: ["op1"] }),
      };
      const b = {
        srv: makeStdio("/uv", ["run", "srv"], { denyTools: ["op2"] }),
      };
      expect(eq(a, b)).toBe(false);
    });
  });

  describe("远程 server（url 类型）", () => {
    it("相同 URL 时认为相等", () => {
      const entry = { url: "https://mcp.example.com/sse" } as McpServerEntry;
      expect(eq({ remote: entry }, { remote: { ...entry } })).toBe(true);
    });

    it("URL 变化时返回 false", () => {
      const a = {
        remote: { url: "https://mcp.example.com/v1" } as McpServerEntry,
      };
      const b = {
        remote: { url: "https://mcp.example.com/v2" } as McpServerEntry,
      };
      expect(eq(a, b)).toBe(false);
    });
  });

  describe("修复验证：proxy 包装格式与原始格式对比", () => {
    /**
     * 这是原始 Bug 场景：
     * - a (原始请求格式) = { time: { command: '/uv', args: ['tool','run','mcp-time'] } }
     * - b (proxy 包装格式，旧实现中的 currentConfig.mcpServers) =
     *     { 'mcp-proxy': { command: 'mcp-proxy', args: ['--config-file', '/tmp/uuid.json'] } }
     * 两者永远不等 → 每次都触发引擎重建。
     *
     * 修复后 b 也是原始格式，两者相等 → 不触发重建。
     */
    it("原始格式与 proxy 包装格式不等（确认旧 Bug 场景确实会触发重建）", () => {
      const rawEntry = makeStdio("/uv", ["tool", "run", "mcp-server-time"]);
      const proxyEntry = makeStdio("mcp-proxy", [
        "--config-file",
        "/tmp/nuwax-mcp-configs/mcp-config-abc.json",
      ]);
      // 原始格式 vs proxy 包装格式 → 不等
      expect(eq({ time: rawEntry }, { "mcp-proxy": proxyEntry })).toBe(false);
    });

    it("相同原始格式两次比较返回 true（修复后不触发重建）", () => {
      const entry = makeStdio("/uv", ["tool", "run", "mcp-server-time"]);
      // raw vs raw（修复后的行为）→ 相等
      expect(eq({ time: entry }, { time: { ...entry } })).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// engineRawMcpServers 存储 & 清理
// ────────────────────────────────────────────────────────────────────────────
describe("UnifiedAgentService — engineRawMcpServers 生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rawMcpServersEqual 是可调用的函数", () => {
    expect(typeof rawMcpServersEqual).toBe("function");
  });

  it("filterBridgeEntries 是可调用的函数", () => {
    expect(typeof filterBridgeEntries).toBe("function");
  });

  it("UnifiedAgentService 实例可以成功创建", () => {
    const svc = new UnifiedAgentService();
    expect(svc).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// filterBridgeEntries
// ────────────────────────────────────────────────────────────────────────────
describe("filterBridgeEntries", () => {
  const filter = filterBridgeEntries;

  it("保留非 bridge 入口", () => {
    const input = {
      time: makeStdio("/uv", ["tool", "run", "mcp-time"]),
      remote: { url: "https://mcp.example.com/sse" } as McpServerEntry,
    };
    const result = filter(input);
    expect(Object.keys(result)).toEqual(["time", "remote"]);
  });

  it('过滤掉 command === "mcp-proxy" 的入口', () => {
    const input = {
      time: makeStdio("/uv", ["tool", "run", "mcp-time"]),
      proxy: makeStdio("mcp-proxy", ["--config-file", "/tmp/cfg.json"]),
    };
    expect(Object.keys(filter(input))).toEqual(["time"]);
  });

  it("过滤掉 basename 为 mcp-proxy 的绝对路径入口", () => {
    const proxyAbsPath = path.join(
      "/home",
      ".nuwaclaw",
      "node_modules",
      ".bin",
      "mcp-proxy",
    );
    const input = {
      time: makeStdio("/uv", ["tool", "run", "mcp-time"]),
      proxy: makeStdio(proxyAbsPath, ["--config-file", "/tmp/cfg.json"]),
    };
    expect(Object.keys(filter(input))).toEqual(["time"]);
  });

  it("全为 bridge 入口时返回空对象", () => {
    const input = { proxy: makeStdio("mcp-proxy", []) };
    expect(filter(input)).toEqual({});
  });

  it("空输入返回空对象", () => {
    expect(filter({})).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────────────────────
// rawMcpServersEqual — 修复 continue → return false
// ────────────────────────────────────────────────────────────────────────────
describe("rawMcpServersEqual — 类型不一致时返回 false", () => {
  const eq = rawMcpServersEqual;

  it("同名 key 一方有 command 另一方没有（非 remote）→ 返回 false（修复 continue Bug）", () => {
    // ea 有 command，eb 有 url（非 remote key 分支走到 command 检查时就是 false）
    // 通过构造一个既无 url 又无 command 的 entry 来触发这条路径
    const withCmd = makeStdio("/uv", ["run", "mcp-time"]);
    const noCmd = { args: ["run", "mcp-time"] } as unknown as McpServerEntry; // 无 command、无 url
    const a = { time: withCmd };
    const b = { time: noCmd };
    expect(eq(a, b)).toBe(false); // 修复前会 continue 误判为 true
  });

  it("同名 key 两方都无 command 也无 url → 返回 false（未知类型）", () => {
    const unknown = { args: [] } as unknown as McpServerEntry;
    expect(eq({ srv: unknown }, { srv: unknown })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// mcpChanged 逻辑：支持"清空 MCP"场景
// ────────────────────────────────────────────────────────────────────────────
describe("rawMcpServersEqual — 清空 MCP 场景", () => {
  const eq = rawMcpServersEqual;

  it("请求为空、存储非空 → 不等（用户清空了 MCP，应触发重建）", () => {
    const stored = { time: makeStdio("/uv", ["run", "mcp-time"]) };
    // rawMcpServersEqual({}, stored) → false → mcpChanged = true
    expect(eq({}, stored)).toBe(false);
  });

  it("请求为空、存储也为空 → 相等（无变化）", () => {
    // rawMcpServersEqual({}, {}) → true → mcpChanged = false
    expect(eq({}, {})).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ACP 引擎生命周期：loadAcpSdk、getOrCreateEngine 复用与 destroy 清理
// ────────────────────────────────────────────────────────────────────────────
describe("UnifiedAgentService — 懒加载引擎生命周期", () => {
  const baseConfig = {
    engine: "nuwaxcode" as const,
    workspaceDir: "/tmp",
    apiKey: "k",
    baseUrl: "u",
    model: "m",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("init() 后 loadAcpSdk 被调用", async () => {
    const { loadAcpSdk } = await import("./acp/acpClient");
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    expect(loadAcpSdk).toHaveBeenCalled();
  });

  it("getOrCreateEngine 可按 project 创建引擎并记录配置", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);

    const effectiveConfig = {
      ...baseConfig,
      mcpServers: { bridge: { url: "http://localhost:9999" } },
    };
    const engine = await svc.getOrCreateEngine(
      "proj-warm-reuse",
      effectiveConfig,
    );
    expect(engine).toBeDefined();
    expect(engine.currentConfig?.apiKey).toBe("k");
    expect(engine.currentConfig?.model).toBe("m");
    expect(engine.currentConfig?.baseUrl).toBe("u");
    expect((svc as any).engines.has("proj-warm-reuse")).toBe(true);
    expect((svc as any).engineConfigs.get("proj-warm-reuse")).toEqual(
      effectiveConfig,
    );
  });

  it("getOrCreateEngine 对同一 project 复用现有 ready 引擎", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);

    const requestConfig = { ...baseConfig, model: "other-model" };
    const engine1 = await svc.getOrCreateEngine(
      "proj-same-auth",
      requestConfig,
    );
    const engine2 = await svc.getOrCreateEngine("proj-same-auth", {
      ...requestConfig,
      model: "another-model",
    });
    expect(engine1).toBe(engine2);
  });

  it("destroy() 清空引擎与配置缓存且不抛", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    await svc.getOrCreateEngine("proj-destroy", baseConfig);

    await expect(svc.destroy()).resolves.toBeUndefined();
    expect((svc as any).engines.size).toBe(0);
    expect((svc as any).engineConfigs.size).toBe(0);
    expect((svc as any).engineRawMcpServers.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// listAllSessionsDetailed：活跃/就绪引擎过滤回归
// ────────────────────────────────────────────────────────────────────────────
describe("UnifiedAgentService.listAllSessionsDetailed — 仅返回 ready 引擎会话", () => {
  it("should filter non-ready engines", () => {
    // 使用 as any 访问私有 engines 属性进行单测
    // 生产代码通过 public 方法访问，测试直接操作内部状态以隔离测试
    const svc = new UnifiedAgentService() as any;

    const readySessions = [
      {
        id: "ses-ready-1",
        title: "t1",
        engineType: "nuwaxcode",
        projectId: "proj-ready",
        status: "active",
        createdAt: 1,
        lastActivity: 2,
      },
    ];
    const deadSessions = [
      {
        id: "ses-dead-1",
        title: "t-dead",
        engineType: "claude-code",
        projectId: "proj-dead",
        status: "active",
        createdAt: 10,
        lastActivity: 11,
      },
    ];

    svc.engines = new Map<string, any>([
      [
        "proj-ready",
        {
          isReady: true,
          engineName: "nuwaxcode",
          listSessionsDetailed: () => readySessions,
        },
      ],
      [
        "proj-dead",
        {
          isReady: false,
          engineName: "claude-code",
          listSessionsDetailed: () => deadSessions,
        },
      ],
    ]);

    const result = svc.listAllSessionsDetailed();
    expect(result).toEqual(readySessions);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// warmupEngine：nuwaxcode 热启动预创建
// ────────────────────────────────────────────────────────────────────────────
describe("UnifiedAgentService — warmupEngine 热启动", () => {
  const baseConfig = {
    engine: "nuwaxcode" as const,
    workspaceDir: "/tmp",
    apiKey: "k",
    baseUrl: "u",
    model: "m",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sandboxPolicyState.current = {
      enabled: true,
      backend: "auto",
      mode: "compat",
      autoFallback: "startup-only",
      windowsMode: "workspace-write",
    };
  });

  it("init() 后 engines 中存在 __warmup__ 占位", async () => {
    const svc = new UnifiedAgentService() as any;
    await svc.init(baseConfig);
    // AcpEngine mock 的 init 是同步 resolve，所以 warmup 立即完成
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("__warmup__").isReady).toBe(true);
  });

  it("engine 为 claude-code 时仍触发 nuwaxcode warmup", async () => {
    const claudeConfig = { ...baseConfig, engine: "claude-code" as const };
    const svc = new UnifiedAgentService() as any;
    await svc.init(claudeConfig);
    // warmup 始终预热 nuwaxcode，不管 init 时的 engineType
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("__warmup__").isReady).toBe(true);
  });

  it("getOrCreateEngine 复用 warmup 引擎并 re-key", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);

    // warmup 引擎已就绪
    expect((svc as any).engines.has("__warmup__")).toBe(true);

    const engine = await svc.getOrCreateEngine("proj-test", baseConfig);
    expect(engine).toBeDefined();
    // warmup 被消费后会立即补仓
    expect((svc as any).engines.has("__warmup__")).toBe(true);
    expect((svc as any).engines.has("proj-test")).toBe(true);
  });

  it("warmup 运行时配置缺失时不复用，回退冷启动", async () => {
    const svc = new UnifiedAgentService() as any;
    await svc.init({
      ...baseConfig,
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
    });

    const warmupEngine = svc.engines.get("__warmup__");
    expect(warmupEngine).toBeDefined();

    const engine = await svc.getOrCreateEngine("proj-runtime-mismatch", {
      ...baseConfig,
      apiKey: "runtime-key",
      baseUrl: "https://runtime.example.com",
      model: "runtime-model",
      apiProtocol: "openai",
    });

    expect(engine).not.toBe(warmupEngine);
    expect(warmupEngine.destroy).toHaveBeenCalled();
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-runtime-mismatch")).toBe(engine);
  });

  it("warmup runtime config 缓存：首次 miss 后 refill 命中后续请求", async () => {
    const svc = new UnifiedAgentService() as any;
    // init 时 baseConfig 没有 runtime 配置
    await svc.init({
      ...baseConfig,
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
    });

    const runtimeConfig = {
      ...baseConfig,
      apiKey: "cached-key",
      baseUrl: "https://cached.example.com",
      model: "cached-model",
      apiProtocol: "openai",
    };

    // 第一次请求：runtime mismatch → 冷启动，缓存 runtime config
    const engine1 = await svc.getOrCreateEngine("proj-cache-1", runtimeConfig);
    expect(svc.engines.has("__warmup__")).toBe(true);

    // refill warmup 应该带缓存的 runtime config，第二个请求可命中
    const refillWarmup = svc.engines.get("__warmup__");
    expect(refillWarmup).toBeDefined();

    const engine2 = await svc.getOrCreateEngine("proj-cache-2", runtimeConfig);
    // refill warmup 应该被复用
    expect(engine2).toBe(refillWarmup);
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-cache-2")).toBe(refillWarmup);
  });

  it("warmup runtime config 缓存：配置变更时回退冷启动并更新缓存", async () => {
    const svc = new UnifiedAgentService() as any;
    await svc.init({
      ...baseConfig,
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
    });

    const runtimeConfigA = {
      ...baseConfig,
      apiKey: "key-a",
      baseUrl: "https://a.example.com",
      model: "model-a",
      apiProtocol: "openai",
    };
    const runtimeConfigB = {
      ...baseConfig,
      apiKey: "key-b",
      baseUrl: "https://b.example.com",
      model: "model-b",
      apiProtocol: "anthropic",
    };

    // 第一次请求：缓存 configA
    await svc.getOrCreateEngine("proj-change-1", runtimeConfigA);
    expect(svc.engines.has("__warmup__")).toBe(true);
    const refillA = svc.engines.get("__warmup__");

    // 第二次请求：configB 与缓存不匹配 → 回退冷启动，更新缓存
    const engine2 = await svc.getOrCreateEngine(
      "proj-change-2",
      runtimeConfigB,
    );
    expect(engine2).not.toBe(refillA);
    expect(refillA.destroy).toHaveBeenCalled();

    // refill 应该用 configB 创建
    expect(svc.engines.has("__warmup__")).toBe(true);
    const refillB = svc.engines.get("__warmup__");

    // 第三次请求：configB 命中 refill
    const engine3 = await svc.getOrCreateEngine(
      "proj-change-3",
      runtimeConfigB,
    );
    expect(engine3).toBe(refillB);
  });

  it("sandbox policy 变更后，下一次会话立即放弃旧 warmup 复用", async () => {
    const svc = new UnifiedAgentService() as any;
    sandboxPolicyState.current = {
      ...sandboxPolicyState.current,
      mode: "compat",
    };
    await svc.init(baseConfig);

    const warmupEngine = svc.engines.get("__warmup__");
    expect(warmupEngine).toBeDefined();
    const warmupCfg = svc.engineConfigs.get("__warmup__");
    expect(warmupCfg.env?.NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP).toBeDefined();

    sandboxPolicyState.current = {
      ...sandboxPolicyState.current,
      mode: "strict",
    };

    const engine = await svc.getOrCreateEngine("proj-sandbox-policy-change", {
      ...baseConfig,
    });

    expect(engine).not.toBe(warmupEngine);
    expect(warmupEngine.destroy).toHaveBeenCalled();
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-sandbox-policy-change")).toBe(engine);

    const refillCfg = svc.engineConfigs.get("__warmup__");
    expect(refillCfg.env?.NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP).toBeDefined();
    expect(refillCfg.env?.NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP).not.toBe(
      warmupCfg.env?.NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP,
    );
  });

  it("warmup 缺少 MCP ready 标记时不复用，回退冷启动", async () => {
    const mcpConfig = {
      bridge: {
        command: "/mock/node",
        args: ["/mock/proxy.js", "--config-file", "/tmp/mcp-ready.json"],
        env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log" },
      },
    };
    const svc = new UnifiedAgentService() as any;
    await svc.init({ ...baseConfig, mcpServers: mcpConfig });

    const warmupEngine = svc.engines.get("__warmup__");
    expect(warmupEngine).toBeDefined();

    const warmupCfg = svc.engineConfigs.get("__warmup__");
    expect(warmupCfg).toBeDefined();
    expect(warmupCfg.env?.NUWAX_AGENT_WARMUP_MCP_READY).toBe("1");

    // 模拟老版本 warmup：没有 MCP ready 标记
    delete warmupCfg.env.NUWAX_AGENT_WARMUP_MCP_READY;

    const engine = await svc.getOrCreateEngine("proj-legacy-warmup", {
      ...baseConfig,
      mcpServers: mcpConfig,
    });

    expect(engine).not.toBe(warmupEngine);
    expect(warmupEngine.destroy).toHaveBeenCalled();
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-legacy-warmup")).toBe(engine);
  });

  it("claude-code 请求保持原逻辑：不复用 nuwaxcode warmup", async () => {
    const claudeConfig = { ...baseConfig, engine: "claude-code" as const };
    const svc = new UnifiedAgentService() as any;
    await svc.init(claudeConfig);

    // init 阶段仍会创建 nuwaxcode warmup
    expect(svc.engines.has("__warmup__")).toBe(true);
    const warmupEngine = svc.engines.get("__warmup__");

    const engine = await svc.getOrCreateEngine("proj-claude", claudeConfig);
    expect(engine).toBeDefined();
    expect(engine).not.toBe(warmupEngine);
    // warmup 继续保留，不影响后续 nuwaxcode 命中
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-claude")).toBe(engine);
  });

  it("nuwaxcode: 第一次命中 warmup 后会补仓，第二个新 project 也可继续命中", async () => {
    const svc = new UnifiedAgentService() as any;
    await svc.init(baseConfig);

    const firstWarmup = svc.engines.get("__warmup__");
    expect(firstWarmup).toBeDefined();

    const firstEngine = await svc.getOrCreateEngine("proj-1", baseConfig);
    expect(firstEngine).toBe(firstWarmup);

    const secondWarmup = svc.engines.get("__warmup__");
    expect(secondWarmup).toBeDefined();
    expect(secondWarmup).not.toBe(firstWarmup);

    const secondEngine = await svc.getOrCreateEngine("proj-2", baseConfig);
    expect(secondEngine).toBe(secondWarmup);
    expect(svc.engines.has("__warmup__")).toBe(true);
  });

  it("destroy() 清理 warmup 引擎", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    expect((svc as any).engines.has("__warmup__")).toBe(true);

    await svc.destroy();
    expect((svc as any).engines.size).toBe(0);
  });

  it("destroy() 会调用 warmup.dispose 清理 respawn 定时器", async () => {
    const svc = new UnifiedAgentService() as any;
    await svc.init(baseConfig);
    const disposeSpy = vi.spyOn(svc.warmup, "dispose");

    await svc.destroy();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("warmup MCP 与请求 MCP 同名但 args 不同 → 不复用，回退冷启动", async () => {
    const { AcpEngine } = await import("./acp/acpEngine");

    const warmupMcp = {
      bridge: {
        command: "/mock/node",
        args: ["/mock/proxy.js", "--config-file", "/tmp/mcp-a.json"],
        env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log" },
      },
    };
    const requestMcp = {
      bridge: {
        command: "/mock/node",
        args: ["/mock/proxy.js", "--config-file", "/tmp/mcp-b.json"],
        env: { MCP_PROXY_LOG_FILE: "/tmp/project.log" },
      },
    };

    const mockWarmupEngine = {
      currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
      init: vi.fn().mockResolvedValue(true),
      updateConfig: vi.fn(),
      removeAllListeners: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      getActivePromptCount: vi.fn(() => 0),
      engineName: "nuwaxcode" as const,
      on: vi.fn(),
    };
    const mockNewEngine = {
      currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
      init: vi.fn().mockResolvedValue(true),
      updateConfig: vi.fn(),
      removeAllListeners: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      getActivePromptCount: vi.fn(() => 0),
      engineName: "nuwaxcode" as const,
      on: vi.fn(),
    };

    let callCount = 0;
    (AcpEngine as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockWarmupEngine : mockNewEngine;
    });

    const svc = new UnifiedAgentService() as any;
    await svc.init({ ...baseConfig, mcpServers: warmupMcp });

    const engine = await svc.getOrCreateEngine("proj-mcp-mismatch", {
      ...baseConfig,
      mcpServers: requestMcp,
    });
    expect(engine).toBe(mockNewEngine);
    expect(mockWarmupEngine.destroy).toHaveBeenCalled();
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-mcp-mismatch")).toBe(mockNewEngine);
  });

  it("仅 MCP_PROXY_LOG_FILE 不同仍复用 warmup", async () => {
    const warmupMcp = {
      bridge: {
        command: "/mock/node",
        args: ["/mock/proxy.js", "--config-file", "/tmp/mcp-same.json"],
        env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log", FOO: "bar" },
      },
    };
    const requestMcp = {
      bridge: {
        command: "/mock/node",
        args: ["/mock/proxy.js", "--config-file", "/tmp/mcp-same.json"],
        env: { MCP_PROXY_LOG_FILE: "/tmp/project.log", FOO: "bar" },
      },
    };

    const svc = new UnifiedAgentService() as any;
    await svc.init({ ...baseConfig, mcpServers: warmupMcp });
    const warmupEngine = svc.engines.get("__warmup__");

    const engine = await svc.getOrCreateEngine("proj-mcp-logonly", {
      ...baseConfig,
      mcpServers: requestMcp,
    });

    expect(engine).toBe(warmupEngine);
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("proj-mcp-logonly")).toBe(warmupEngine);
  });

  it("mcp-proxy --config-file 路径不同但配置内容相同仍复用 warmup", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "warmup-mcp-"));
    try {
      const configAPath = path.join(tmpDir, "mcp-config-a.json");
      const configBPath = path.join(tmpDir, "mcp-config-b.json");
      const sameConfig = {
        mcpServers: {
          "chrome-devtools": {
            url: "http://127.0.0.1:3344/mcp/chrome-devtools",
            transport: "streamable-http",
          },
        },
      };
      fs.writeFileSync(configAPath, JSON.stringify(sameConfig), "utf8");
      fs.writeFileSync(configBPath, JSON.stringify(sameConfig), "utf8");

      const warmupMcp = {
        bridge: {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", configAPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log", FOO: "bar" },
        },
      };
      const requestMcp = {
        bridge: {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", configBPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/project.log", FOO: "bar" },
        },
      };

      const svc = new UnifiedAgentService() as any;
      await svc.init({ ...baseConfig, mcpServers: warmupMcp });
      const warmupEngine = svc.engines.get("__warmup__");

      const engine = await svc.getOrCreateEngine("proj-mcp-config-semantic", {
        ...baseConfig,
        mcpServers: requestMcp,
      });

      expect(engine).toBe(warmupEngine);
      expect(svc.engines.has("__warmup__")).toBe(true);
      expect(svc.engines.get("proj-mcp-config-semantic")).toBe(warmupEngine);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("persistent MCP: warmup 为 proxy-stdio、请求为 bridge URL 时仍复用", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "warmup-mcp-"));
    try {
      const configPath = path.join(tmpDir, "mcp-config-chrome.json");
      const persistentConfig = {
        mcpServers: {
          "chrome-devtools": {
            command: "npx",
            args: ["-y", "chrome-devtools-mcp@latest"],
            persistent: true,
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(persistentConfig), "utf8");

      const warmupMcp = {
        "chrome-devtools": {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", configPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log" },
        },
      };
      const requestMcp = {
        "chrome-devtools": {
          url: "http://127.0.0.1:59504/mcp/chrome-devtools",
        },
      };

      const svc = new UnifiedAgentService() as any;
      await svc.init({ ...baseConfig, mcpServers: warmupMcp });
      const warmupEngine = svc.engines.get("__warmup__");

      const engine = await svc.getOrCreateEngine(
        "proj-persistent-shape-switch",
        {
          ...baseConfig,
          mcpServers: requestMcp,
        },
      );

      expect(engine).toBe(warmupEngine);
      expect(svc.engines.has("__warmup__")).toBe(true);
      expect(svc.engines.get("proj-persistent-shape-switch")).toBe(
        warmupEngine,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("persistent MCP: warmup/request 均为 proxy-stdio（config-file: stdio vs bridge-url）仍复用", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "warmup-mcp-"));
    try {
      const warmupConfigPath = path.join(tmpDir, "mcp-warmup.json");
      const requestConfigPath = path.join(tmpDir, "mcp-request.json");

      const warmupConfigFile = {
        mcpServers: {
          "chrome-devtools": {
            command: "npx",
            args: ["-y", "chrome-devtools-mcp@latest"],
            persistent: true,
          },
        },
      };
      const requestConfigFile = {
        mcpServers: {
          "chrome-devtools": {
            url: "http://127.0.0.1:59504/mcp/chrome-devtools",
          },
        },
      };
      fs.writeFileSync(
        warmupConfigPath,
        JSON.stringify(warmupConfigFile),
        "utf8",
      );
      fs.writeFileSync(
        requestConfigPath,
        JSON.stringify(requestConfigFile),
        "utf8",
      );

      const warmupMcp = {
        "chrome-devtools": {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", warmupConfigPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log" },
        },
      };
      const requestMcp = {
        "chrome-devtools": {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", requestConfigPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/request.log" },
        },
      };

      const svc = new UnifiedAgentService() as any;
      await svc.init({ ...baseConfig, mcpServers: warmupMcp });
      const warmupEngine = svc.engines.get("__warmup__");

      const engine = await svc.getOrCreateEngine(
        "proj-persistent-proxy-vs-urlfile",
        {
          ...baseConfig,
          mcpServers: requestMcp,
        },
      );

      expect(engine).toBe(warmupEngine);
      expect(svc.engines.has("__warmup__")).toBe(true);
      expect(svc.engines.get("proj-persistent-proxy-vs-urlfile")).toBe(
        warmupEngine,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("non-persistent MCP: proxy-stdio 与 bridge URL 不应被视为等价", async () => {
    const { AcpEngine } = await import("./acp/acpEngine");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "warmup-mcp-"));
    try {
      const configPath = path.join(tmpDir, "mcp-config-non-persistent.json");
      const nonPersistentConfig = {
        mcpServers: {
          "chrome-devtools": {
            command: "npx",
            args: ["-y", "chrome-devtools-mcp@latest"],
            persistent: false,
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(nonPersistentConfig), "utf8");

      const warmupMcp = {
        "chrome-devtools": {
          command: "/mock/node",
          args: ["/mock/proxy.js", "--config-file", configPath],
          env: { MCP_PROXY_LOG_FILE: "/tmp/warmup.log" },
        },
      };
      const requestMcp = {
        "chrome-devtools": {
          url: "http://127.0.0.1:59504/mcp/chrome-devtools",
        },
      };

      const mockWarmupEngine = {
        currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
        init: vi.fn().mockResolvedValue(true),
        updateConfig: vi.fn(),
        removeAllListeners: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined),
        isReady: true,
        getActivePromptCount: vi.fn(() => 0),
        engineName: "nuwaxcode" as const,
        on: vi.fn(),
      };
      const mockNewEngine = {
        currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
        init: vi.fn().mockResolvedValue(true),
        updateConfig: vi.fn(),
        removeAllListeners: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined),
        isReady: true,
        getActivePromptCount: vi.fn(() => 0),
        engineName: "nuwaxcode" as const,
        on: vi.fn(),
      };

      let callCount = 0;
      (AcpEngine as any).mockImplementation(() => {
        callCount++;
        return callCount === 1 ? mockWarmupEngine : mockNewEngine;
      });

      const svc = new UnifiedAgentService() as any;
      await svc.init({ ...baseConfig, mcpServers: warmupMcp });

      const engine = await svc.getOrCreateEngine("proj-non-persistent", {
        ...baseConfig,
        mcpServers: requestMcp,
      });

      expect(engine).toBe(mockNewEngine);
      expect(mockWarmupEngine.destroy).toHaveBeenCalled();
      expect(svc.engines.has("__warmup__")).toBe(true);
      expect(svc.engines.get("proj-non-persistent")).toBe(mockNewEngine);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("warmup 未完成时请求到达 → tryReuse 发现未就绪 → 清理 → 创建新引擎", async () => {
    const { AcpEngine } = await import("./acp/acpEngine");

    // 创建一个 init 慢速 resolve 的 mock engine（模拟 warmup 进行中）
    let resolveInit: (ok: boolean) => void;
    const slowInit = new Promise<boolean>((r) => {
      resolveInit = r;
    });

    const mockWarmupEngine = {
      currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
      init: vi.fn(() => slowInit),
      updateConfig: vi.fn(),
      removeAllListeners: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      isReady: false, // warmup 尚未完成
      getActivePromptCount: vi.fn(() => 0),
      engineName: "nuwaxcode" as const,
      on: vi.fn(),
    };

    // 后续创建的 engine 用正常 mock（快速 resolve）
    const mockNewEngine = {
      currentConfig: { apiKey: "k", baseUrl: "u", model: "m" },
      init: vi.fn().mockResolvedValue(true),
      updateConfig: vi.fn(),
      removeAllListeners: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      getActivePromptCount: vi.fn(() => 0),
      engineName: "nuwaxcode" as const,
      on: vi.fn(),
    };

    // 第一次 AcpEngine 构造返回慢 warmup 引擎，第二次返回正常引擎
    let callCount = 0;
    (AcpEngine as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockWarmupEngine : mockNewEngine;
    });

    const svc = new UnifiedAgentService() as any;
    await svc.init(baseConfig);

    // warmup 引擎已占位但未就绪
    expect(svc.engines.has("__warmup__")).toBe(true);
    expect(svc.engines.get("__warmup__").isReady).toBe(false);

    // 请求到达 → tryReuse 发现 warmup 未就绪 → 清理 → 创建新引擎
    const engine = await svc.getOrCreateEngine("proj-late", baseConfig);
    expect(engine).toBe(mockNewEngine);
    // warmup 引擎被清理后会重新补仓
    expect(svc.engines.has("__warmup__")).toBe(true);
    // 新引擎已注册
    expect(svc.engines.has("proj-late")).toBe(true);
    // warmup engine 的 destroy 被调用
    expect(mockWarmupEngine.destroy).toHaveBeenCalled();
  });
});
