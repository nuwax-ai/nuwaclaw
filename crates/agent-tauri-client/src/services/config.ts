/**
 * 配置管理服务
 * 支持多场景配置切换，包括服务端和本地服务配置
 * 使用 Tauri Store 替代 localStorage
 */

import { message } from "antd";
import { configStorage, initStore, type CustomScene } from "./store";
import {
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_VNC_PORT,
  DEFAULT_LOCAL_HOST,
  DEFAULT_TIMEOUT,
} from "../constants";

// ========== 构建环境配置 ==========

/**
 * 获取构建时环境
 * - 'test': 测试环境 (testagent.xspaceagi.com)
 * - 'prod': 生产环境 (agent.nuwax.com)
 * - 'local': 本地开发环境
 */
export function getBuildEnv(): "test" | "prod" | "local" {
  // __BUILD_ENV__ 由 vite.config.ts 在构建时注入
  if (typeof __BUILD_ENV__ !== "undefined") {
    return __BUILD_ENV__;
  }
  // 回退到测试环境
  return "test";
}

/**
 * 获取默认场景 ID（基于构建环境）
 */
export function getDefaultSceneId(): string {
  return getBuildEnv();
}

// ========== 类型定义 ==========

/**
 * 场景配置
 */
export interface SceneConfig {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  server: ServerConfig;
  local: LocalServicesConfig;
}

/**
 * 服务端配置
 */
export interface ServerConfig {
  apiUrl: string; // API 服务器地址
  apiKey?: string; // API 密钥
  timeout?: number; // 请求超时（毫秒）
}

/**
 * 本地服务配置
 */
export interface LocalServicesConfig {
  agent: ServiceEndpoint; // Agent 服务
  vnc: ServiceEndpoint; // VNC 服务
  fileServer: ServiceEndpoint; // 文件服务
  websocket: ServiceEndpoint; // WebSocket 服务
}

/**
 * 服务端点配置
 */
export interface ServiceEndpoint {
  host: string; // 主机地址
  port: number; // 端口
  scheme?: string; // 协议（http/https）
  path?: string; // 路径前缀
}

/**
 * 默认配置
 */
export const DEFAULT_LOCAL_SERVICES: LocalServicesConfig = {
  agent: {
    host: DEFAULT_LOCAL_HOST,
    port: DEFAULT_PROXY_PORT,
    scheme: "http",
    path: "/api",
  },
  vnc: {
    host: DEFAULT_LOCAL_HOST,
    port: DEFAULT_VNC_PORT,
    scheme: "vnc",
  },
  fileServer: {
    host: DEFAULT_LOCAL_HOST,
    port: DEFAULT_FILE_SERVER_PORT,
    scheme: "http",
    path: "/files",
  },
  websocket: {
    host: DEFAULT_LOCAL_HOST,
    port: DEFAULT_PROXY_PORT,
    scheme: "ws",
    path: "/ws",
  },
};

// ========== 预设场景 ==========

/**
 * 获取默认场景配置
 * 根据构建环境动态设置 isDefault
 */
export function getDefaultScenes(): SceneConfig[] {
  const buildEnv = getBuildEnv();

  return [
    {
      id: "local",
      name: "本地开发",
      description: "本地开发环境",
      isDefault: buildEnv === "local",
      server: {
        apiUrl: `http://localhost:${DEFAULT_PROXY_PORT}`,
        timeout: DEFAULT_TIMEOUT,
      },
      local: DEFAULT_LOCAL_SERVICES,
    },
    {
      id: "test",
      name: "测试环境",
      description: "测试服务器 (testagent.xspaceagi.com)",
      isDefault: buildEnv === "test",
      server: {
        apiUrl: "https://testagent.xspaceagi.com",
        timeout: DEFAULT_TIMEOUT,
      },
      local: {
        agent: {
          host: "test-nvwa.xspaceagi.com",
          port: DEFAULT_PROXY_PORT,
          scheme: "http",
        },
        vnc: {
          host: "test-nvwa.xspaceagi.com",
          port: DEFAULT_VNC_PORT,
          scheme: "vnc",
        },
        fileServer: {
          host: "test-nvwa.xspaceagi.com",
          port: DEFAULT_FILE_SERVER_PORT,
          scheme: "http",
        },
        websocket: {
          host: "test-nvwa.xspaceagi.com",
          port: DEFAULT_PROXY_PORT,
          scheme: "ws",
        },
      },
    },
    {
      id: "prod",
      name: "生产环境",
      description: "生产服务器 (agent.nuwax.com)",
      isDefault: buildEnv === "prod",
      server: {
        apiUrl: "https://agent.nuwax.com",
        timeout: DEFAULT_TIMEOUT,
      },
      local: {
        agent: {
          host: "nvwa.xspaceagi.com",
          port: DEFAULT_PROXY_PORT,
          scheme: "http",
        },
        vnc: {
          host: "nvwa.xspaceagi.com",
          port: DEFAULT_VNC_PORT,
          scheme: "vnc",
        },
        fileServer: {
          host: "nvwa.xspaceagi.com",
          port: DEFAULT_FILE_SERVER_PORT,
          scheme: "http",
        },
        websocket: {
          host: "nvwa.xspaceagi.com",
          port: DEFAULT_PROXY_PORT,
          scheme: "ws",
        },
      },
    },
  ];
}

