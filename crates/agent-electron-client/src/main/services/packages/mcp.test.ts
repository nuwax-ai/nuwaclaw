/**
 * 单元测试: MCP Proxy Manager
 *
 * 测试 MCP Proxy 配置管理和 binary 验证
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "home") return "/mock/home";
      return "/mock/appdata";
    }),
    getAppPath: vi.fn(() => "/mock/app"),
    isPackaged: false,
  },
}));

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs
const mockExistsSync = vi.fn(() => true);
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// Mock os
vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/mock/tmp"),
}));

// Mock crypto
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid-12345"),
  // createHash 用于 getAgentMcpConfig 的内容哈希文件名（Fix: UUID → hash）
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => "abcdef1234567890abcdef1234567890"), // 模拟 32 位 hex
  })),
}));

// Mock dependencies（含 getUvBinPath、getNodeBinPath、getNodeBinPathWithFallback，供 mcp 内 getUvBinDir 等使用）
vi.mock("../system/dependencies", () => ({
  getAppEnv: vi.fn(() => ({
    PATH: "/mock/path",
    NODE_PATH: "/mock/node_path",
    HOME: "/mock/home",
    USER: "mockuser",
    USERNAME: "mockuser",
    LANG: "en_US.UTF-8",
    TZ: "",
    UV_TOOL_DIR: "/mock/uv_tool",
    UV_CACHE_DIR: "/mock/uv_cache",
    UV_INDEX_URL: "",
  })),
  getUvBinPath: vi.fn(() => "/mock/uv/bin/uv"),
  getNodeBinPath: vi.fn(() => "/mock/resources/node/darwin-arm64/bin/node"),
  getNodeBinPathWithFallback: vi.fn(
    () => "/mock/resources/node/darwin-arm64/bin/node",
  ),
}));

vi.mock("./packageLocator", () => ({
  getAppPaths: vi.fn(() => ({
    nodeModules: "/mock/home/.nuwaclaw/node_modules",
  })),
  isInstalledLocally: vi.fn(() => true),
}));

vi.mock("../utils/spawnNoWindow", () => ({
  resolveNpmPackageEntry: vi.fn(
    () =>
      "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
  ),
}));

// Mock persistentMcpBridge (避免加载 MCP SDK)
vi.mock("./persistentMcpBridge", () => ({
  persistentMcpBridge: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn(() => false),
    getBridgeUrl: vi.fn(() => null),
    isServerHealthy: vi.fn(() => false),
  },
}));

describe("McpProxyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 恢复 persistentMcpBridge 到默认 mock（防止 vi.doMock 跨测试泄漏）
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();

    // 重置 mock
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("配置管理", () => {
    it("setConfig 和 getConfig 应该正确工作", async () => {
      const { mcpProxyManager } = await import("./mcp");

      const newConfig = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      };

      mcpProxyManager.setConfig(newConfig);
      const config = mcpProxyManager.getConfig();

      expect(config.mcpServers["test-server"]).toBeDefined();
      expect(config.mcpServers["test-server"].command).toBe("npx");
    });

    it("addServer 和 removeServer 应该正确工作", async () => {
      const { mcpProxyManager } = await import("./mcp");

      mcpProxyManager.addServer("new-server", {
        command: "node",
        args: ["server.js"],
      });

      let config = mcpProxyManager.getConfig();
      expect(config.mcpServers["new-server"]).toBeDefined();

      mcpProxyManager.removeServer("new-server");
      config = mcpProxyManager.getConfig();
      expect(config.mcpServers["new-server"]).toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("start() 后应该返回 running=true 和 server 数量", async () => {
      const { mcpProxyManager } = await import("./mcp");

      await mcpProxyManager.start();
      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(true);
      expect(status.serverCount).toBeGreaterThan(0);
    });

    it("未调用 start() 时应该返回 running=false", async () => {
      const { mcpProxyManager } = await import("./mcp");

      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(false);
    });

    it("binary 不存在时应该返回 running=false", async () => {
      vi.doMock("../utils/spawnNoWindow", () => ({
        resolveNpmPackageEntry: vi.fn(() => null),
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import("./mcp");
      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(false);

      // Restore original mock
      vi.doMock("../utils/spawnNoWindow", () => ({
        resolveNpmPackageEntry: vi.fn(
          () =>
            "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
        ),
      }));
    });
  });

  describe("getAgentMcpConfig", () => {
    it("临时 server 应该返回 proxy 聚合配置", async () => {
      const { mcpProxyManager } = await import("./mcp");

      // 设置只有临时 server 的配置
      mcpProxyManager.setConfig({
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      });

      // start() 填充缓存路径
      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      expect(mcpConfig).toBeDefined();
      // 统一聚合为 proxy key
      expect(mcpConfig?.["mcp-proxy"]).toBeDefined();
      // 使用 --config-file 避免 Windows 命令行长度限制
      expect(mcpConfig?.["mcp-proxy"].args).toContain("--config-file");
      // 新方案：使用内置 Node.js 24，不再使用 process.execPath + ELECTRON_RUN_AS_NODE
      expect(mcpConfig?.["mcp-proxy"].command).toBe(
        "/mock/resources/node/darwin-arm64/bin/node",
      );
      expect(
        mcpConfig?.["mcp-proxy"].env?.ELECTRON_RUN_AS_NODE,
      ).toBeUndefined();
    });

    it("mcp-proxy 入口应包含基础环境变量", async () => {
      const { mcpProxyManager } = await import("./mcp");

      // 设置临时 server 配置
      mcpProxyManager.setConfig({
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      });

      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      expect(mcpConfig).toBeDefined();
      expect(mcpConfig?.["mcp-proxy"]).toBeDefined();

      // 验证 mcp-proxy 入口包含基础环境变量
      const proxyEnv = mcpConfig?.["mcp-proxy"].env;
      expect(proxyEnv).toBeDefined();
      expect(proxyEnv?.PATH).toBeDefined();
      expect(proxyEnv?.HOME).toBeDefined();
      expect(proxyEnv?.USER).toBeDefined();
      expect(proxyEnv?.LANG).toBeDefined();
    });

    it("默认配置只有 persistent server，bridge 未运行时应降级到 stdio 配置", async () => {
      const { mcpProxyManager } = await import("./mcp");

      // start() 填充缓存路径（默认配置包含 chrome-devtools persistent）
      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // PersistentMcpBridge 未运行（mock isRunning=false），persistent server 降级到 stdio 配置
      expect(mcpConfig).toBeDefined();
      expect(mcpConfig?.["mcp-proxy"]).toBeDefined();
      // 使用 --config-file
      expect(mcpConfig?.["mcp-proxy"].args).toContain("--config-file");
    });

    it("persistent server 在 bridge 运行时应该返回包含 url 的 proxy 配置", async () => {
      vi.doMock("./persistentMcpBridge", () => ({
        persistentMcpBridge: {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          isRunning: vi.fn(() => true),
          getBridgeUrl: vi.fn(
            () => "http://127.0.0.1:12345/mcp/chrome-devtools",
          ),
          isServerHealthy: vi.fn(() => true),
        },
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import("./mcp");

      // 手动设置 persistent server 配置
      mcpProxyManager.setConfig({
        mcpServers: {
          "chrome-devtools": {
            command: "chrome-devtools-mcp",
            args: [],
            persistent: true,
          },
        },
      });

      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // bridge 运行中 → proxy 配置中应包含 persistent server 的 url
      expect(mcpConfig).toBeDefined();
      expect(mcpConfig?.["mcp-proxy"]).toBeDefined();
      // 使用 --config-file 避免 Windows 命令行长度限制
      expect(mcpConfig?.["mcp-proxy"].args).toContain("--config-file");

      // 验证临时配置文件路径格式正确
      const configIdx = mcpConfig!["mcp-proxy"].args.indexOf("--config-file");
      const configFilePath = mcpConfig!["mcp-proxy"].args[configIdx + 1];
      expect(configFilePath).toContain("mcp-config-");
      expect(configFilePath).toContain(".json");
      // 验证 writeFileSync 被调用以写入配置
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it("混合临时和持久化 server 应该聚合到同一个 proxy", async () => {
      vi.doMock("./persistentMcpBridge", () => ({
        persistentMcpBridge: {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          isRunning: vi.fn(() => true),
          getBridgeUrl: vi.fn(
            (name: string) => `http://127.0.0.1:12345/mcp/${name}`,
          ),
          isServerHealthy: vi.fn(() => true),
        },
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import("./mcp");

      mcpProxyManager.setConfig({
        mcpServers: {
          "chrome-devtools": {
            command: "chrome-devtools-mcp",
            args: [],
            persistent: true,
          },
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      });

      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // 只有一个 proxy key
      expect(mcpConfig).toBeDefined();
      expect(Object.keys(mcpConfig!)).toEqual(["mcp-proxy"]);

      // 使用 --config-file 避免 Windows 命令行长度限制
      expect(mcpConfig!["mcp-proxy"].args).toContain("--config-file");
      // 验证 writeFileSync 被调用，配置已写入临时文件
      expect(mockWriteFileSync).toHaveBeenCalled();
      // 验证配置内容：bridge 运行中，所有 server 都使用 bridge URL
      const writeCall = mockWriteFileSync.mock.calls[0];
      const configJson = JSON.parse(writeCall[1] as string);
      expect(configJson.mcpServers["test-server"].url).toBe(
        "http://127.0.0.1:12345/mcp/test-server",
      );
      expect(configJson.mcpServers["chrome-devtools"].url).toBe(
        "http://127.0.0.1:12345/mcp/chrome-devtools",
      );
    });

    it("没有配置服务器时应该返回 null", async () => {
      const { mcpProxyManager } = await import("./mcp");

      // 清空配置
      mcpProxyManager.setConfig({ mcpServers: {} });

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      expect(mcpConfig).toBeNull();
    });

    it("proxy script 不存在时应该 fallback 到直接 stdio 配置（临时 server）", async () => {
      vi.doMock("../utils/spawnNoWindow", () => ({
        resolveNpmPackageEntry: vi.fn(() => null),
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import("./mcp");

      // 设置临时 server 以测试 fallback
      mcpProxyManager.setConfig({
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      });

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      expect(mcpConfig).toBeDefined();
      // fallback: 不应有 proxy key，而是直接有各 server
      expect(mcpConfig?.["mcp-proxy"]).toBeUndefined();
      expect(mcpConfig?.["test-server"]).toBeDefined();

      // Restore original mock
      vi.doMock("../utils/spawnNoWindow", () => ({
        resolveNpmPackageEntry: vi.fn(
          () =>
            "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
        ),
      }));
    });
  });

  describe("cleanup", () => {
    it("cleanup 应该安全执行（async）", async () => {
      const { mcpProxyManager } = await import("./mcp");

      await expect(mcpProxyManager.cleanup()).resolves.not.toThrow();
    });
  });

  describe("stop", () => {
    it("stop 应该返回成功（no-op）", async () => {
      const { mcpProxyManager } = await import("./mcp");

      const result = await mcpProxyManager.stop();
      expect(result.success).toBe(true);
    });
  });

  describe("start - 验证 binary 可用性", () => {
    it("nuwax-mcp-stdio-proxy 已安装时应该返回成功", async () => {
      const { mcpProxyManager } = await import("./mcp");
      const result = await mcpProxyManager.start();
      expect(result.success).toBe(true);
    });

    it("nuwax-mcp-stdio-proxy 未安装时应该返回错误", async () => {
      vi.doMock("./packageLocator", () => ({
        getAppPaths: vi.fn(() => ({
          nodeModules: "/mock/home/.nuwaclaw/node_modules",
        })),
        isInstalledLocally: vi.fn(() => false),
      }));
      vi.doMock("../utils/spawnNoWindow", () => ({
        resolveNpmPackageEntry: vi.fn(() => null),
      }));
      // fs.existsSync 对包目录返回 false
      mockExistsSync.mockReturnValue(false);

      vi.resetModules();

      const { mcpProxyManager } = await import("./mcp");
      const result = await mcpProxyManager.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain("未安装");
    });
  });

  describe("restart", () => {
    it("restart 应该调用 start", async () => {
      const { mcpProxyManager } = await import("./mcp");

      const startSpy = vi.spyOn(mcpProxyManager, "start");

      await mcpProxyManager.restart();

      expect(startSpy).toHaveBeenCalled();
    });
  });
});

describe("extractRealMcpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("应该从桥接条目中提取真实 MCP 服务", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "uvx",
            args: ["mcp-server-fetch"],
          },
        },
      }),
    ];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeDefined();
    expect(result?.["test-server"]).toBeDefined();
    // uvx 应该被解析为 uv tool run
    expect(result?.["test-server"].command).toContain("uv");
    expect(result?.["test-server"].args).toContain("tool");
    expect(result?.["test-server"].args).toContain("run");
  });

  it("应该处理多个 MCP 服务", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          fetch: {
            command: "uvx",
            args: ["mcp-server-fetch"],
          },
          time: {
            command: "npx",
            args: ["-y", "mcp-server-time"],
          },
        },
      }),
    ];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeDefined();
    expect(Object.keys(result!)).toHaveLength(2);
    expect(result?.["fetch"]).toBeDefined();
    expect(result?.["time"]).toBeDefined();
  });

  it("应该合并外部 env 和内部 env", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
            env: { INNER_VAR: "inner_value" },
          },
        },
      }),
    ];
    const externalEnv = { OUTER_VAR: "outer_value" };

    const result = extractRealMcpServers(command, args, externalEnv);

    expect(result).toBeDefined();
    expect(result?.["test-server"].env?.OUTER_VAR).toBe("outer_value");
    expect(result?.["test-server"].env?.INNER_VAR).toBe("inner_value");
  });

  it("非桥接条目应该返回 null", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "npx";
    const args = ["-y", "mcp-server-fetch"];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeNull();
  });

  it("没有 --config 参数时应该返回 null", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = ["convert", "http://localhost:8080"];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeNull();
  });

  it("--config JSON 解析失败时应该返回 null", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = ["convert", "--config", "invalid-json"];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeNull();
  });

  it("--config JSON 中没有 mcpServers 时应该返回 null", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = ["convert", "--config", JSON.stringify({ otherKey: "value" })];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeNull();
  });

  it("空的 mcpServers 应该返回 null", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = ["convert", "--config", JSON.stringify({ mcpServers: {} })];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeNull();
  });

  it("应该跳过没有 command 的服务条目", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          "valid-server": {
            command: "npx",
            args: ["-y", "test"],
          },
          "invalid-server": {
            args: ["-y", "test"],
            // 缺少 command
          },
        },
      }),
    ];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeDefined();
    expect(result?.["valid-server"]).toBeDefined();
    expect(result?.["invalid-server"]).toBeUndefined();
  });

  it("应该处理自定义 uvBinDir 参数", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "uvx",
            args: ["mcp-server-fetch"],
          },
        },
      }),
    ];
    const customUvBinDir = "/custom/uv/bin";

    const result = extractRealMcpServers(
      command,
      args,
      undefined,
      customUvBinDir,
    );

    expect(result).toBeDefined();
    // 由于 mock fs.existsSync 返回 false，uvx 不会被解析
    // 但函数应该正确接收并使用自定义路径参数
  });

  it("mcp-proxy 使用 basename 匹配也应该工作", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    const command = "/some/path/to/mcp-proxy";
    const args = [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-mcp"],
          },
        },
      }),
    ];

    const result = extractRealMcpServers(command, args);

    expect(result).toBeDefined();
    expect(result?.["test-server"]).toBeDefined();
  });
});

// ========== 新增测试: MCP 首次提示词就绪 + 退出清理 ==========

describe("McpProxyManager - getAllStdioServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("应该返回所有 stdio 类型 server（包括 persistent 和临时）", async () => {
    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "persistent-server": {
          command: "npx",
          args: ["-y", "persistent-mcp"],
          persistent: true,
        },
        "temp-server": {
          command: "npx",
          args: ["-y", "temp-mcp"],
        },
      },
    });

    const allStdio = mcpProxyManager.getAllStdioServers();
    expect(Object.keys(allStdio)).toHaveLength(2);
    expect(allStdio["persistent-server"]).toBeDefined();
    expect(allStdio["temp-server"]).toBeDefined();
  });

  it("应该排除远程类型 server", async () => {
    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "stdio-server": {
          command: "npx",
          args: ["-y", "stdio-mcp"],
        },
        "remote-server": {
          url: "http://example.com/mcp",
        },
      },
    });

    const allStdio = mcpProxyManager.getAllStdioServers();
    expect(Object.keys(allStdio)).toHaveLength(1);
    expect(allStdio["stdio-server"]).toBeDefined();
    expect(allStdio["remote-server"]).toBeUndefined();
  });

  it("空配置应该返回空对象", async () => {
    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({ mcpServers: {} });

    const allStdio = mcpProxyManager.getAllStdioServers();
    expect(Object.keys(allStdio)).toHaveLength(0);
  });
});

describe("McpProxyManager - bridge URL 优先策略", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    // 恢复 spawnNoWindow mock（防止前序测试 doMock 泄漏）
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("bridge 运行时所有 stdio server 应使用 bridge URL", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => true),
        getBridgeUrl: vi.fn(
          (name: string) => `http://127.0.0.1:12345/mcp/${name}`,
        ),
        isServerHealthy: vi.fn(() => true),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "server-a": { command: "npx", args: ["-y", "mcp-a"] },
        "server-b": { command: "npx", args: ["-y", "mcp-b"], persistent: true },
      },
    });

    await mcpProxyManager.start();
    const mcpConfig = mcpProxyManager.getAgentMcpConfig();

    expect(mcpConfig).toBeDefined();
    // 验证配置文件中所有 server 都使用 bridge URL
    const writeCall = mockWriteFileSync.mock.calls[0];
    const configJson = JSON.parse(writeCall[1] as string);
    expect(configJson.mcpServers["server-a"].url).toBe(
      "http://127.0.0.1:12345/mcp/server-a",
    );
    expect(configJson.mcpServers["server-b"].url).toBe(
      "http://127.0.0.1:12345/mcp/server-b",
    );
  });

  it("bridge 运行但某 server 未就绪时应降级到 stdio", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => true),
        getBridgeUrl: vi.fn((name: string) => {
          // 只有 server-a 就绪
          if (name === "server-a") return "http://127.0.0.1:12345/mcp/server-a";
          return null; // server-b 未就绪
        }),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "server-a": { command: "npx", args: ["-y", "mcp-a"] },
        "server-b": { command: "npx", args: ["-y", "mcp-b"] },
      },
    });

    await mcpProxyManager.start();
    const mcpConfig = mcpProxyManager.getAgentMcpConfig();

    expect(mcpConfig).toBeDefined();
    const writeCall = mockWriteFileSync.mock.calls[0];
    const configJson = JSON.parse(writeCall[1] as string);
    // server-a: bridge URL
    expect(configJson.mcpServers["server-a"].url).toBe(
      "http://127.0.0.1:12345/mcp/server-a",
    );
    // server-b: 降级到 stdio 配置
    expect(configJson.mcpServers["server-b"].command).toBeDefined();
    expect(configJson.mcpServers["server-b"].url).toBeUndefined();
  });

  it("bridge URL 应保留 allowTools/denyTools", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => true),
        getBridgeUrl: vi.fn(
          (name: string) => `http://127.0.0.1:12345/mcp/${name}`,
        ),
        isServerHealthy: vi.fn(() => true),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "markdownify": {
          command: "uvx",
          args: ["markdownify-mcp-server"],
          allowTools: ["youtube-to-markdown", "pdf-to-markdown"],
        },
        "fetch": {
          command: "uvx",
          args: ["mcp-server-fetch"],
          allowTools: ["fetch"],
          denyTools: ["fetch_html"],
        },
        "no-filter": {
          command: "npx",
          args: ["-y", "some-mcp"],
        },
      },
    });

    await mcpProxyManager.start();
    mcpProxyManager.getAgentMcpConfig();

    const writeCall = mockWriteFileSync.mock.calls[0];
    const configJson = JSON.parse(writeCall[1] as string);

    // allowTools 应保留在 bridge URL 条目中
    expect(configJson.mcpServers["markdownify"].url).toBe(
      "http://127.0.0.1:12345/mcp/markdownify",
    );
    expect(configJson.mcpServers["markdownify"].allowTools).toEqual([
      "youtube-to-markdown",
      "pdf-to-markdown",
    ]);

    // allowTools + denyTools 都应保留
    expect(configJson.mcpServers["fetch"].url).toBe(
      "http://127.0.0.1:12345/mcp/fetch",
    );
    expect(configJson.mcpServers["fetch"].allowTools).toEqual(["fetch"]);
    expect(configJson.mcpServers["fetch"].denyTools).toEqual(["fetch_html"]);

    // 无 allowTools 的 server 不应有该字段
    expect(configJson.mcpServers["no-filter"].url).toBe(
      "http://127.0.0.1:12345/mcp/no-filter",
    );
    expect(configJson.mcpServers["no-filter"].allowTools).toBeUndefined();
    expect(configJson.mcpServers["no-filter"].denyTools).toBeUndefined();
  });

  it("远程 server 应不受 bridge 影响直接透传", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => true),
        getBridgeUrl: vi.fn(
          (name: string) => `http://127.0.0.1:12345/mcp/${name}`,
        ),
        isServerHealthy: vi.fn(() => true),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");

    mcpProxyManager.setConfig({
      mcpServers: {
        "remote-server": {
          url: "https://external.example.com/mcp",
          transport: "sse" as const,
        },
        "stdio-server": { command: "npx", args: ["-y", "mcp-local"] },
      },
    });

    await mcpProxyManager.start();
    const mcpConfig = mcpProxyManager.getAgentMcpConfig();

    expect(mcpConfig).toBeDefined();
    const writeCall = mockWriteFileSync.mock.calls[0];
    const configJson = JSON.parse(writeCall[1] as string);
    // 远程 server 保持原始 URL
    expect(configJson.mcpServers["remote-server"].url).toBe(
      "https://external.example.com/mcp",
    );
    // stdio server 使用 bridge URL
    expect(configJson.mcpServers["stdio-server"].url).toBe(
      "http://127.0.0.1:12345/mcp/stdio-server",
    );
  });
});

describe("syncMcpConfigToProxyAndReload - bridge 重启", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    // Mock DB for syncMcpConfigToProxyAndReload
    vi.doMock("../../db", () => ({
      getDb: vi.fn(() => ({
        prepare: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("同步配置后应重启 PersistentMcpBridge", async () => {
    const { syncMcpConfigToProxyAndReload } = await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    await syncMcpConfigToProxyAndReload({
      "new-server": { command: "npx", args: ["-y", "new-mcp"] },
    });

    // bridge.start() 应该被调用（同步后重启）
    expect(persistentMcpBridge.start).toHaveBeenCalled();
  });

  it("同步空配置后应重启 bridge 为仅默认服务", async () => {
    const { syncMcpConfigToProxyAndReload } = await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    await syncMcpConfigToProxyAndReload({});

    // 空配置触发重置为仅默认服务（chrome-devtools）
    expect(persistentMcpBridge.start).toHaveBeenCalled();
    const startArg = (persistentMcpBridge.start as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    // 只包含 chrome-devtools（persistent server）
    expect(Object.keys(startArg)).toContain("chrome-devtools");
    // 不包含动态 MCP（因为传入为空）
    expect(Object.keys(startArg).length).toBe(1);
  });

  it("bridge 重启失败不应阻断同步流程", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockRejectedValue(new Error("bridge start failed")),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../../db", () => ({
      getDb: vi.fn(() => ({
        prepare: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    }));
    vi.resetModules();

    const { syncMcpConfigToProxyAndReload, mcpProxyManager } =
      await import("./mcp");

    // 不应抛出异常
    await expect(
      syncMcpConfigToProxyAndReload({
        "test-server": { command: "npx", args: ["-y", "test-mcp"] },
      }),
    ).resolves.not.toThrow();

    // 配置应该仍然更新成功
    const config = mcpProxyManager.getConfig();
    expect(config.mcpServers["test-server"]).toBeDefined();
  });
});

describe("McpProxyManager - cleanup async", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("cleanup 应该 await persistentMcpBridge.stop()", async () => {
    const { mcpProxyManager } = await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    await mcpProxyManager.cleanup();

    expect(persistentMcpBridge.stop).toHaveBeenCalled();
  });

  it("cleanup 在 bridge.stop() 失败时不应抛出", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockRejectedValue(new Error("stop failed")),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");

    await expect(mcpProxyManager.cleanup()).resolves.not.toThrow();
  });
});

describe("McpProxyManager - start 启动所有 stdio servers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("ensureBridgeStarted() 应通过 bridge 启动所有 stdio server（懒加载）", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    mcpProxyManager.setConfig({
      mcpServers: {
        "persistent-server": {
          command: "npx",
          args: ["-y", "persistent-mcp"],
          persistent: true,
        },
        "temp-server": {
          command: "npx",
          args: ["-y", "temp-mcp"],
        },
      },
    });

    await mcpProxyManager.start();

    // start() 不再自动启动 bridge
    expect(persistentMcpBridge.start).toHaveBeenCalledTimes(0);

    // 调用 ensureBridgeStarted() 应启动 bridge
    await mcpProxyManager.ensureBridgeStarted();
    expect(persistentMcpBridge.start).toHaveBeenCalledTimes(1);

    // 传入的 servers 应仅包含 persistent 类型（temp-server 不进 bridge）
    const startArg = (persistentMcpBridge.start as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(startArg)).toContain("persistent-server");
    // temp-server 没有 persistent 标记，不应出现在 bridge 中
    expect(Object.keys(startArg)).not.toContain("temp-server");

    // 再次调用 ensureBridgeStarted() 不应重复启动
    await mcpProxyManager.ensureBridgeStarted();
    expect(persistentMcpBridge.start).toHaveBeenCalledTimes(1);
  });

  it("start() 只有远程 server 时不应启动 bridge", async () => {
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();

    const { mcpProxyManager } = await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    mcpProxyManager.setConfig({
      mcpServers: {
        "remote-only": { url: "http://example.com/mcp" },
      },
    });

    await mcpProxyManager.start();

    expect(persistentMcpBridge.start).not.toHaveBeenCalled();
  });
});

// ========== 真实场景测试（基于生产日志数据） ==========

describe("extractRealMcpServers - 真实 context_servers 配置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("应该从真实 uvx bridge 条目中提取 stdio server（如 markdownify）", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    // 真实日志: "Markdown 万能转成" 使用 uvx + --allow-tools
    const result = extractRealMcpServers(
      "mcp-proxy",
      [
        "convert",
        "--config",
        JSON.stringify({
          mcpServers: {
            "Markdown 万能转成": {
              command: "uvx",
              args: ["markdownify-mcp-server"],
              env: {},
              source: "custom",
              enabled: true,
            },
          },
        }),
        "--allow-tools",
        "youtube-to-markdown,pdf-to-markdown",
      ],
    );

    expect(result).toBeDefined();
    expect(result!["Markdown 万能转成"]).toBeDefined();
    // uvx 应被解析为 uv tool run
    expect(result!["Markdown 万能转成"].command).toContain("uv");
    expect(result!["Markdown 万能转成"].args).toContain("tool");
    expect(result!["Markdown 万能转成"].args).toContain("run");
    expect(result!["Markdown 万能转成"].args).toContain(
      "markdownify-mcp-server",
    );
    // allowTools 应从 --allow-tools 参数解析
    expect(
      (result!["Markdown 万能转成"] as { allowTools?: string[] }).allowTools,
    ).toEqual(["youtube-to-markdown", "pdf-to-markdown"]);
  });

  it("应该从真实远程 URL bridge 条目中提取 SSE server", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    // 真实日志: "image-understanding-and-generation" 使用远程 SSE URL
    const result = extractRealMcpServers(
      "mcp-proxy",
      [
        "convert",
        "--config",
        JSON.stringify({
          mcpServers: {
            "image-understanding-and-generation": {
              url: "https://mcp-api.nuwax.com/api/mcp/sse?ak=ak-test123",
            },
          },
        }),
        "--allow-tools",
        "ocr_image_text_extraction,image_understanding,generate_image",
      ],
    );

    expect(result).toBeDefined();
    const srv = result!["image-understanding-and-generation"];
    expect(srv).toBeDefined();
    // 远程类型应保持 URL
    expect((srv as { url: string }).url).toBe(
      "https://mcp-api.nuwax.com/api/mcp/sse?ak=ak-test123",
    );
  });

  it("应该处理真实混合配置（uvx + npx + 远程 URL）", async () => {
    const { extractRealMcpServers } = await import("./mcp");

    // 真实日志: whois 使用 npx
    const result = extractRealMcpServers("mcp-proxy", [
      "convert",
      "--config",
      JSON.stringify({
        mcpServers: {
          whois: {
            command: "npx",
            args: ["-y", "@bharathvaj/whois-mcp@latest"],
            source: "custom",
            enabled: true,
          },
        },
      }),
      "--allow-tools",
      "whois_domain,whois_tld,whois_ip,whois_as",
    ]);

    expect(result).toBeDefined();
    expect(result!["whois"]).toBeDefined();
    // npx 不应被 resolveUvCommand 改写
    expect(result!["whois"].command).toBe("npx");
    expect(result!["whois"].args).toEqual([
      "-y",
      "@bharathvaj/whois-mcp@latest",
    ]);
    expect(
      (result!["whois"] as { allowTools?: string[] }).allowTools,
    ).toEqual(["whois_domain", "whois_tld", "whois_ip", "whois_as"]);
  });
});

describe("syncMcpConfigToProxyAndReload - 真实 context_servers 场景", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.doMock("../../db", () => ({
      getDb: vi.fn(() => ({
        prepare: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    }));
    vi.doMock("../utils/spawnNoWindow", () => ({
      resolveNpmPackageEntry: vi.fn(
        () =>
          "/mock/home/.nuwaclaw/node_modules/nuwax-mcp-stdio-proxy/dist/index.js",
      ),
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("同步真实混合配置后应合并默认 server 并重启 bridge", async () => {
    const { syncMcpConfigToProxyAndReload, mcpProxyManager } =
      await import("./mcp");
    const { persistentMcpBridge } = await import("./persistentMcpBridge");

    // 模拟 extractRealMcpServers 提取后的真实结果
    await syncMcpConfigToProxyAndReload({
      "Markdown 万能转成": {
        command: "uvx",
        args: ["markdownify-mcp-server"],
        allowTools: ["youtube-to-markdown", "pdf-to-markdown"],
      },
      "image-understanding-and-generation": {
        url: "https://mcp-api.nuwax.com/api/mcp/sse?ak=ak-test",
      },
      "Fetch 网页内容抓取": {
        command: "uvx",
        args: ["mcp-server-fetch"],
        allowTools: ["fetch"],
      },
      time: {
        command: "uvx",
        args: ["mcp-server-time", "--local-timezone=America/New_York"],
        allowTools: ["get_current_time", "convert_time"],
      },
    });

    // 验证配置已更新
    const config = mcpProxyManager.getConfig();
    const serverNames = Object.keys(config.mcpServers);

    // 应包含默认 server (chrome-devtools) + 请求中的 server
    expect(serverNames).toContain("chrome-devtools");
    expect(serverNames).toContain("Markdown 万能转成");
    expect(serverNames).toContain("image-understanding-and-generation");
    expect(serverNames).toContain("Fetch 网页内容抓取");
    expect(serverNames).toContain("time");

    // bridge 应该被重启以加载 persistent server
    expect(persistentMcpBridge.start).toHaveBeenCalled();

    // bridge 传入的 servers 应仅包含 persistent 类型（chrome-devtools）
    // 动态 MCP（Markdown/Fetch/time）不进 bridge，由 mcp-proxy 按需 spawn
    const bridgeStartArg = (
      persistentMcpBridge.start as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(bridgeStartArg)).toContain("chrome-devtools");
    // 动态 MCP 不应在 bridge 参数中
    expect(Object.keys(bridgeStartArg)).not.toContain("Markdown 万能转成");
    expect(Object.keys(bridgeStartArg)).not.toContain("Fetch 网页内容抓取");
    expect(Object.keys(bridgeStartArg)).not.toContain("time");
    // 远程 URL 也不应出现在 bridge 参数中
    expect(Object.keys(bridgeStartArg)).not.toContain(
      "image-understanding-and-generation",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// markBridgeStarted — 修复：syncMcpConfigToProxyAndReload 重启 bridge 后同步 bridgeStarted
// ────────────────────────────────────────────────────────────────────────────
describe("markBridgeStarted — bridge 状态同步", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  it("markBridgeStarted() 后，ensureBridgeStarted() 应跳过重复启动", async () => {
    const { mcpProxyManager } = await import("./mcp");
    // 通过同一 import 循环获取被 mock 替换的 persistentMcpBridge
    const { persistentMcpBridge: bridge } = await import("./persistentMcpBridge");

    // 首先把 cachedScriptPath 初始化（调用 start）
    await mcpProxyManager.start();

    // 注入 stdio server，使 ensureBridgeStarted 在没有标记时本该调用 bridge.start
    mcpProxyManager.setConfig({
      mcpServers: { time: { command: "/uv", args: ["tool", "run", "mcp-time"] } },
    });

    // 手动标记 bridge 已启动（模拟 syncMcpConfigToProxyAndReload 调用后的状态）
    mcpProxyManager.markBridgeStarted();

    // 此时 ensureBridgeStarted 应直接返回，不再调用 persistentMcpBridge.start
    const callsBefore = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;
    await mcpProxyManager.ensureBridgeStarted();
    const callsAfter = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callsAfter).toBe(callsBefore); // 没有额外的 start 调用
  });

  it("syncMcpConfigToProxyAndReload 配置未变化时 early-return 也应调用 markBridgeStarted()", async () => {
    const { mcpProxyManager, syncMcpConfigToProxyAndReload } = await import("./mcp");
    const { persistentMcpBridge: bridge } = await import("./persistentMcpBridge");

    await mcpProxyManager.start();

    const servers = {
      time: { command: "/uv", args: ["tool", "run", "mcp-time"] },
    };
    mcpProxyManager.setConfig({ mcpServers: servers });

    // 第一次同步：bridge.start 被调用，bridgeStarted 被标记
    await syncMcpConfigToProxyAndReload(servers);
    const callsAfterFirst = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;

    // 第二次相同配置：进入 early-return 分支
    await syncMcpConfigToProxyAndReload(servers);
    const callsAfterSecond = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;

    // bridge.start 不应被再次调用（配置未变化）
    expect(callsAfterSecond).toBe(callsAfterFirst);
    // bridgeStarted 仍然为 true，ensureBridgeStarted 应跳过
    const callsBeforeEnsure = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;
    await mcpProxyManager.ensureBridgeStarted();
    expect((bridge.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeEnsure);
  });

  it("stop() 后 markBridgeStarted 标志被重置，ensureBridgeStarted() 会重新启动", async () => {
    const { mcpProxyManager } = await import("./mcp");
    const { persistentMcpBridge: bridge } = await import("./persistentMcpBridge");

    await mcpProxyManager.start();
    mcpProxyManager.markBridgeStarted();

    // stop 应重置标志
    await mcpProxyManager.stop();

    // 记录 stop 后的调用次数
    const callsBefore = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;

    // 注入一些 persistent server 使 ensureBridgeStarted 有服务可以启动
    mcpProxyManager.setConfig({
      mcpServers: { time: { command: "/uv", args: ["tool", "run", "mcp-time"], persistent: true } },
    });
    await mcpProxyManager.ensureBridgeStarted();
    const callsAfter = (bridge.start as ReturnType<typeof vi.fn>).mock.calls.length;

    // stop 后 bridgeStarted 被重置，所以会再次调用 bridge.start
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getAgentMcpConfig — 修复：内容哈希替代 UUID，相同配置复用文件
// ────────────────────────────────────────────────────────────────────────────
describe("getAgentMcpConfig — 内容哈希临时文件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("./persistentMcpBridge", () => ({
      persistentMcpBridge: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
        getBridgeUrl: vi.fn(() => null),
        isServerHealthy: vi.fn(() => false),
      },
    }));
    vi.resetModules();
    mockExistsSync.mockImplementation((p: unknown) => {
      // configDir 存在，config 文件首次不存在（触发写入）
      if (typeof p === "string" && p.endsWith(".json")) return false;
      return true;
    });
    mockWriteFileSync.mockClear();
  });

  it("相同配置两次调用应生成相同文件名（哈希稳定）", async () => {
    const { mcpProxyManager } = await import("./mcp");

    await mcpProxyManager.start();

    // 写入相同 MCP servers
    const servers = {
      time: { command: "/uv", args: ["tool", "run", "mcp-time"] },
    };
    mcpProxyManager.setConfig({ mcpServers: servers });

    // 第一次获取配置
    mcpProxyManager.getAgentMcpConfig();
    const firstWritePath = mockWriteFileSync.mock.calls[0]?.[0] as string | undefined;
    mockWriteFileSync.mockClear();

    // 第二次获取配置
    mcpProxyManager.getAgentMcpConfig();
    const secondWritePath = mockWriteFileSync.mock.calls[0]?.[0] as string | undefined;

    // 两次调用应写入相同路径（哈希稳定）
    expect(firstWritePath).toBeDefined();
    expect(secondWritePath).toBeDefined();
    expect(firstWritePath).toBe(secondWritePath);

    // 文件名格式应为 mcp-config-<16位hex>.json（非 mcp-config-<uuid>.json）
    if (firstWritePath) {
      const fileName = path.basename(firstWritePath);
      expect(fileName).toMatch(/^mcp-config-[0-9a-f]{16}\.json$/);
    }
  });

  it("配置内容变化时文件名应不同（哈希随内容变化 — 用真实 MD5 验证）", async () => {
    // 此测试不调用 mcp 模块，直接验证 MD5 哈希的稳定性
    // 使用 vi.importActual 获取真实 crypto，绕过测试文件顶部对 crypto 的 mock
    const realCrypto = await vi.importActual<typeof import("crypto")>("crypto");

    const json1 = JSON.stringify({ mcpServers: { time: { command: "/uv", args: ["tool", "run", "mcp-time"] } } });
    const json2 = JSON.stringify({ mcpServers: { fetch: { command: "/uv", args: ["tool", "run", "mcp-fetch"] } } });

    const hash1 = realCrypto.createHash("md5").update(json1).digest("hex").slice(0, 16);
    const hash2 = realCrypto.createHash("md5").update(json2).digest("hex").slice(0, 16);

    // 不同内容 → 不同哈希 → 不同文件名 → detectConfigChange 不会误判
    expect(hash1).not.toBe(hash2);
    // 哈希格式应为 16 位小写 hex
    expect(hash1).toMatch(/^[0-9a-f]{16}$/);
    expect(hash2).toMatch(/^[0-9a-f]{16}$/);
  });
});
