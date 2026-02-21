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
    setMessage('Config saved!');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleStartStop = async () => {
    setLoading(true);
    setMessage('');
    
    try {
      if (status.running) {
        const result = await lanproxyManager.stop();
        if (result.success) {
          setMessage('Lanproxy stopped');
        } else {
          setMessage(`Error: ${result.error}`);
        }
      } else {
        const result = await lanproxyManager.start();
        if (result.success) {
          setMessage('Lanproxy started');
        } else {
          setMessage(`Error: ${result.error}`);
        }
      }
    } catch (error) {
      setMessage(`Error: ${error}`);
    }
    
    await checkStatus();
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content lanproxy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🌐 Lanproxy (内网穿透)</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="lanproxy-section">
          <div className="status-panel">
            <div className={`status-indicator ${status.running ? 'running' : 'stopped'}`}>
              {status.running ? '● Running' : '○ Stopped'}
            </div>
            {status.pid && <div className="pid">PID: {status.pid}</div>}
          </div>

          <button 
            className={`toggle-lanproxy-btn ${status.running ? 'stop' : 'start'}`}
            onClick={handleStartStop}
            disabled={loading}
          >
            {loading ? '...' : status.running ? 'Stop' : 'Start'}
          </button>
        </div>

        <div className="lanproxy-section">
          <h3>⚙️ Configuration</h3>
          
          <div className="form-group">
            <label>Binary Path</label>
            <input
              type="text"
              value={config.binPath}
              onChange={(e) => setConfig({ ...config, binPath: e.target.value })}
              placeholder="nuwax-lanproxy"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Server IP</label>
              <input
                type="text"
                value={config.serverIp}
                onChange={(e) => setConfig({ ...config, serverIp: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="form-group">
              <label>Server Port</label>
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
              <label>Client Key</label>
              <input
                type="text"
                value={config.clientKey}
                onChange={(e) => setConfig({ ...config, clientKey: e.target.value })}
                placeholder="test_key"
              />
            </div>
            <div className="form-group">
              <label>Local Port</label>
              <input
                type="number"
                value={config.localPort}
                onChange={(e) => setConfig({ ...config, localPort: parseInt(e.target.value) })}
                placeholder="8080"
              />
            </div>
          </div>
        </div>

        {message && <div className="lanproxy-message">{message}</div>}

        <div className="modal-footer">
          <button className="save-btn" onClick={handleSave}>
            Save Config
          </button>
        </div>
      </div>
    </div>
  );
}

export default LanproxySettings;
