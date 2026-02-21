import { useState } from 'react';
import { mcpManager, MCPServer, npmRegistries } from '../services/mcp';

interface MCPSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function MCPSettings({ isOpen, onClose }: MCPSettingsProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [registry, setRegistry] = useState(npmRegistries.default);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState({
    id: '',
    name: '',
    command: 'npx',
    args: '',
    description: '',
  });

  // Load config on mount
  if (isOpen && servers.length === 0 && loading) {
    loadConfig();
  }

  const loadConfig = async () => {
    setLoading(true);
    try {
      const saved = await window.electronAPI?.settings.get('mcp_config');
      if (saved) {
        await mcpManager.loadConfig(saved as Parameters<typeof mcpManager.loadConfig>[0]);
      }
      
      const serverList = mcpManager.getServers();
      for (const server of serverList) {
        await mcpManager.checkInstalled(server.id);
      }
      
      setServers([...mcpManager.getServers()]);
      setRegistry(mcpManager.getRegistry());
    } catch (error) {
      console.error('Failed to load MCP config:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      await window.electronAPI?.settings.set('mcp_config', mcpManager.exportConfig());
      setMessage('MCP config saved!');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('Failed to save');
    }
  };

  const handleInstall = async (serverId: string) => {
    setInstalling(serverId);
    setMessage('');
    try {
      const result = await mcpManager.installServer(serverId);
      if (result.success) {
        setMessage(`${serverId} installed!`);
      } else {
        setMessage(`Install failed: ${result.error}`);
      }
      setServers([...mcpManager.getServers()]);
    } catch (error) {
      setMessage(`Error: ${error}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (serverId: string) => {
    setInstalling(serverId);
    setMessage('');
    try {
      const result = await mcpManager.uninstallServer(serverId);
      if (result.success) {
        setMessage(`${serverId} uninstalled!`);
      } else {
        setMessage(`Uninstall failed: ${result.error}`);
      }
      setServers([...mcpManager.getServers()]);
    } catch (error) {
      setMessage(`Error: ${error}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleToggle = async (serverId: string, enabled: boolean) => {
    mcpManager.toggleServer(serverId, enabled);
    setServers([...mcpManager.getServers()]);
    
    if (enabled) {
      const result = await mcpManager.startServer(serverId);
      if (!result.success) {
        setMessage(`Start failed: ${result.error}`);
      }
    } else {
      await mcpManager.stopServer(serverId);
    }
    setServers([...mcpManager.getServers()]);
  };

  const handleDelete = async (serverId: string) => {
    await mcpManager.removeServer(serverId);
    setServers([...mcpManager.getServers()]);
    setMessage('Server removed');
  };

  const handleAddServer = async () => {
    if (!newServer.id || !newServer.name || !newServer.args) {
      setMessage('Please fill required fields');
      return;
    }

    const args = newServer.args.split(' ').filter(Boolean);
    
    await mcpManager.addServer({
      id: newServer.id.toLowerCase().replace(/\s+/g, '-'),
      name: newServer.name,
      command: newServer.command,
      args,
      description: newServer.description,
      enabled: false,
    });

    setServers([...mcpManager.getServers()]);
    setShowAddForm(false);
    setNewServer({ id: '', name: '', command: 'npx', args: '', description: '' });
    setMessage('Server added! Save config to persist.');
  };

  const handleRegistryChange = (newRegistry: string) => {
    setRegistry(newRegistry);
    mcpManager.setRegistry(newRegistry);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content mcp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔌 MCP Servers</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <>
            <div className="mcp-section">
              <h3>📦 NPM Registry</h3>
              <div className="registry-options">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.default}
                    onChange={() => handleRegistryChange(npmRegistries.default)}
                  />
                  <span>🇺🇸 npmjs.org</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.taobao}
                    onChange={() => handleRegistryChange(npmRegistries.china.taobao)}
                  />
                  <span>🇨🇳 淘宝镜像</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.tencent}
                    onChange={() => handleRegistryChange(npmRegistries.china.tencent)}
                  />
                  <span>🇨🇳 腾讯镜像</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.aliyun}
                    onChange={() => handleRegistryChange(npmRegistries.china.aliyun)}
                  />
                  <span>🇨🇳 阿里云</span>
                </label>
              </div>
            </div>

            <div className="mcp-section">
              <div className="section-header">
                <h3>🖥️ Available Servers</h3>
                <button className="add-btn" onClick={() => setShowAddForm(!showAddForm)}>
                  {showAddForm ? '− Cancel' : '+ Add Custom'}
                </button>
              </div>

              {showAddForm && (
                <div className="add-form">
                  <div className="form-row">
                    <input
                      type="text"
                      placeholder="ID (e.g., my-server)"
                      value={newServer.id}
                      onChange={(e) => setNewServer({ ...newServer, id: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Name"
                      value={newServer.name}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <select
                      value={newServer.command}
                      onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                    >
                      <option value="npx">npx</option>
                      <option value="node">node</option>
                      <option value="python">python</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Args (e.g., -y @scope/package arg1 arg2)"
                      value={newServer.args}
                      onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newServer.description}
                    onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                  />
                  <button className="add-confirm-btn" onClick={handleAddServer}>
                    Add Server
                  </button>
                </div>
              )}

              <div className="server-list">
                {servers.map((server) => (
                  <div key={server.id} className={`server-item ${server.running ? 'running' : ''}`}>
                    <div className="server-info">
                      <div className="server-header">
                        <span className="server-name">{server.name}</span>
                        <span className="server-id">({server.id})</span>
                        {server.running && <span className="status-badge running">Running</span>}
                        {server.installed && !server.running && <span className="status-badge installed">Installed</span>}
                      </div>
                      <div className="server-desc">{server.description}</div>
                      <div className="server-cmd">
                        <code>{server.command} {server.args.join(' ')}</code>
                      </div>
                    </div>
                    <div className="server-actions">
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          disabled={!server.installed}
                          onChange={(e) => handleToggle(server.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      {server.installed ? (
                        <button
                          className="action-btn uninstall"
                          onClick={() => handleUninstall(server.id)}
                          disabled={installing === server.id || server.running}
                        >
                          {installing === server.id ? '...' : 'Uninstall'}
                        </button>
                      ) : (
                        <button
                          className="action-btn install"
                          onClick={() => handleInstall(server.id)}
                          disabled={installing === server.id}
                        >
                          {installing === server.id ? '...' : 'Install'}
                        </button>
                      )}
                      <button
                        className="action-btn delete"
                        onClick={() => handleDelete(server.id)}
                        title="Remove server"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {message && <div className="mcp-message">{message}</div>}

            <div className="modal-footer">
              <button className="save-btn" onClick={saveConfig}>
                Save Config
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MCPSettings;
