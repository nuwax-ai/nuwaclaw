import React, { useState, useEffect } from 'react';
import {
  Menu,
  Badge,
  Spin,
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
  CommentOutlined,
} from '@ant-design/icons';
import { aiService } from './services/ai';
import { setupService, authService } from './services/setup';
import SetupWizard from './components/SetupWizard';
import AgentSettings from './components/AgentSettings';
import SettingsPage from './components/SettingsPage';

type TabKey = 'chat' | 'agent' | 'mcp' | 'lanproxy' | 'skills' | 'im' | 'tasks' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string>('');

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

  // 加载中
  if (isSetupComplete === null) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#71717a', fontSize: 13 }}>
          正在加载...
        </div>
      </div>
    );
  }

  // 初始化向导
  if (!isSetupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  const menuItems = [
    { key: 'chat', icon: <CommentOutlined />, label: '对话' },
    { key: 'agent', icon: <CloudServerOutlined />, label: 'Agent' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP' },
    { key: 'lanproxy', icon: <GlobalOutlined />, label: '穿透' },
    { key: 'skills', icon: <FileTextOutlined />, label: '技能' },
    { key: 'im', icon: <CommentOutlined />, label: '通讯' },
    { key: 'tasks', icon: <ClockCircleOutlined />, label: '任务' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <div className="app-header">
        <div className="app-header-logo">
          <RobotOutlined style={{ fontSize: 16, color: '#18181b' }} />
          <span className="app-header-title">Nuwax Agent</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {username && (
            <span style={{ color: '#71717a', fontSize: 12 }}>{username}</span>
          )}
          <Badge status="default" text={
            <span style={{ color: '#52525b', fontSize: 12 }}>就绪</span>
          } />
        </div>
      </div>

      {/* 主体部分 */}
      <div className="app-body">
        {/* 左侧边栏 - 浅色简洁 */}
        <div className="app-sider">
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              onClick: () => setActiveTab(item.key as TabKey),
            }))}
          />
        </div>

        {/* 主内容区 */}
        <div className="app-content">
          {activeTab === 'settings' && (
            <SettingsPage isOpen={true} onClose={() => setActiveTab('chat')} />
          )}
          {activeTab === 'agent' && (
            <AgentSettings isOpen={true} onClose={() => setActiveTab('chat')} />
          )}
          {activeTab !== 'settings' && activeTab !== 'agent' && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 200,
            }}>
              <div style={{
                padding: '24px 32px',
                background: '#ffffff',
                borderRadius: 8,
                border: '1px solid #e4e4e7',
                textAlign: 'center',
              }}>
                <span style={{ color: '#71717a', fontSize: 13 }}>
                  {menuItems.find(m => m.key === activeTab)?.label} — 即将推出
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
