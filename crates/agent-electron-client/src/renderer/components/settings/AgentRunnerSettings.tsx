import { useState, useEffect } from 'react';
import { agentRunnerManager, AgentRunnerConfig, AgentRunnerStatus } from '../../services/agents/agentRunner';
import { DEFAULT_ANTHROPIC_API_URL } from '@shared/constants';

interface AgentRunnerSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function AgentRunnerSettings({ isOpen, onClose }: AgentRunnerSettingsProps) {
  const [config, setConfig] = useState<AgentRunnerConfig>(agentRunnerManager.getConfig());
  const [status, setStatus] = useState<AgentRunnerStatus>({ running: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkStatus();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    await agentRunnerManager.loadConfig();
    setConfig(agentRunnerManager.getConfig());
  };

  const checkStatus = async () => {
    const s = await agentRunnerManager.checkStatus();
    setStatus(s);
  };

  const handleSave = async () => {
    agentRunnerManager.setConfig(config);
    await agentRunnerManager.saveConfig();
    setMessage('配置已保存');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleStartStop = async () => {
    setLoading(true);
    setMessage('');

    try {
      if (status.running) {
        const result = await agentRunnerManager.stop();
        if (result.success) {
          setMessage('Agent Runner 已停止');
        } else {
          setMessage(`错误: ${result.error}`);
        }
      } else {
        const result = await agentRunnerManager.start();
        if (result.success) {
          setMessage('Agent Runner 已启动');
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
      <div className="modal-content agent-runner-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Agent Runner</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="agent-runner-section">
          <div className="status-panel">
            <div className={`status-indicator ${status.running ? 'running' : 'stopped'}`}>
              {status.running ? '● 运行中' : '○ 已停止'}
            </div>
            {status.pid && <div className="pid">PID: {status.pid}</div>}
          </div>

          {status.running && (
            <div className="url-info">
              <div className="url-item">
                <span className="label">后端地址:</span>
                <code>{status.backendUrl}</code>
              </div>
              <div className="url-item">
                <span className="label">代理地址:</span>
                <code>{status.proxyUrl}</code>
              </div>
            </div>
          )}

          <button
            className={`toggle-agent-btn ${status.running ? 'stop' : 'start'}`}
            onClick={handleStartStop}
            disabled={loading}
          >
            {loading ? '...' : status.running ? '停止' : '启动'}
          </button>
        </div>

        <div className="agent-runner-section">
          <h3>配置</h3>

          <div className="form-group">
            <label>可执行文件路径</label>
            <input
              type="text"
              value={config.binPath}
              onChange={(e) => setConfig({ ...config, binPath: e.target.value })}
              placeholder="nuwax-agent-core"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>后端端口</label>
              <input
                type="number"
                value={config.backendPort}
                onChange={(e) => setConfig({ ...config, backendPort: parseInt(e.target.value) })}
                placeholder="60001"
              />
            </div>
            <div className="form-group">
              <label>代理端口</label>
              <input
                type="number"
                value={config.proxyPort}
                onChange={(e) => setConfig({ ...config, proxyPort: parseInt(e.target.value) })}
                placeholder="60002"
              />
            </div>
          </div>

          <div className="form-group">
            <label>API 密钥</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-ant-..."
            />
          </div>

          <div className="form-group">
            <label>API 基础 URL</label>
            <input
              type="text"
              value={config.apiBaseUrl}
              onChange={(e) => setConfig({ ...config, apiBaseUrl: e.target.value })}
              placeholder={DEFAULT_ANTHROPIC_API_URL}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="form-group">
            <label>默认模型</label>
            <select
              value={config.defaultModel}
              onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })}
            >
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-haiku-3-20240307">Claude Haiku 3</option>
            </select>
          </div>
        </div>

        {message && <div className="agent-runner-message">{message}</div>}

        <div className="modal-footer">
          <button className="save-btn" onClick={handleSave}>
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgentRunnerSettings;
