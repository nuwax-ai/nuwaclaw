import { useState, useEffect } from 'react';
import { imService, IMPlatform, IMConfig } from '../../services/integrations/im';

interface IMSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const defaultConfigs: Record<IMPlatform, IMConfig> = {
  discord: { platform: 'discord', enabled: false, token: '', allowedUsers: [] },
  telegram: { platform: 'telegram', enabled: false, botToken: '', allowedUsers: [] },
  dingtalk: { platform: 'dingtalk', enabled: false, appKey: '', appSecret: '', allowedUsers: [] },
  feishu: { platform: 'feishu', enabled: false, appId: '', appSecret: '', allowedUsers: [] },
};

const PLATFORM_LABELS: Record<IMPlatform, string> = {
  discord: 'Discord',
  telegram: 'Telegram',
  dingtalk: '钉钉',
  feishu: '飞书',
};

function IMSettings({ isOpen, onClose }: IMSettingsProps) {
  const [activeTab, setActiveTab] = useState<IMPlatform>('discord');
  const [configs, setConfigs] = useState<Record<IMPlatform, IMConfig>>(defaultConfigs);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<Record<IMPlatform, boolean>>({
    discord: false,
    telegram: false,
    dingtalk: false,
    feishu: false,
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen]);

  const loadConfigs = async () => {
    await imService.loadConfigs();
    const platforms: IMPlatform[] = ['discord', 'telegram', 'dingtalk', 'feishu'];
    const newConfigs = { ...defaultConfigs };
    const newStatus = { ...status };

    for (const platform of platforms) {
      const config = imService.getConfig(platform);
      if (config) {
        newConfigs[platform] = config;
      }
      newStatus[platform] = imService.isConnected(platform);
    }

    setConfigs(newConfigs);
    setStatus(newStatus);
  };

  const handleSave = async () => {
    for (const config of Object.values(configs)) {
      imService.setConfig(config.platform, config);
    }
    await imService.saveConfigs();
    setMessage('配置已保存');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setMessage('');

    const result = await imService.connect(activeTab);

    if (result.success) {
      setStatus({ ...status, [activeTab]: true });
      setMessage(`${PLATFORM_LABELS[activeTab]} 已连接`);
    } else {
      setMessage(`错误: ${result.error}`);
    }

    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await imService.disconnect(activeTab);
    setStatus({ ...status, [activeTab]: false });
    setMessage('已断开连接');
  };

  const updateConfig = (key: keyof IMConfig, value: unknown) => {
    setConfigs({
      ...configs,
      [activeTab]: { ...configs[activeTab], [key]: value },
    });
  };

  if (!isOpen) return null;

  const currentConfig = configs[activeTab];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content im-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>即时通讯集成</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="im-tabs">
          {(['discord', 'telegram', 'dingtalk', 'feishu'] as IMPlatform[]).map((platform) => (
            <button
              key={platform}
              className={`im-tab ${activeTab === platform ? 'active' : ''} ${status[platform] ? 'connected' : ''}`}
              onClick={() => setActiveTab(platform)}
            >
              <span className="tab-icon">
                {platform === 'discord' && '💬'}
                {platform === 'telegram' && '✈️'}
                {platform === 'dingtalk' && '📎'}
                {platform === 'feishu' && '📝'}
              </span>
              <span className="tab-name">{PLATFORM_LABELS[platform]}</span>
              {status[platform] && <span className="tab-status">●</span>}
            </button>
          ))}
        </div>

        <div className="im-content">
          <div className="im-section">
            <label className="toggle-label">
              <span>启用 {PLATFORM_LABELS[activeTab]}</span>
              <input
                type="checkbox"
                checked={currentConfig.enabled}
                onChange={(e) => updateConfig('enabled', e.target.checked)}
              />
            </label>
          </div>

          {activeTab === 'discord' && (
            <div className="im-section">
              <h3>机器人配置</h3>
              <div className="form-group">
                <label>Bot Token</label>
                <input
                  type="password"
                  value={currentConfig.botToken || ''}
                  onChange={(e) => updateConfig('botToken', e.target.value)}
                  placeholder="MTEw..."
                />
              </div>
              <div className="form-group">
                <label>允许的用户 ID（逗号分隔）</label>
                <input
                  type="text"
                  value={currentConfig.allowedUsers?.join(', ') || ''}
                  onChange={(e) => updateConfig('allowedUsers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="123456789, 987654321"
                />
              </div>
            </div>
          )}

          {activeTab === 'telegram' && (
            <div className="im-section">
              <h3>机器人配置</h3>
              <div className="form-group">
                <label>Bot Token</label>
                <input
                  type="password"
                  value={currentConfig.botToken || ''}
                  onChange={(e) => updateConfig('botToken', e.target.value)}
                  placeholder="123456789:ABC..."
                />
              </div>
              <div className="form-group">
                <label>允许的用户 ID（逗号分隔）</label>
                <input
                  type="text"
                  value={currentConfig.allowedUsers?.join(', ') || ''}
                  onChange={(e) => updateConfig('allowedUsers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="123456789"
                />
              </div>
            </div>
          )}

          {activeTab === 'dingtalk' && (
            <div className="im-section">
              <h3>应用配置</h3>
              <div className="form-group">
                <label>App Key</label>
                <input
                  type="text"
                  value={currentConfig.appKey || ''}
                  onChange={(e) => updateConfig('appKey', e.target.value)}
                  placeholder="ding..."
                />
              </div>
              <div className="form-group">
                <label>App Secret</label>
                <input
                  type="password"
                  value={currentConfig.appSecret || ''}
                  onChange={(e) => updateConfig('appSecret', e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'feishu' && (
            <div className="im-section">
              <h3>应用配置</h3>
              <div className="form-group">
                <label>App ID</label>
                <input
                  type="text"
                  value={currentConfig.appId || ''}
                  onChange={(e) => updateConfig('appId', e.target.value)}
                  placeholder="cli_..."
                />
              </div>
              <div className="form-group">
                <label>App Secret</label>
                <input
                  type="password"
                  value={currentConfig.appSecret || ''}
                  onChange={(e) => updateConfig('appSecret', e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="im-section">
            <h3>选项</h3>
            <label className="toggle-label">
              <span>自动回复</span>
              <input
                type="checkbox"
                checked={currentConfig.autoReply || false}
                onChange={(e) => updateConfig('autoReply', e.target.checked)}
              />
            </label>
          </div>
        </div>

        {message && <div className="im-message">{message}</div>}

        <div className="im-actions">
          {status[activeTab] ? (
            <button className="disconnect-btn" onClick={handleDisconnect}>
              断开连接
            </button>
          ) : (
            <button
              className="connect-btn"
              onClick={handleConnect}
              disabled={connecting || !currentConfig.enabled}
            >
              {connecting ? '连接中...' : '连接'}
            </button>
          )}
          <button className="save-btn" onClick={handleSave}>
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}

export default IMSettings;
