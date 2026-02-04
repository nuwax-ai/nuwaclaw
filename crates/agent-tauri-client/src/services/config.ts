/**
 * 配置管理服务
 * 支持多场景配置切换，包括服务端和本地服务配置
 */

import { message } from 'antd';

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
  apiUrl: string;       // API 服务器地址
  apiKey?: string;       // API 密钥
  timeout?: number;      // 请求超时（毫秒）
}

/**
 * 本地服务配置
 */
export interface LocalServicesConfig {
  agent: ServiceEndpoint;       // Agent 服务
  vnc: ServiceEndpoint;         // VNC 服务
  fileServer: ServiceEndpoint;   // 文件服务
  websocket: ServiceEndpoint;   // WebSocket 服务
}

/**
 * 服务端点配置
 */
export interface ServiceEndpoint {
  host: string;       // 主机地址
  port: number;       // 端口
  scheme?: string;    // 协议（http/https）
  path?: string;      // 路径前缀
}

/**
 * 默认配置
 */
export const DEFAULT_LOCAL_SERVICES: LocalServicesConfig = {
  agent: {
    host: '127.0.0.1',
    port: 8080,
    scheme: 'http',
    path: '/api',
  },
  vnc: {
    host: '127.0.0.1',
    port: 5900,
    scheme: 'vnc',
  },
  fileServer: {
    host: '127.0.0.1',
    port: 8081,
    scheme: 'http',
    path: '/files',
  },
  websocket: {
    host: '127.0.0.1',
    port: 8080,
    scheme: 'ws',
    path: '/ws',
  },
};

// ========== 预设场景 ==========

/**
 * 默认场景配置
 */
export const DEFAULT_SCENES: SceneConfig[] = [
  {
    id: 'local',
    name: '本地开发',
    description: '本地开发环境',
    isDefault: true,
    server: {
      apiUrl: 'http://localhost:8080',
      timeout: 30000,
    },
    local: DEFAULT_LOCAL_SERVICES,
  },
  {
    id: 'test',
    name: '测试环境',
    description: '测试服务器',
    server: {
      apiUrl: 'https://test-nvwa-api.xspaceagi.com',
      timeout: 30000,
    },
    local: {
      agent: { host: 'test-nvwa.xspaceagi.com', port: 8080, scheme: 'http' },
      vnc: { host: 'test-nvwa.xspaceagi.com', port: 5900, scheme: 'vnc' },
      fileServer: { host: 'test-nvwa.xspaceagi.com', port: 8081, scheme: 'http' },
      websocket: { host: 'test-nvwa.xspaceagi.com', port: 8080, scheme: 'ws' },
    },
  },
  {
    id: 'prod',
    name: '生产环境',
    description: '生产服务器',
    server: {
      apiUrl: 'https://nvwa-api.xspaceagi.com',
      timeout: 30000,
    },
    local: {
      agent: { host: 'nvwa.xspaceagi.com', port: 8080, scheme: 'http' },
      vnc: { host: 'nvwa.xspaceagi.com', port: 5900, scheme: 'vnc' },
      fileServer: { host: 'nvwa.xspaceagi.com', port: 8081, scheme: 'http' },
      websocket: { host: 'nvwa.xspaceagi.com', port: 8080, scheme: 'ws' },
    },
  },
];

// ========== 配置存储键 ==========

const STORAGE_KEY = 'nuwax_config';
const STORAGE_VERSION = '1';

/**
 * 配置服务类
 */
class ConfigService {
  private currentSceneId: string = 'local';
  private customScenes: Map<string, SceneConfig> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  // ========== 场景管理 ==========

  /**
   * 获取所有场景
   */
  getAllScenes(): SceneConfig[] {
    const custom = Array.from(this.customScenes.values());
    return [...DEFAULT_SCENES, ...custom];
  }

  /**
   * 获取当前场景
   */
  getCurrentScene(): SceneConfig {
    return this.getScene(this.currentSceneId) || this.getDefaultScene();
  }

  /**
   * 获取指定场景
   */
  getScene(id: string): SceneConfig | undefined {
    // 先查找自定义场景
    if (this.customScenes.has(id)) {
      return this.customScenes.get(id);
    }
    // 再查找默认场景
    return DEFAULT_SCENES.find(s => s.id === id);
  }

  /**
   * 获取默认场景
   */
  getDefaultScene(): SceneConfig {
    return DEFAULT_SCENES.find(s => s.isDefault) || DEFAULT_SCENES[0];
  }

  /**
   * 切换场景
   */
  async switchScene(sceneId: string): Promise<boolean> {
    const scene = this.getScene(sceneId);
    if (!scene) {
      message.error(`场景不存在: ${sceneId}`);
      return false;
    }

    this.currentSceneId = sceneId;
    this.saveToStorage();
    message.success(`已切换到: ${scene.name}`);
    return true;
  }

