export interface LanproxyConfig {
  enabled: boolean;
  binPath: string;
  serverIp: string;
  serverPort: number;
  clientKey: string;
  localPort: number;
}

export const defaultLanproxyConfig: LanproxyConfig = {
  enabled: false,
  binPath: 'nuwax-lanproxy',
  serverIp: '127.0.0.1',
  serverPort: 60003,
  clientKey: 'test_key',
  localPort: 8080,
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

  // Start lanproxy via IPC
  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status.running) {
      return { success: true };
    }

    try {
      const result = await window.electronAPI?.lanproxy.start({
        binPath: this.config.binPath,
        serverIp: this.config.serverIp,
        serverPort: this.config.serverPort,
        clientKey: this.config.clientKey,
        localPort: this.config.localPort,
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
