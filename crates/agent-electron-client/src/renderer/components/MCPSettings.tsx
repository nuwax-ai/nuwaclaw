/**
 * MCP Proxy 设置组件
 *
 * 使用 nuwax-mcp-stdio-proxy 聚合代理模式管理 MCP 服务。
 * 所有操作通过 window.electronAPI.mcp.* IPC 通道。
 */

import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Badge,
  Input,
  Form,
  Typography,
  Divider,
  message,
  Popconfirm,
} from 'antd';
import {
  PlayCircleOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import type { McpServersConfig, McpProxyStatus } from '@shared/types/electron';

const { Text } = Typography;

interface MCPSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function MCPSettings({ isOpen, onClose }: MCPSettingsProps) {
  const [config, setConfig] = useState<McpServersConfig>({ mcpServers: {} });
  const [status, setStatus] = useState<McpProxyStatus>({ running: false });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // 新增 server 表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServerId, setNewServerId] = useState('');
  const [newServerCommand, setNewServerCommand] = useState('npx');
  const [newServerArgs, setNewServerArgs] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [isOpen]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [savedConfig, currentStatus] = await Promise.all([
        window.electronAPI?.mcp.getConfig(),
        window.electronAPI?.mcp.status(),
      ]);
      if (savedConfig) setConfig(savedConfig);
      if (currentStatus) setStatus(currentStatus);
    } catch (error) {
      console.error('[MCPSettings] 加载失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const currentStatus = await window.electronAPI?.mcp.status();
      if (currentStatus) setStatus(currentStatus);
    } catch {}
  };

  const handleSaveConfig = async () => {
    try {
      await window.electronAPI?.mcp.setConfig(config);
      message.success('MCP 配置已保存');
    } catch (error) {
      message.error('保存失败');
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      // 先保存配置
      await window.electronAPI?.mcp.setConfig(config);

      const result = await window.electronAPI?.mcp.start();
      if (result?.success) {
        message.success('MCP Proxy 就绪');
      } else {
        message.error(`检测失败: ${result?.error}`);
      }
    } catch (error) {
      message.error(`错误: ${error}`);
    } finally {
      await refreshStatus();
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      await window.electronAPI?.mcp.setConfig(config);

      const result = await window.electronAPI?.mcp.restart();
      if (result?.success) {
        message.success('MCP Proxy 就绪');
      } else {
        message.error(`检测失败: ${result?.error}`);
      }
    } catch (error) {
      message.error(`错误: ${error}`);
    } finally {
      await refreshStatus();
      setActionLoading(false);
    }
  };

  const handleAddServer = () => {
    if (!newServerId.trim()) {
      message.warning('请输入 Server ID');
      return;
    }
    if (!newServerArgs.trim()) {
      message.warning('请输入参数');
      return;
    }

    const id = newServerId.trim().toLowerCase().replace(/\s+/g, '-');
    const args = newServerArgs.split(' ').filter(Boolean);

    setConfig({
      mcpServers: {
        ...config.mcpServers,
        [id]: {
          command: newServerCommand,
          args,
        },
      },
    });

    setNewServerId('');
    setNewServerCommand('npx');
    setNewServerArgs('');
    setShowAddForm(false);
    message.info('已添加，记得保存配置');
  };

  const handleRemoveServer = (id: string) => {
    const { [id]: _, ...rest } = config.mcpServers;
    setConfig({ mcpServers: rest });
    message.info('已移除，记得保存配置');
  };

  const handleUpdateServerArgs = (id: string, argsStr: string) => {
    const args = argsStr.split(' ').filter(Boolean);
    setConfig({
      mcpServers: {
        ...config.mcpServers,
        [id]: {
          ...config.mcpServers[id],
          args,
        },
      },
    });
  };

  if (!isOpen) return null;

  const serverEntries = Object.entries(config.mcpServers || {});

  return (
    <Card
      title={
        <Space>
          <ApiOutlined />
          MCP Proxy 服务管理
        </Space>
      }
      extra={<Button size="small" onClick={onClose}>关闭</Button>}
      style={{ margin: 16 }}
      loading={loading}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* Status & Controls */}
        <Card size="small" style={{ background: '#f5f5f5' }}>
          <Space wrap>
            <Badge
              status={status.running ? 'success' : 'default'}
              text={status.running ? '就绪' : '未就绪'}
            />
            <Text type="secondary">
              {status.serverCount ?? 0} 个 Server
            </Text>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={actionLoading}
              size="small"
            >
              检测可用性
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRestart}
              loading={actionLoading}
              size="small"
            >
              刷新
            </Button>
          </Space>
        </Card>

        <Divider orientation="left" style={{ margin: '8px 0' }}>
          MCP Servers 配置
        </Divider>

        {/* Server List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {serverEntries.length === 0 && (
            <Text type="secondary" style={{ textAlign: 'center', padding: 16 }}>
              暂无 MCP Server 配置
            </Text>
          )}

          {serverEntries.map(([id, entry]) => (
            <Card
              key={id}
              size="small"
              style={{ border: '1px solid #e4e4e7' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong>{id}</Text>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {entry.command} {entry.args.join(' ')}
                    </Text>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Input
                      size="small"
                      addonBefore={entry.command}
                      value={entry.args.join(' ')}
                      onChange={(e) => handleUpdateServerArgs(id, e.target.value)}
                      placeholder="参数"
                    />
                  </div>
                </div>
                <Popconfirm
                  title="确定移除？"
                  onConfirm={() => handleRemoveServer(id)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>

        {/* Add Server Form */}
        {showAddForm ? (
          <Card size="small" style={{ border: '1px dashed #d4d4d8' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Input
                size="small"
                placeholder="Server ID（如 chrome-devtools）"
                value={newServerId}
                onChange={(e) => setNewServerId(e.target.value)}
              />
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  size="small"
                  style={{ width: 80 }}
                  value={newServerCommand}
                  onChange={(e) => setNewServerCommand(e.target.value)}
                  placeholder="命令"
                />
                <Input
                  size="small"
                  value={newServerArgs}
                  onChange={(e) => setNewServerArgs(e.target.value)}
                  placeholder="参数（如 -y chrome-devtools-mcp@latest）"
                />
              </Space.Compact>
              <Space>
                <Button size="small" type="primary" onClick={handleAddServer}>
                  添加
                </Button>
                <Button size="small" onClick={() => setShowAddForm(false)}>
                  取消
                </Button>
              </Space>
            </Space>
          </Card>
        ) : (
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setShowAddForm(true)}
            block
            size="small"
          >
            添加 MCP Server
          </Button>
        )}

        {/* Save */}
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSaveConfig}
          block
        >
          保存配置
        </Button>

        <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', display: 'block' }}>
          配置修改后需保存，Agent 下次初始化时自动生效
        </Text>
      </Space>
    </Card>
  );
}

export default MCPSettings;
