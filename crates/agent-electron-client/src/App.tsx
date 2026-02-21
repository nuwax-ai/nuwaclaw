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
} from 'antd';
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
        setUsername(user.username || 'User');
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
      console.error('Failed to load settings:', error);
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
      message.success('Logged out');
    } catch (error) {
      message.error('Logout failed');
    }
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => setSettingsOpen(true),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
      onClick: handleLogout,
    },
  ];

  // Show loading while checking setup status
  if (isSetupComplete === null) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f0f2f5',
      }}>
        <Text>Loading...</Text>
      </div>
    );
  }

  // Show setup wizard if not completed
  if (!isSetupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  const menuItems: MenuProps['items'] = [
    { key: 'chat', icon: <RobotOutlined />, label: 'Chat' },
    { key: 'agent', icon: <CloudServerOutlined />, label: 'Agent' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP' },
    { key: 'lanproxy', icon: <GlobalOutlined />, label: 'Lanproxy' },
    { key: 'skills', icon: <FileTextOutlined />, label: 'Skills' },
    { key: 'im', icon: <ApiOutlined />, label: 'IM' },
    { key: 'tasks', icon: <ClockCircleOutlined />, label: 'Tasks' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="dark" breakpoint="lg" collapsedWidth="0">
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <Text strong style={{ color: '#fff', fontSize: 16 }}>🤖 Nuwax Agent</Text>
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
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
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
              <Text type="secondary">{activeTab} panel - Coming soon</Text>
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
