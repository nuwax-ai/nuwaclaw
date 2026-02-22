import React, { useState, useEffect } from 'react';
import {
  Layout,
  Menu,
  Button,
  Space,
  Dropdown,
  Avatar,
  Badge,
  Typography,
  message,
  ConfigProvider,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  RobotOutlined,
  SettingOutlined,
  CloudServerOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  GlobalOutlined,
  UserOutlined,
  LogoutOutlined,
  CommentOutlined,
} from '@ant-design/icons';
import type { MenuProps, ModalProps } from 'antd';
import { aiService } from './services/ai';
import { setupService, authService } from './services/setup';
import SetupWizard from './components/SetupWizard';
import AgentSettings from './components/AgentSettings';
import SettingsPage from './components/SettingsPage';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

type TabKey = 'chat' | 'agent' | 'mcp' | 'lanproxy' | 'skills' | 'im' | 'tasks' | 'settings';

const TAB_LABELS: Record<TabKey, string> = {
  chat: '对话',
  agent: 'Agent 引擎',
  mcp: 'MCP 服务',
  lanproxy: '内网穿透',
  skills: '技能同步',
  im: '即时通讯',
  tasks: '定时任务',
  settings: '设置',
};

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    const completed = await setupService.isSetupCompleted();
    setIsSetupComplete(completed);

    if (completed) {
      const user = await authService.getAuthUser();
      if (user) {
        setUsername(user.username || '用户');
      }
      await loadSettings();
    }
  };

  const loadSettings = async () => {
    try {
      const apiKey = await window.electronAPI?.settings.get('anthropic_api_key');
      const settings = await window.electronAPI?.settings.get('app_settings');
      if (apiKey) {
        aiService.configure({
          apiKey: apiKey as string,
          model: (settings as any)?.default_model || 'claude-sonnet-4-20250514',
          maxTokens: (settings as any)?.max_tokens || 4096,
        });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const handleSetupComplete = () => {
    setIsSetupComplete(true);
    checkSetupStatus();
  };

  const handleLogout = async () => {
    try {
      await authService.logout(true);
      setIsSetupComplete(false);
      setUsername('');
      message.success('已退出登录');
    } catch (error) {
      message.error('退出登录失败');
    }
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
      onClick: () => setSettingsOpen(true),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ];

  // Show loading while checking setup status
  if (isSetupComplete === null) {
    return (
      <ConfigProvider locale={zhCN}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: '#f0f2f5',
        }}>
          <Text>正在加载...</Text>
        </div>
      </ConfigProvider>
    );
  }

  // Show setup wizard if not completed
  if (!isSetupComplete) {
    return (
      <ConfigProvider locale={zhCN}>
        <SetupWizard onComplete={handleSetupComplete} />
      </ConfigProvider>
    );
  }

  const menuItems: MenuProps['items'] = [
    { key: 'chat', icon: <CommentOutlined />, label: '对话' },
    { key: 'agent', icon: <CloudServerOutlined />, label: 'Agent 引擎' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP 服务' },
    { key: 'lanproxy', icon: <GlobalOutlined />, label: '内网穿透' },
    { key: 'skills', icon: <FileTextOutlined />, label: '技能同步' },
    { key: 'im', icon: <CommentOutlined />, label: '即时通讯' },
    { key: 'tasks', icon: <ClockCircleOutlined />, label: '定时任务' },
  ];

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider width={200} theme="dark" breakpoint="lg" collapsedWidth="0">
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <Text strong style={{ color: '#fff', fontSize: 16 }}>Nuwax Agent</Text>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            defaultSelectedKeys={['chat']}
            items={menuItems}
            onClick={({ key }) => setActiveTab(key as TabKey)}
          />
        </Sider>
        <Layout>
          <Header style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}>
            <Text strong style={{ fontSize: 16 }}>
              {TAB_LABELS[activeTab] || activeTab}
            </Text>
            <Space>
              <Badge dot>
                <Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} />
              </Badge>
              <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                <Space style={{ cursor: 'pointer' }}>
                  <Avatar icon={<UserOutlined />} />
                  <Text>{username}</Text>
                </Space>
              </Dropdown>
            </Space>
          </Header>
          <Content style={{ margin: 16, overflow: 'initial' }}>
            {activeTab === 'settings' && (
              <SettingsPage isOpen={true} onClose={() => setActiveTab('chat')} />
            )}
            {activeTab === 'agent' && (
              <AgentSettings isOpen={true} onClose={() => setActiveTab('chat')} />
            )}
            {activeTab !== 'settings' && activeTab !== 'agent' && (
              <div style={{
                padding: 24,
                background: '#fff',
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <Text type="secondary">{TAB_LABELS[activeTab]} - 即将推出</Text>
              </div>
            )}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
