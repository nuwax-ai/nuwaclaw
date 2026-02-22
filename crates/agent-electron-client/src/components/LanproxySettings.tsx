import { useState, useEffect } from 'react';
import { lanproxyManager, LanproxyConfig, LanproxyStatus } from '../services/lanproxy';

interface LanproxySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function LanproxySettings({ isOpen, onClose }: LanproxySettingsProps) {
  const [config, setConfig] = useState<LanproxyConfig>(lanproxyManager.getConfig());
  const [status, setStatus] = useState<LanproxyStatus>({ running: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkStatus();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    await lanproxyManager.loadConfig();
    setConfig(lanproxyManager.getConfig());
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

          <div className="form-group">
            <label>可执行文件路径</label>
            <input
              type="text"
              value={config.binPath}
              onChange={(e) => setConfig({ ...config, binPath: e.target.value })}
              placeholder="nuwax-lanproxy"
            />
          </div>

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
                placeholder="60003"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>客户端密钥</label>
              <input
                type="text"
                value={config.clientKey}
                onChange={(e) => setConfig({ ...config, clientKey: e.target.value })}
                placeholder="test_key"
              />
            </div>
            <div className="form-group">
              <label>本地端口</label>
              <input
                type="number"
                value={config.localPort}
                onChange={(e) => setConfig({ ...config, localPort: parseInt(e.target.value) })}
                placeholder="60000"
              />
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
