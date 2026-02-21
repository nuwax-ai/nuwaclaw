import React, { useState, useEffect } from 'react';
import {
  Card,
  Input,
  Select,
  Button,
  Space,
  Divider,
  Typography,
  Badge,
  Form,
  Switch,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { aiService } from '../services/ai';

const { Title, Text } = Typography;

interface AgentSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function AgentSettings({ isOpen, onClose }: AgentSettingsProps) {
  const [agentType, setAgentType] = useState('nuwaxcode');
  const [binPath, setBinPath] = useState('opencode');
  const [backendPort, setBackendPort] = useState(8086);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.anthropic.com');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [running, setRunning] = useState(false);
  const [pid, setPid] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkStatus();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const saved = await window.electronAPI?.settings.get('agent_config');
      if (saved) {
        const config = saved as any;
        setAgentType(config.type || 'nuwaxcode');
        setBinPath(config.binPath || 'opencode');
        setBackendPort(config.backendPort || 8086);
        setApiKey(config.apiKey || '');
        setApiBaseUrl(config.apiBaseUrl || 'https://api.anthropic.com');
        setModel(config.model || 'claude-sonnet-4-20250514');
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const checkStatus = async () => {
    try {
      const status = await window.electronAPI?.agent.status();
      setRunning(status?.running || false);
      setPid(status?.pid);
    } catch (error) {
      console.error('Failed to check status:', error);
    }
  };

  const handleSave = async () => {
    const config = {
      type: agentType,
      binPath,
      backendPort,
      apiKey,
      apiBaseUrl,
      model,
    };
    await window.electronAPI?.settings.set('agent_config', config);
    message.success('Config saved!');
  };

  const handleStartStop = async () => {
    setLoading(true);
    try {
      if (running) {
        await window.electronAPI?.agent.stop();
        message.success('Agent stopped');
      } else {
        const result = await window.electronAPI?.agent.start({
          type: agentType as 'nuwaxcode' | 'claude-code',
          binPath,
          env: {},
          apiKey,
          apiBaseUrl,
          model,
        });
        if (result?.success) {
          message.success('Agent started');
        } else {
          message.error(`Error: ${result?.error}`);
        }
      }
    } catch (error) {
      message.error(`Error: ${error}`);
    }
    await checkStatus();
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <Card
      title={
        <Space>
          <CloudServerOutlined />
          Agent Settings
        </Space>
      }
      style={{ margin: 16 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Status Panel */}
        <Card size="small" style={{ background: '#f5f5f5' }}>
          <Space>
            <Badge status={running ? "success" : "default"} text={running ? "Running" : "Stopped"} />
            {pid && <Text type="secondary">PID: {pid}</Text>}
            <Button
              type={running ? "default" : "primary"}
              icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
              danger={running}
              onClick={handleStartStop}
              loading={loading}
            >
              {running ? "Stop" : "Start"}
            </Button>
          </Space>
        </Card>

        <Divider orientation="left">Agent Type</Divider>

        <Form layout="vertical">
          <Form.Item label="Type">
            <Select value={agentType} onChange={(v) => {
              setAgentType(v);
              setBinPath(v === 'nuwaxcode' ? 'opencode' : 'claude-code');
            }}>
              <Select.Option value="nuwaxcode">
                <Space>
                  <span>nuwaxcode (OpenCode)</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>基于 OpenCode 开发</Text>
                </Space>
              </Select.Option>
              <Select.Option value="claude-code">
                <Space>
                  <span>Claude Code</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>Anthropic 官方 CLI</Text>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Divider orientation="left">Port Configuration</Divider>

          <Form.Item label="Backend Port (直接连接)">
            <Input
              type="number"
              value={backendPort}
              onChange={(e) => setBackendPort(parseInt(e.target.value))}
              placeholder="8086"
            />
            <Text type="secondary">直接连接 Agent 服务，无需代理</Text>
          </Form.Item>

          <Divider orientation="left">API Configuration</Divider>

          <Form.Item label="Binary Path">
            <Input
              value={binPath}
              onChange={(e) => setBinPath(e.target.value)}
              placeholder={agentType === 'nuwaxcode' ? 'opencode' : 'claude-code'}
            />
          </Form.Item>

          <Form.Item label="API Key">
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
          </Form.Item>

          <Form.Item label="API Base URL">
            <Input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
            />
          </Form.Item>

          <Form.Item label="Model">
            <Select value={model} onChange={setModel}>
              <Select.Option value="claude-opus-4-20250514">Claude Opus 4</Select.Option>
              <Select.Option value="claude-sonnet-4-20250514">Claude Sonnet 4</Select.Option>
              <Select.Option value="claude-haiku-3-20240307">Claude Haiku 3</Select.Option>
            </Select>
          </Form.Item>

          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            Save Config
          </Button>
        </Form>
      </Space>
    </Card>
  );
}

export default AgentSettings;
