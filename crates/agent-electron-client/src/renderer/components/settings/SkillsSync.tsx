import { useState, useEffect, useRef } from 'react';
import { fileServerService } from '../../services/integrations/fileServer';
import { LOCAL_HOST_URL, DEFAULT_FILE_SERVER_PORT } from '@shared/constants';

interface SkillsSyncProps {
  isOpen: boolean;
  onClose: () => void;
}

function SkillsSync({ isOpen, onClose }: SkillsSyncProps) {
  const [baseUrl, setBaseUrl] = useState(`${LOCAL_HOST_URL}:${DEFAULT_FILE_SERVER_PORT}`);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    await fileServerService.loadConfig();
    const config = fileServerService.getConfig();
    setBaseUrl(config.baseUrl);
    checkConnection();
  };

  const saveConfig = async () => {
    fileServerService.setConfig({ baseUrl });
    await fileServerService.saveConfig();
    setMessage('配置已保存');
    setTimeout(() => setMessage(''), 2000);
  };

  const checkConnection = async () => {
    setChecking(true);
    const isConnected = await fileServerService.checkConnection();
    setConnected(isConnected);
    setChecking(false);
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage('请选择一个 ZIP 文件');
      return;
    }

    if (!file.name.endsWith('.zip')) {
      setMessage('仅支持 ZIP 文件');
      return;
    }

    setUploading(true);
    setMessage('');
    setLogs([]);

    try {
      // Generate unique IDs
      const userId = 'local-user';
      const cId = crypto.randomUUID();

      addLog(`正在创建工作区并同步技能...`);
      addLog(`用户 ID: ${userId}`);
      addLog(`会话 ID: ${cId}`);
      addLog(`文件: ${file.name}`);

      const result = await fileServerService.createWorkspace(userId, cId, file);

      addLog(`✓ 工作区创建成功`);
      addLog(`消息: ${result.message}`);
      setMessage('技能同步成功');
    } catch (error) {
      addLog(`✗ 错误: ${error}`);
      setMessage(`错误: ${error}`);
    } finally {
      setUploading(false);
    }
  };

  const addLog = (text: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${text}`]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMessage(`已选择: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content skills-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>技能同步（文件服务）</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="skills-sync-section">
          <h3>文件服务连接</h3>

          <div className="form-group">
            <label>服务地址</label>
            <div className="input-with-button">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={`${LOCAL_HOST_URL}:${DEFAULT_FILE_SERVER_PORT}`}
              />
              <button
                className={`check-btn ${checking ? 'checking' : ''}`}
                onClick={checkConnection}
                disabled={checking}
              >
                {checking ? '...' : connected ? '✓ 已连接' : '○ 测试连接'}
              </button>
            </div>
          </div>

          <button className="save-btn small" onClick={saveConfig}>
            保存
          </button>
        </div>

        <div className="skills-sync-section">
          <h3>上传技能包（ZIP）</h3>

          <p className="hint">
            上传包含 <code>skills/</code> 和/或 <code>agents/</code> 目录的 ZIP 文件，
            将被解压到工作区的 <code>.claude/</code> 目录中。
          </p>

          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              disabled={uploading}
            />

            <button
              className="upload-btn"
              onClick={handleUpload}
              disabled={uploading || !connected}
            >
              {uploading ? '上传中...' : '同步技能'}
            </button>
          </div>
        </div>

        {logs.length > 0 && (
          <div className="skills-sync-section">
            <h3>日志</h3>
            <div className="log-area">
              {logs.map((log, i) => (
                <div key={i} className="log-line">{log}</div>
              ))}
            </div>
          </div>
        )}

        {message && (
          <div className={`skills-sync-message ${message.includes('错误') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillsSync;
