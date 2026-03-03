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
import { DEFAULT_ANTHROPIC_API_URL, DEFAULT_AI_MODEL } from '@shared/constants';
import { aiService } from '../../services/core/ai';

const { Title, Text } = Typography;

interface AgentSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function AgentSettings({ isOpen, onClose }: AgentSettingsProps) {
  const [agentType, setAgentType] = useState('claude-code');
  const [binPath, setBinPath] = useState('claude');
  const [backendPort, setBackendPort] = useState(60001);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_ANTHROPIC_API_URL);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [running, setRunning] = useState(false);
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
        setAgentType(config.type || 'claude-code');
        setBinPath(config.binPath || 'claude');
        setBackendPort(config.backendPort || 60001);
        setApiKey(config.apiKey || '');
        setApiBaseUrl(config.apiBaseUrl || DEFAULT_ANTHROPIC_API_URL);
        setModel(config.model || DEFAULT_AI_MODEL);
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const checkStatus = async () => {
    try {
      const status = await window.electronAPI?.agent.serviceStatus();
      setRunning(status?.running || false);
    } catch (error) {
      console.error('检查状态失败:', error);
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
    message.success('配置已保存');
  };

  const handleStartStop = async () => {
    setLoading(true);
    try {
      if (running) {
        await window.electronAPI?.agent.destroy();
        message.success('Agent 已停止');
      } else {
        const step1 = await window.electronAPI?.settings.get('step1_config') as { workspaceDir?: string } | null;
        const result = await window.electronAPI?.agent.init({
          engine: agentType === 'claude-code' ? 'claude-code' : 'nuwaxcode',
          apiKey,
          baseUrl: apiBaseUrl,
          model,
          workspaceDir: step1?.workspaceDir || '',
          port: backendPort,
          engineBinaryPath: binPath || undefined,
        });
        if (result?.success) {
          message.success('Agent 启动成功');
        } else {
          message.error(`启动失败: ${result?.error}`);
        }
      }
    } catch (error) {
      message.error(`错误: ${error}`);
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
          Agent 引擎设置
        </Space>
      }
      style={{ margin: 16 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Status Panel */}
        <Card size="small" style={{ background: '#f5f5f5' }}>
          <Space>
            <Badge status={running ? "success" : "default"} text={running ? "运行中" : "已停止"} />
            <Button
              type={running ? "default" : "primary"}
              icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
              danger={running}
              onClick={handleStartStop}
              loading={loading}
            >
              {running ? "停止" : "启动"}
            </Button>
          </Space>
        </Card>

        <Divider orientation="left">引擎类型</Divider>

        <Form layout="vertical">
          <Form.Item label="类型">
            <Select value={agentType} onChange={(v) => {
              setAgentType(v);
              setBinPath(v === 'claude-code' ? 'claude-code' : 'nuwaxcode');
            }}>
              <Select.Option value="claude-code">
                <Space>
                  <span>Claude Code (ACP)</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>Anthropic 官方 ACP 协议</Text>
                </Space>
              </Select.Option>
              <Select.Option value="nuwaxcode">
                <Space>
                  <span>nuwaxcode (ACP)</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>基于 OpenCode 开发</Text>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Divider orientation="left">端口配置</Divider>

          <Form.Item label="后端端口（直接连接）">
            <Input
              type="number"
              value={backendPort}
              onChange={(e) => setBackendPort(parseInt(e.target.value))}
              placeholder="60001"
            />
            <Text type="secondary">直接连接 Agent 服务，无需代理</Text>
          </Form.Item>

          <Divider orientation="left">API 配置</Divider>

          <Form.Item label="可执行文件路径">
            <Input
              value={binPath}
              onChange={(e) => setBinPath(e.target.value)}
              placeholder={agentType === 'nuwaxcode' ? 'nuwaxcode' : 'claude-code-acp-ts'}
            />
          </Form.Item>

          <Form.Item label="API 密钥">
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
          </Form.Item>

          <Form.Item label="API 基础 URL">
            <Input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={DEFAULT_ANTHROPIC_API_URL}
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item label="模型">
            <Select value={model} onChange={setModel}>
              <Select.Option value="claude-opus-4-20250514">Claude Opus 4</Select.Option>
              <Select.Option value="claude-sonnet-4-20250514">Claude Sonnet 4</Select.Option>
              <Select.Option value="claude-haiku-3-20240307">Claude Haiku 3</Select.Option>
            </Select>
          </Form.Item>

          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            保存配置
          </Button>
        </Form>
      </Space>
    </Card>
  );
}

export default AgentSettings;
