import { LOCALHOST_IP, DEFAULT_LANPROXY_PORT } from '@shared/constants';

export interface LanproxyConfig {
  enabled: boolean;
  serverIp: string;
  serverPort: number;
  ssl: boolean;
}

export const defaultLanproxyConfig: LanproxyConfig = {
  enabled: false,
  serverIp: LOCALHOST_IP,
  serverPort: DEFAULT_LANPROXY_PORT,
  ssl: true,
};

export interface LanproxyStatus {
  running: boolean;
  pid?: number;
  error?: string;
}

class LanproxyManager {
  private config: LanproxyConfig = { ...defaultLanproxyConfig };
  private status: LanproxyStatus = { running: false };
  private process: ReturnType<typeof setInterval> | null = null;

  getConfig(): LanproxyConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<LanproxyConfig>) {
    this.config = { ...this.config, ...config };
  }

  getStatus(): LanproxyStatus {
    return { ...this.status };
  }

  async loadConfig(): Promise<void> {
    try {
      const saved = await window.electronAPI?.settings.get('lanproxy_config');
      if (saved) {
        this.config = { ...defaultLanproxyConfig, ...(saved as LanproxyConfig) };
      }
    } catch (error) {
      console.error('Failed to load lanproxy config:', error);
    }
  }

  async saveConfig(): Promise<void> {
    try {
      await window.electronAPI?.settings.set('lanproxy_config', this.config);
    } catch (error) {
      console.error('Failed to save lanproxy config:', error);
    }
  }

  // Start lanproxy via IPC — clientKey 从 auth.saved_key 读取，不由 LanproxyManager 管理
  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status.running) {
      return { success: true };
    }

    try {
      // clientKey 始终从 auth.saved_key 读取（参考 Tauri 客户端）
      const clientKey = await window.electronAPI?.settings.get('auth.saved_key') as string | null;
      if (!clientKey) {
        return { success: false, error: '请先登录以获取客户端密钥' };
      }
      const result = await window.electronAPI?.lanproxy.start({
        serverIp: this.config.serverIp,
        serverPort: this.config.serverPort,
        clientKey,
        ssl: this.config.ssl,
      });

      if (result?.success) {
        this.status.running = true;
      }
      return result || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Stop lanproxy via IPC
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.status.running) {
      return { success: true };
    }

    try {
      const result = await window.electronAPI?.lanproxy.stop();
      if (result?.success) {
        this.status.running = false;
      }
      return result || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Get status via IPC
  async checkStatus(): Promise<LanproxyStatus> {
    try {
      const status = await window.electronAPI?.lanproxy.status();
      this.status = status || { running: false };
      return this.status;
    } catch (error) {
      return { running: false, error: String(error) };
    }
  }

  // Start periodic status check
  startStatusCheck(intervalMs: number = 5000) {
    this.stopStatusCheck();
    this.process = setInterval(() => {
      this.checkStatus();
    }, intervalMs);
  }

  // Stop periodic status check
  stopStatusCheck() {
    if (this.process) {
      clearInterval(this.process);
      this.process = null;
    }
  }
}

export const lanproxyManager = new LanproxyManager();
