export type IMPlatform = 'discord' | 'telegram' | 'dingtalk' | 'feishu';

export interface IMConfig {
  platform: IMPlatform;
  enabled: boolean;
  token?: string;
  botToken?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  autoReply?: boolean;
}

export interface IMLogin {
  platform: IMPlatform;
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
}

export interface IMMessage {
  id: string;
  platform: IMPlatform;
  sender: IMLogin;
  content: string;
  timestamp: number;
  channelId?: string;
  groupId?: string;
  isGroup: boolean;
  replyTo?: string;
}

export interface IMSendOptions {
  content: string;
  channelId?: string;
  userId?: string;
  replyTo?: string;
  markdown?: boolean;
}

class IMService {
  private configs: Map<IMPlatform, IMConfig> = new Map();
  private handlers: Map<IMPlatform, (message: IMMessage) => void> = new Map();
  private connections: Map<IMPlatform, boolean> = new Map();

  constructor() {
    // Initialize with empty configs
    this.configs.set('discord', { platform: 'discord', enabled: false });
    this.configs.set('telegram', { platform: 'telegram', enabled: false });
    this.configs.set('dingtalk', { platform: 'dingtalk', enabled: false });
    this.configs.set('feishu', { platform: 'feishu', enabled: false });
  }

  getConfig(platform: IMPlatform): IMConfig | undefined {
    return this.configs.get(platform);
  }

  setConfig(platform: IMPlatform, config: Partial<IMConfig>): void {
    const current = this.configs.get(platform) || { platform, enabled: false };
    this.configs.set(platform, { ...current, ...config });
  }

  getEnabledPlatforms(): IMPlatform[] {
    return Array.from(this.configs.entries())
      .filter(([_, config]) => config.enabled)
      .map(([platform]) => platform);
  }

  isConnected(platform: IMPlatform): boolean {
    return this.connections.get(platform) || false;
  }

  onMessage(platform: IMPlatform, handler: (message: IMMessage) => void): void {
    this.handlers.set(platform, handler);
  }

  async connect(platform: IMPlatform): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.get(platform);
    if (!config || !config.enabled) {
      return { success: false, error: 'Platform not enabled' };
    }

    try {
      // Platform-specific connection logic
      switch (platform) {
        case 'discord':
          return await this.connectDiscord(config);
        case 'telegram':
          return await this.connectTelegram(config);
        case 'dingtalk':
          return await this.connectDingtalk(config);
        case 'feishu':
          return await this.connectFeishu(config);
        default:
          return { success: false, error: 'Unknown platform' };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async disconnect(platform: IMPlatform): Promise<void> {
    this.connections.set(platform, false);
  }

  async sendMessage(platform: IMPlatform, options: IMSendOptions): Promise<{ success: boolean; error?: string }> {
    if (!this.connections.get(platform)) {
      return { success: false, error: 'Not connected' };
    }

    try {
      switch (platform) {
        case 'discord':
          return await this.sendDiscordMessage(options);
        case 'telegram':
          return await this.sendTelegramMessage(options);
        case 'dingtalk':
          return await this.sendDingtalkMessage(options);
        case 'feishu':
          return await this.sendFeishuMessage(options);
        default:
          return { success: false, error: 'Unknown platform' };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Discord implementation
  private async connectDiscord(config: IMConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.botToken) {
      return { success: false, error: 'Bot token required' };
    }
    
    // Test API connection
    try {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { 'Authorization': `Bot ${config.botToken}` }
      });
      
      if (response.ok) {
        this.connections.set('discord', true);
        return { success: true };
      }
      return { success: false, error: 'Invalid bot token' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async sendDiscordMessage(options: IMSendOptions): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.get('discord');
    if (!config?.botToken || !options.channelId) {
      return { success: false, error: 'Missing configuration' };
    }

    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${options.channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: options.content })
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Telegram implementation
  private async connectTelegram(config: IMConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.botToken) {
      return { success: false, error: 'Bot token required' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
      const data = await response.json();
      
      if (data.ok) {
        this.connections.set('telegram', true);
        return { success: true };
      }
      return { success: false, error: 'Invalid bot token' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async sendTelegramMessage(options: IMSendOptions): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.get('telegram');
    if (!config?.botToken || !options.userId) {
      return { success: false, error: 'Missing configuration' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: options.userId,
          text: options.content,
        })
      });

      return { success: response.ok };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // DingTalk implementation
  private async connectDingtalk(config: IMConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.appKey || !config.appSecret) {
      return { success: false, error: 'AppKey and AppSecret required' };
    }

    try {
      // Get access token
      const tokenResponse = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appKey: config.appKey,
          appSecret: config.appSecret,
        })
      });

      const data = await tokenResponse.json();
      
      if (data.accessToken) {
        this.connections.set('dingtalk', true);
        return { success: true };
      }
      return { success: false, error: 'Failed to get access token' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async sendDingtalkMessage(options: IMSendOptions): Promise<{ success: boolean; error?: string }> {
    // DingTalk webhook implementation
    if (!options.userId) {
      return { success: false, error: 'User ID required' };
    }

    return { success: true }; // Placeholder
  }

  // Feishu ( Lark ) implementation
  private async connectFeishu(config: IMConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.appId || !config.appSecret) {
      return { success: false, error: 'AppId and AppSecret required' };
    }

    try {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: config.appId,
          app_secret: config.appSecret,
        })
      });

      const data = await response.json();
      
      if (data.tenant_access_token) {
        this.connections.set('feishu', true);
        return { success: true };
      }
      return { success: false, error: 'Failed to get tenant token' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async sendFeishuMessage(options: IMSendOptions): Promise<{ success: boolean; error?: string }> {
    if (!options.userId) {
      return { success: false, error: 'User ID required' };
    }

    return { success: true }; // Placeholder
  }

  // Load/save config
  async loadConfigs(): Promise<void> {
    try {
      const saved = await window.electronAPI?.settings.get('im_configs');
      if (saved) {
        const configs = saved as IMConfig[];
        for (const config of configs) {
          this.configs.set(config.platform, config);
        }
      }
    } catch (error) {
      console.error('Failed to load IM configs:', error);
    }
  }

  async saveConfigs(): Promise<void> {
    try {
      const configs = Array.from(this.configs.values());
      await window.electronAPI?.settings.set('im_configs', configs);
    } catch (error) {
      console.error('Failed to save IM configs:', error);
    }
  }
}

export const imService = new IMService();
