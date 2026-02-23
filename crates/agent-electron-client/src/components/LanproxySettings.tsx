import { useState, useEffect } from 'react';
import { lanproxyManager, LanproxyConfig, LanproxyStatus } from '../services/lanproxy';

interface LanproxySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function maskKey(key: string): string {
  if (key.length > 8) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
  }
  return key ? '****' : '(未登录)';
}

function LanproxySettings({ isOpen, onClose }: LanproxySettingsProps) {
  const [config, setConfig] = useState<LanproxyConfig>(lanproxyManager.getConfig());
  const [status, setStatus] = useState<LanproxyStatus>({ running: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [maskedClientKey, setMaskedClientKey] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkStatus();
      loadClientKey();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    await lanproxyManager.loadConfig();
    setConfig(lanproxyManager.getConfig());
  };

  const loadClientKey = async () => {
    const key = await window.electronAPI?.settings.get('auth.saved_key') as string | null;
    setMaskedClientKey(maskKey(key || ''));
  };

  const checkStatus = async () => {
    const s = await lanproxyManager.checkStatus();
    setStatus(s);
  };

  const handleSave = async () => {
    lanproxyManager.setConfig(config);
    await lanproxyManager.saveConfig();
    setMessage('配置已保存');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleStartStop = async () => {
    setLoading(true);
    setMessage('');

    try {
      if (status.running) {
        const result = await lanproxyManager.stop();
        if (result.success) {
          setMessage('内网穿透已停止');
        } else {
          setMessage(`错误: ${result.error}`);
        }
      } else {
        const result = await lanproxyManager.start();
        if (result.success) {
          setMessage('内网穿透已启动');
        } else {
          setMessage(`错误: ${result.error}`);
        }
      }
    } catch (error) {
      setMessage(`错误: ${error}`);
    }

    await checkStatus();
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content lanproxy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>内网穿透 (Lanproxy)</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="lanproxy-section">
          <div className="status-panel">
            <div className={`status-indicator ${status.running ? 'running' : 'stopped'}`}>
              {status.running ? '● 运行中' : '○ 已停止'}
            </div>
            {status.pid && <div className="pid">PID: {status.pid}</div>}
          </div>

          <button
            className={`toggle-lanproxy-btn ${status.running ? 'stop' : 'start'}`}
            onClick={handleStartStop}
            disabled={loading}
          >
            {loading ? '...' : status.running ? '停止' : '启动'}
          </button>
        </div>

        <div className="lanproxy-section">
          <h3>配置</h3>

          <div className="form-row">
            <div className="form-group">
              <label>服务器 IP</label>
              <input
                type="text"
                value={config.serverIp}
                onChange={(e) => setConfig({ ...config, serverIp: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="form-group">
              <label>服务器端口</label>
              <input
                type="number"
                value={config.serverPort}
                onChange={(e) => setConfig({ ...config, serverPort: parseInt(e.target.value) })}
                placeholder="60002"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>客户端密钥（登录后自动获取）</label>
              <input
                type="text"
                value={maskedClientKey}
                readOnly
                disabled
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
            <div className="form-group">
              <label>SSL</label>
              <select
                value={config.ssl ? 'true' : 'false'}
                onChange={(e) => setConfig({ ...config, ssl: e.target.value === 'true' })}
              >
                <option value="true">启用</option>
                <option value="false">禁用</option>
              </select>
            </div>
          </div>
        </div>

        {message && <div className="lanproxy-message">{message}</div>}

        <div className="modal-footer">
          <button className="save-btn" onClick={handleSave}>
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}

export default LanproxySettings;