  /**
   * 添加自定义场景
   */
  addCustomScene(scene: Omit<SceneConfig, 'id'>): string {
    const id = `custom_${Date.now()}`;
    const newScene: SceneConfig = {
      ...scene,
      id,
    };
    this.customScenes.set(id, newScene);
    this.saveToStorage();
    return id;
  }

  /**
   * 更新自定义场景
   */
  updateCustomScene(id: string, updates: Partial<SceneConfig>): boolean {
    if (!this.customScenes.has(id)) {
      return false;
    }
    const scene = this.customScenes.get(id)!;
    this.customScenes.set(id, { ...scene, ...updates });
    this.saveToStorage();
    return true;
  }

  /**
   * 删除自定义场景
   */
  deleteCustomScene(id: string): boolean {
    if (!this.customScenes.has(id)) {
      return false;
    }
    this.customScenes.delete(id);
    if (this.currentSceneId === id) {
      this.currentSceneId = this.getDefaultScene().id;
    }
    this.saveToStorage();
    return true;
  }

  // ========== 配置获取快捷方法 ==========

  /**
   * 获取 API 地址
   */
  getApiUrl(): string {
    return this.getCurrentScene().server.apiUrl;
  }

  /**
   * 获取 Agent 服务地址
   */
  getAgentUrl(): string {
    const { agent } = this.getCurrentScene().local;
    return `${agent.scheme || 'http'}://${agent.host}:${agent.port}${agent.path || ''}`;
  }

  /**
   * 获取 VNC 连接地址
   */
  getVncUrl(): string {
    const { vnc } = this.getCurrentScene().local;
    return `${vnc.scheme || 'vnc'}://${vnc.host}:${vnc.port}`;
  }

  /**
   * 获取文件服务地址
   */
  getFileServerUrl(): string {
    const { fileServer } = this.getCurrentScene().local;
    return `${fileServer.scheme || 'http'}://${fileServer.host}:${fileServer.port}${fileServer.path || ''}`;
  }

  /**
   * 获取 WebSocket 地址
   */
  getWebSocketUrl(): string {
    const { websocket } = this.getCurrentScene().local;
    return `${websocket.scheme || 'ws'}://${websocket.host}:${websocket.port}${websocket.path || ''}`;
  }

  // ========== 持久化 ==========

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      const data = {
        version: STORAGE_VERSION,
        currentSceneId: this.currentSceneId,
        customScenes: Array.from(this.customScenes.values()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('保存配置失败:', error);
    }
  }

  /**
   * 从本地存储加载
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.version === STORAGE_VERSION) {
          this.currentSceneId = parsed.currentSceneId || 'local';
          if (parsed.customScenes) {
            this.customScenes = new Map(parsed.customScenes.map((s: SceneConfig) => [s.id, s]));
          }
        }
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  }

  /**
   * 重置为默认配置
   */
  resetToDefaults(): void {
    this.currentSceneId = this.getDefaultScene().id;
    this.customScenes.clear();
    this.saveToStorage();
    message.success('已重置为默认配置');
  }

  /**
   * 导出配置
   */
  exportConfig(): string {
    const data = {
      version: STORAGE_VERSION,
      currentSceneId: this.currentSceneId,
      customScenes: Array.from(this.customScenes.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入配置
   */
  importConfig(json: string): boolean {
    try {
      const data = JSON.parse(json);
      if (data.version !== STORAGE_VERSION) {
        message.warning('配置版本不兼容');
        return false;
      }
      this.currentSceneId = data.currentSceneId || 'local';
      if (data.customScenes) {
        this.customScenes = new Map(data.customScenes.map((s: SceneConfig) => [s.id, s]));
      }
      this.saveToStorage();
      message.success('配置导入成功');
      return true;
    } catch (error) {
      message.error('配置导入失败');
      return false;
    }
  }
}

// 单例导出
export const configService = new ConfigService();

// 便捷函数
export const getAllScenes = () => configService.getAllScenes();
export const getCurrentScene = () => configService.getCurrentScene();
export const switchScene = (id: string) => configService.switchScene(id);
export const getApiUrl = () => configService.getApiUrl();
export const getAgentUrl = () => configService.getAgentUrl();
export const getVncUrl = () => configService.getVncUrl();
export const getFileServerUrl = () => configService.getFileServerUrl();
export const getWebSocketUrl = () => configService.getWebSocketUrl();
export const addCustomScene = (scene: Omit<SceneConfig, 'id'>) => configService.addCustomScene(scene);
export const updateCustomScene = (id: string, updates: Partial<SceneConfig>) => configService.updateCustomScene(id, updates);
export const deleteCustomScene = (id: string) => configService.deleteCustomScene(id);
export const resetConfig = () => configService.resetToDefaults();
export const exportConfig = () => configService.exportConfig();
export const importConfig = (json: string) => configService.importConfig(json);
