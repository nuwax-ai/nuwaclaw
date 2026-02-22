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
      console.error('加载 MCP 配置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      await window.electronAPI?.settings.set('mcp_config', mcpManager.exportConfig());
      setMessage('MCP 配置已保存');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage('保存失败');
    }
  };

  const handleInstall = async (serverId: string) => {
    setInstalling(serverId);
    setMessage('');
    try {
      const result = await mcpManager.installServer(serverId);
      if (result.success) {
        setMessage(`${serverId} 安装成功`);
      } else {
        setMessage(`安装失败: ${result.error}`);
      }
      setServers([...mcpManager.getServers()]);
    } catch (error) {
      setMessage(`错误: ${error}`);
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
        setMessage(`${serverId} 已卸载`);
      } else {
        setMessage(`卸载失败: ${result.error}`);
      }
      setServers([...mcpManager.getServers()]);
    } catch (error) {
      setMessage(`错误: ${error}`);
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
        setMessage(`启动失败: ${result.error}`);
      }
    } else {
      await mcpManager.stopServer(serverId);
    }
    setServers([...mcpManager.getServers()]);
  };

  const handleDelete = async (serverId: string) => {
    await mcpManager.removeServer(serverId);
    setServers([...mcpManager.getServers()]);
    setMessage('服务已移除');
  };

  const handleAddServer = async () => {
    if (!newServer.id || !newServer.name || !newServer.args) {
      setMessage('请填写必填字段');
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
    setMessage('服务已添加，请保存配置以持久化');
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
          <h2>MCP 服务管理</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <>
            <div className="mcp-section">
              <h3>NPM 镜像源</h3>
              <div className="registry-options">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.default}
                    onChange={() => handleRegistryChange(npmRegistries.default)}
                  />
                  <span>npmjs.org（官方）</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.taobao}
                    onChange={() => handleRegistryChange(npmRegistries.china.taobao)}
                  />
                  <span>淘宝镜像</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.tencent}
                    onChange={() => handleRegistryChange(npmRegistries.china.tencent)}
                  />
                  <span>腾讯镜像</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="registry"
                    checked={registry === npmRegistries.china.aliyun}
                    onChange={() => handleRegistryChange(npmRegistries.china.aliyun)}
                  />
                  <span>阿里云镜像</span>
                </label>
              </div>
            </div>

            <div className="mcp-section">
              <div className="section-header">
                <h3>可用服务</h3>
                <button className="add-btn" onClick={() => setShowAddForm(!showAddForm)}>
                  {showAddForm ? '− 取消' : '+ 添加自定义'}
                </button>
              </div>

              {showAddForm && (
                <div className="add-form">
                  <div className="form-row">
                    <input
                      type="text"
                      placeholder="ID（如 my-server）"
                      value={newServer.id}
                      onChange={(e) => setNewServer({ ...newServer, id: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="名称"
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
                      placeholder="参数（如 -y @scope/package arg1 arg2）"
                      value={newServer.args}
                      onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="描述（可选）"
                    value={newServer.description}
                    onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                  />
                  <button className="add-confirm-btn" onClick={handleAddServer}>
                    添加服务
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
                        {server.running && <span className="status-badge running">运行中</span>}
                        {server.installed && !server.running && <span className="status-badge installed">已安装</span>}
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
                          {installing === server.id ? '...' : '卸载'}
                        </button>
                      ) : (
                        <button
                          className="action-btn install"
                          onClick={() => handleInstall(server.id)}
                          disabled={installing === server.id}
                        >
                          {installing === server.id ? '...' : '安装'}
                        </button>
                      )}
                      <button
                        className="action-btn delete"
                        onClick={() => handleDelete(server.id)}
                        title="移除服务"
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
                保存配置
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MCPSettings;
