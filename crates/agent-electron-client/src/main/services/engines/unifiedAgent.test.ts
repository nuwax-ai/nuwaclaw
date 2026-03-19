/**
 * 单元测试: UnifiedAgentService — MCP 配置变更检测 + 引擎预热池（ACP 性能优化）
 *
 * 覆盖修复内容：
 * 1. rawMcpServersEqual(): 静态辅助方法，同格式比较原始 MCP server 配置
 * 2. detectConfigChange(): 跨格式误判修复验证（通过 rawMcpServersEqual 间接覆盖）
 * 3. 引擎预热池：init 触发 loadAcpSdk 与 startWarmingEngine；getOrCreateEngine 复用/销毁逻辑；destroy 清空池
 *
 * 背景：原实现将 proxy 包装格式（currentConfig.mcpServers, command=mcp-proxy）
 *      与原始格式（requestMcpServersEarly, command=uvx/uv/npx）直接比较，
 *      导致配置未变化时仍触发引擎重建（Windows 每次多花 13s）。
 *      修复后，两侧均使用原始格式做同格式比较。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";

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
// ACP 引擎性能优化：预热池、loadAcpSdk、getOrCreateEngine 复用与 destroy 清理
// ────────────────────────────────────────────────────────────────────────────
describe("UnifiedAgentService — 引擎预热池（ACP 性能优化）", () => {
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

  it("getOrCreateEngine 在预热完成后复用池中引擎且配置一致", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));

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
    expect(engine.updateConfig).toHaveBeenCalledWith(effectiveConfig); // 确保 MCP 等与本请求一致
    // 复用后仅补充 nuwaxcode；池中最多两种类型各一（claude-code 未用 + nuwaxcode 新预热）
    expect((svc as any).warmEnginePool.size).toBeLessThanOrEqual(2);
  });

  it("getOrCreateEngine 在 apiKey/baseUrl 一致时复用并 updateConfig", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    await new Promise<void>((r) => setTimeout(r, 50));

    const requestConfig = { ...baseConfig, model: "other-model" };
    const engine = await svc.getOrCreateEngine("proj-same-auth", requestConfig);
    expect(engine).toBeDefined();
    expect(engine.updateConfig).toHaveBeenCalledWith(requestConfig);
  });

  it("getOrCreateEngine 在 apiKey 不一致时不复用、销毁预热引擎并走冷启动", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    await new Promise<void>((r) => setTimeout(r, 50));

    const pool = (svc as any).warmEnginePool as Map<
      string,
      { destroy: ReturnType<typeof vi.fn> }
    >;
    const warm = pool.get("nuwaxcode");
    if (!warm) return;
    warm.destroy.mockClear();

    const requestConfig = { ...baseConfig, apiKey: "other-key" };
    const engine = await svc.getOrCreateEngine("proj-diff-auth", requestConfig);
    expect(engine).toBeDefined();
    expect(warm.destroy).toHaveBeenCalled();
  });

  it("destroy() 清空预热池且不抛", async () => {
    const svc = new UnifiedAgentService();
    await svc.init(baseConfig);
    await new Promise<void>((r) => setImmediate(r));

    await expect(svc.destroy()).resolves.toBeUndefined();
    expect((svc as any).warmEnginePool.size).toBe(0);
    expect((svc as any).warmEngineTasks.size).toBe(0);
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
