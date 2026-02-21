import { useState, useEffect, useRef } from 'react';
import { fileServerService } from '../services/fileServer';

interface SkillsSyncProps {
  isOpen: boolean;
  onClose: () => void;
}

function SkillsSync({ isOpen, onClose }: SkillsSyncProps) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080');
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
    setMessage('Config saved!');
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
      setMessage('Please select a zip file');
      return;
    }

    if (!file.name.endsWith('.zip')) {
      setMessage('Only zip files are supported');
      return;
    }

    setUploading(true);
    setMessage('');
    setLogs([]);

    try {
      // Generate unique IDs
      const userId = 'local-user';
      const cId = crypto.randomUUID();

      addLog(`Creating workspace with skills sync...`);
      addLog(`User ID: ${userId}`);
      addLog(`Session ID: ${cId}`);
      addLog(`File: ${file.name}`);

      const result = await fileServerService.createWorkspace(userId, cId, file);
      
      addLog(`✓ Workspace created successfully`);
      addLog(`Message: ${result.message}`);
      setMessage('Skills synced successfully!');
    } catch (error) {
      addLog(`✗ Error: ${error}`);
      setMessage(`Error: ${error}`);
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
      setMessage(`Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content skills-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📁 Skills Sync (via File Server)</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="skills-sync-section">
          <h3>🔗 File Server Connection</h3>
          
          <div className="form-group">
            <label>Server URL</label>
            <div className="input-with-button">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:8080"
              />
              <button 
                className={`check-btn ${checking ? 'checking' : ''}`}
                onClick={checkConnection}
                disabled={checking}
              >
                {checking ? '...' : connected ? '✓ Connected' : '○ Test'}
              </button>
            </div>
          </div>

          <button className="save-btn small" onClick={saveConfig}>
            Save
          </button>
        </div>

        <div className="skills-sync-section">
          <h3>📦 Upload Skills (ZIP)</h3>
          
          <p className="hint">
            Upload a ZIP file containing <code>skills/</code> and/or <code>agents/</code> directories.
            They will be extracted to <code>.claude/</code> in the workspace.
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
              {uploading ? 'Uploading...' : 'Sync Skills'}
            </button>
          </div>
        </div>

        {logs.length > 0 && (
          <div className="skills-sync-section">
            <h3>📋 Logs</h3>
            <div className="log-area">
              {logs.map((log, i) => (
                <div key={i} className="log-line">{log}</div>
              ))}
            </div>
          </div>
        )}

        {message && (
          <div className={`skills-sync-message ${message.includes('Error') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillsSync;
