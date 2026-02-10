/**
 * 配置服务测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  configService,
  DEFAULT_SCENES,
  DEFAULT_LOCAL_SERVICES,
} from "./config";

describe("ConfigService", () => {
  beforeEach(() => {
    // 重置配置
    localStorage.clear();
    // 重新导入以获取重置后的实例
  });

  describe("预设场景", () => {
    it("应该包含本地开发场景", () => {
      const localScene = DEFAULT_SCENES.find((s) => s.id === "local");
      expect(localScene).toBeDefined();
      expect(localScene?.name).toBe("本地开发");
      expect(localScene?.server.apiUrl).toBe("http://localhost:60002");
    });

    it("应该包含测试环境场景", () => {
      const testScene = DEFAULT_SCENES.find((s) => s.id === "test");
      expect(testScene).toBeDefined();
      expect(testScene?.name).toBe("测试环境");
      expect(testScene?.server.apiUrl).toBe("https://testagent.xspaceagi.com");
    });

    it("应该包含生产环境场景", () => {
      const prodScene = DEFAULT_SCENES.find((s) => s.id === "prod");
      expect(prodScene).toBeDefined();
      expect(prodScene?.name).toBe("生产环境");
      expect(prodScene?.server.apiUrl).toBe("https://nvwa-api.xspaceagi.com");
    });

    it("应该有一个默认场景", () => {
      const defaultScene = DEFAULT_SCENES.find((s) => s.isDefault);
      expect(defaultScene).toBeDefined();
    });
  });

  describe("默认本地服务配置", () => {
    it("应该包含 Agent 服务配置", () => {
      expect(DEFAULT_LOCAL_SERVICES.agent.host).toBe("127.0.0.1");
      expect(DEFAULT_LOCAL_SERVICES.agent.port).toBe(60002);
    });

    it("应该包含 VNC 服务配置", () => {
      expect(DEFAULT_LOCAL_SERVICES.vnc.host).toBe("127.0.0.1");
      expect(DEFAULT_LOCAL_SERVICES.vnc.port).toBe(5900);
    });

    it("应该包含文件服务配置", () => {
      expect(DEFAULT_LOCAL_SERVICES.fileServer.host).toBe("127.0.0.1");
      expect(DEFAULT_LOCAL_SERVICES.fileServer.port).toBe(60000);
    });

    it("应该包含 WebSocket 服务配置", () => {
      expect(DEFAULT_LOCAL_SERVICES.websocket.host).toBe("127.0.0.1");
      expect(DEFAULT_LOCAL_SERVICES.websocket.port).toBe(60002);
    });
  });

  describe("URL 构造", () => {
    it("应该正确构造 Agent URL", () => {
      const url = `${DEFAULT_LOCAL_SERVICES.agent.scheme}://${DEFAULT_LOCAL_SERVICES.agent.host}:${DEFAULT_LOCAL_SERVICES.agent.port}`;
      expect(url).toBe("http://127.0.0.1:60002");
    });

    it("应该正确构造 VNC URL", () => {
      const url = `${DEFAULT_LOCAL_SERVICES.vnc.scheme}://${DEFAULT_LOCAL_SERVICES.vnc.host}:${DEFAULT_LOCAL_SERVICES.vnc.port}`;
      expect(url).toBe("vnc://127.0.0.1:5900");
    });

    it("应该正确构造文件服务 URL", () => {
      const url = `${DEFAULT_LOCAL_SERVICES.fileServer.scheme}://${DEFAULT_LOCAL_SERVICES.fileServer.host}:${DEFAULT_LOCAL_SERVICES.fileServer.port}`;
      expect(url).toBe("http://127.0.0.1:60000");
    });

    it("应该正确构造 WebSocket URL", () => {
      const url = `${DEFAULT_LOCAL_SERVICES.websocket.scheme}://${DEFAULT_LOCAL_SERVICES.websocket.host}:${DEFAULT_LOCAL_SERVICES.websocket.port}`;
      expect(url).toBe("ws://127.0.0.1:60002");
    });
  });

  describe("配置验证", () => {
    it("场景应该有唯一 ID", () => {
      const ids = DEFAULT_SCENES.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("场景应该有显示名称", () => {
      DEFAULT_SCENES.forEach((scene) => {
        expect(scene.name).toBeDefined();
        expect(scene.name.length).toBeGreaterThan(0);
      });
    });

    it("服务端应该有 API 地址", () => {
      DEFAULT_SCENES.forEach((scene) => {
        expect(scene.server.apiUrl).toBeDefined();
        expect(scene.server.apiUrl.length).toBeGreaterThan(0);
      });
    });
  });
});

describe("SceneConfig 类型", () => {
  it("应该支持完整的场景配置结构", () => {
    const config = {
      id: "custom",
      name: "自定义环境",
      description: "这是一个自定义配置",
      isDefault: false,
      server: {
        apiUrl: "https://custom.api.com",
        timeout: 30000,
      },
      local: DEFAULT_LOCAL_SERVICES,
    };

    expect(config.id).toBe("custom");
    expect(config.name).toBe("自定义环境");
    expect(config.server.apiUrl).toBe("https://custom.api.com");
    expect(config.local.agent.port).toBe(60002);
  });
});