/**
 * 默认场景配置（静态，兼容旧代码）
 * @deprecated 使用 getDefaultScenes() 代替
 */
export const DEFAULT_SCENES: SceneConfig[] = getDefaultScenes();

/**
 * 转换为 CustomScene 类型（用于存储）
 */
function toCustomScene(scene: SceneConfig): CustomScene {
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    isDefault: scene.isDefault,
    server: {
      apiUrl: scene.server.apiUrl,
      apiKey: scene.server.apiKey,
      timeout: scene.server.timeout,
    },
    local: scene.local as CustomScene["local"],
  };
}

/**
 * 从 CustomScene 转换为 SceneConfig
 */
function fromCustomScene(custom: CustomScene): SceneConfig {
  return {
    id: custom.id,
    name: custom.name,
    description: custom.description,
    isDefault: custom.isDefault,
    server: {
      apiUrl: custom.server.apiUrl,
      apiKey: custom.server.apiKey,
      timeout: custom.server.timeout,
    },
    local: custom.local as LocalServicesConfig,
  };
}

// ========== 配置存储服务类 ==========

/**
 * 配置服务类
 * 使用 Tauri Store 进行持久化存储
 */
class ConfigService {
  private currentSceneId: string = getDefaultSceneId();
  private customScenes: Map<string, CustomScene> = new Map();
  private initialized: boolean = false;

  /**
   * 初始化配置服务
   * 需要在应用启动时调用
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 初始化存储
    await initStore();
    await configStorage.init();

    // 加载自定义场景
    const storedCustomScenes = await configStorage.getCustomScenes();
    this.customScenes = new Map(storedCustomScenes.map((s) => [s.id, s]));

    // 加载当前场景 ID，如果没有保存过则使用构建环境默认值
    const storedSceneId = await configStorage.getCurrentSceneId();
    if (storedSceneId) {
      this.currentSceneId = storedSceneId;
    } else {
      this.currentSceneId = getDefaultSceneId();
    }

    this.initialized = true;
    console.log(
      "[ConfigService] 初始化完成，构建环境:",
      getBuildEnv(),
      "，当前场景:",
      this.currentSceneId,
      "，自定义场景数量:",
      this.customScenes.size,
    );
  }

  /**
   * 确保服务已初始化
   */
  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  // ========== 场景管理 ==========

  /**
   * 获取所有场景
   */
  async getAllScenes(): Promise<SceneConfig[]> {
    await this.ensureInit();
    const custom = Array.from(this.customScenes.values());
    return [...DEFAULT_SCENES, ...custom.map(fromCustomScene)];
  }

  /**
   * 获取当前场景
   */
  async getCurrentScene(): Promise<SceneConfig> {
    await this.ensureInit();
    return (
      (await this.getScene(this.currentSceneId)) ||
      (await this.getDefaultScene())
    );
  }

  /**
   * 获取指定场景
   */
  async getScene(id: string): Promise<SceneConfig | undefined> {
    await this.ensureInit();
    // 先查找自定义场景
    if (this.customScenes.has(id)) {
      return fromCustomScene(this.customScenes.get(id)!);
    }
    // 再查找默认场景
    return DEFAULT_SCENES.find((s) => s.id === id);
  }

  /**
   * 获取默认场景
   */
  async getDefaultScene(): Promise<SceneConfig> {
    await this.ensureInit();
    return DEFAULT_SCENES.find((s) => s.isDefault) || DEFAULT_SCENES[0];
  }

  /**
   * 切换场景
   */
  async switchScene(sceneId: string): Promise<boolean> {
    await this.ensureInit();
    const scene = await this.getScene(sceneId);
    if (!scene) {
      message.error(`场景不存在: ${sceneId}`);
      return false;
    }

    this.currentSceneId = sceneId;
    await configStorage.setCurrentSceneId(sceneId);
    message.success(`已切换到: ${scene.name}`);
    return true;
  }

  /**
   * 添加自定义场景
   */
  async addCustomScene(scene: Omit<SceneConfig, "id">): Promise<string> {
    await this.ensureInit();
    const id = `custom_${Date.now()}`;
    const newCustomScene: CustomScene = {
      ...toCustomScene(scene as SceneConfig),
      id,
    };
    this.customScenes.set(id, newCustomScene);
    await configStorage.addCustomScene(newCustomScene);
    return id;
  }

  /**
   * 更新自定义场景
   */
  async updateCustomScene(
    id: string,
    updates: Partial<SceneConfig>,
  ): Promise<boolean> {
    await this.ensureInit();
    if (!this.customScenes.has(id)) {
      return false;
    }
    const current = this.customScenes.get(id)!;
    const updated: CustomScene = {
      ...current,
      ...toCustomScene(updates as SceneConfig),
    };
    this.customScenes.set(id, updated);
    await configStorage.updateCustomScene(id, updated);
    return true;
  }

  /**
   * 删除自定义场景
   */
  async deleteCustomScene(id: string): Promise<boolean> {
    await this.ensureInit();
    if (!this.customScenes.has(id)) {
      return false;
    }
    this.customScenes.delete(id);
    if (this.currentSceneId === id) {
      const defaultScene = await this.getDefaultScene();
      this.currentSceneId = defaultScene.id;
      await configStorage.setCurrentSceneId(defaultScene.id);
    }
    await configStorage.deleteCustomScene(id);
    return true;
  }

  // ========== 配置获取快捷方法 ==========

  /**
   * 获取 API 地址
   */
  async getApiUrl(): Promise<string> {
    const scene = await this.getCurrentScene();
    return scene.server.apiUrl;
  }

  /**
   * 获取 Agent 服务地址
   */
  async getAgentUrl(): Promise<string> {
    const scene = await this.getCurrentScene();
    const { agent } = scene.local;
    return `${agent.scheme || "http"}://${agent.host}:${agent.port}${agent.path || ""}`;
  }

  /**
   * 获取 VNC 连接地址
   */
  async getVncUrl(): Promise<string> {
    const scene = await this.getCurrentScene();
    const { vnc } = scene.local;
    return `${vnc.scheme || "vnc"}://${vnc.host}:${vnc.port}`;
  }

  /**
   * 获取文件服务地址
   */
  async getFileServerUrl(): Promise<string> {
    const scene = await this.getCurrentScene();
    const { fileServer } = scene.local;
    return `${fileServer.scheme || "http"}://${fileServer.host}:${fileServer.port}${fileServer.path || ""}`;
  }

  /**
   * 获取 WebSocket 地址
   */
  async getWebSocketUrl(): Promise<string> {
    const scene = await this.getCurrentScene();
    const { websocket } = scene.local;
    return `${websocket.scheme || "ws"}://${websocket.host}:${websocket.port}${websocket.path || ""}`;
  }

  // ========== 持久化 ==========

  /**
   * 重置为默认配置
   */
  async resetToDefaults(): Promise<void> {
    await this.ensureInit();
    this.currentSceneId = (await this.getDefaultScene()).id;
    this.customScenes.clear();
    await configStorage.clear();
    await configStorage.init();
    message.success("已重置为默认配置");
  }

  /**
   * 导出配置
   */
  async exportConfig(): Promise<string> {
    await this.ensureInit();
    const data = {
      currentSceneId: this.currentSceneId,
      customScenes: Array.from(this.customScenes.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入配置
   */
  async importConfig(json: string): Promise<boolean> {
    await this.ensureInit();
    try {
      const data = JSON.parse(json);
      if (data.customScenes) {
        this.customScenes = new Map(
          data.customScenes.map((s: CustomScene) => [s.id, s]),
        );
        await configStorage.setCustomScenes(data.customScenes);
      }
      if (data.currentSceneId) {
        this.currentSceneId = data.currentSceneId;
        await configStorage.setCurrentSceneId(data.currentSceneId);
      }
      message.success("配置导入成功");
      return true;
    } catch {
      message.error("配置导入失败");
      return false;
    }
  }
}

// 单例实例
let configService: ConfigService | null = null;

/**
 * 获取配置服务实例
 */
function getConfigService(): ConfigService {
  if (!configService) {
    configService = new ConfigService();
  }
  return configService;
}

// ========== 便捷导出 ==========

/**
 * 初始化配置存储
 */
export async function initConfigStore(): Promise<void> {
  const service = getConfigService();
  await service.init();
}

/**
 * 获取所有场景
 */
export const getAllScenes = () => getConfigService().getAllScenes();

/**
 * 获取当前场景
 */
export const getCurrentScene = () => getConfigService().getCurrentScene();

/**
 * 切换场景
 */
export const switchScene = (id: string) => getConfigService().switchScene(id);

/**
 * 获取 API 地址
 */
export const getApiUrl = () => getConfigService().getApiUrl();

/**
 * 获取 Agent 服务地址
 */
export const getAgentUrl = () => getConfigService().getAgentUrl();

/**
 * 获取 VNC 连接地址
 */
export const getVncUrl = () => getConfigService().getVncUrl();

/**
 * 获取文件服务地址
 */
export const getFileServerUrl = () => getConfigService().getFileServerUrl();

/**
 * 获取 WebSocket 地址
 */
export const getWebSocketUrl = () => getConfigService().getWebSocketUrl();

/**
 * 添加自定义场景
 */
export const addCustomScene = (scene: Omit<SceneConfig, "id">) =>
  getConfigService().addCustomScene(scene);

/**
 * 更新自定义场景
 */
export const updateCustomScene = (id: string, updates: Partial<SceneConfig>) =>
  getConfigService().updateCustomScene(id, updates);

/**
 * 删除自定义场景
 */
export const deleteCustomScene = (id: string) =>
  getConfigService().deleteCustomScene(id);

/**
 * 重置配置
 */
export const resetConfig = () => getConfigService().resetToDefaults();

/**
 * 导出配置
 */
export const exportConfig = () => getConfigService().exportConfig();

/**
 * 导入配置
 */
export const importConfig = (json: string) =>
  getConfigService().importConfig(json);
