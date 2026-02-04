/**
 * NuWax Agent 主应用入口
 * 
 * 职责：
 * - 初始化向导状态管理
 * - Tab 导航切换
 * - 布局结构
 * - 状态管理和事件监听
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Space,
  Badge,
  Menu,
  Modal,
  Spin,
  message,
} from 'antd';
import {
  RobotOutlined,
  FileTextOutlined,
  SettingOutlined,
  DashboardOutlined,
  SafetyOutlined,
  FolderOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  AgentStatus,
  LogEntry,
  startAgent,
  stopAgent,
  getConnectionInfo,
  onStatusChange,
  onLogChange,
  syncConfigToServer,
  getOnlineStatus,
} from './services';
import SetupWizard from './components/SetupWizard';
import ConfigEditor from './components/ConfigEditor';
import LogViewer from './components/LogViewer';
import {
  ClientPage,
  SettingsPage,
  DependenciesPage,
  PermissionsPage,
  AboutPage,
} from './pages';
import {
  initConfigStore,
  getAllScenes,
  getCurrentScene,
  switchScene,
  deleteCustomScene,
  resetConfig,
  SceneConfig,
} from './services/config';
import { initAuthStore } from './services/auth';
import { isSetupCompleted } from './services/setup';

// Tab 类型定义
type TabType = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

/**
 * 主应用组件
 */
function App() {
  // ============================================
  // 初始化向导状态
  // ============================================
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);

  // ============================================
  // 核心状态
  // ============================================
  const [activeTab, setActiveTab] = useState<TabType>('client');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [sessionId, setSessionId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  
  // 场景配置状态
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentScene, setCurrentScene] = useState<SceneConfig | null>(null);
  const [configEditorVisible, setConfigEditorVisible] = useState(false);
  const [editingScene, setEditingScene] = useState<SceneConfig | null>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);
  const [storeInitialized, setStoreInitialized] = useState(false);

  // 连接信息
  const [connectionInfo, setConnectionInfo] = useState<{ id: string; server: string }>({
    id: '',
    server: '',
  });

  // ============================================
  // 检查初始化向导状态
  // ============================================
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const completed = await isSetupCompleted();
        setSetupCompleted(completed);
      } catch (error) {
        console.error('检查初始化状态失败:', error);
        // 如果检查失败，假设已完成（避免阻塞用户）
        setSetupCompleted(true);
      }
    };
    checkSetup();
  }, []);

  // ============================================
  // 初始化存储服务和场景配置（仅在初始化向导完成后执行）
  // ============================================
  useEffect(() => {
    // 只有在初始化向导完成后才加载主界面数据
    if (setupCompleted !== true) {
      return;
    }
    
    const init = async () => {
      try {
        // 初始化认证存储
        await initAuthStore();
        // 初始化配置存储
        await initConfigStore();
        // 加载场景数据
        const [scenesData, current] = await Promise.all([
          getAllScenes(),
          getCurrentScene(),
        ]);
        setScenes(scenesData);
        setCurrentScene(current);
        // 加载在线状态
        const status = await getOnlineStatus();
        setOnlineStatus(status);
        setStoreInitialized(true);
      } catch (error) {
        console.error('初始化存储服务失败:', error);
        // 即使失败也标记为已初始化，使用默认配置
        setStoreInitialized(true);
      }
    };
    init();
  }, [setupCompleted]);

  // ============================================
  // 状态监听
  // ============================================
  useEffect(() => {
    // 订阅状态变化
    onStatusChange((newStatus: AgentStatus) => {
      setStatus(newStatus);
      if (newStatus === 'running') {
        setIsConnected(true);
      } else if (newStatus === 'stopped' || newStatus === 'error') {
        setIsConnected(false);
      }
    });

    // 订阅日志变化
    onLogChange((newLog: LogEntry) => {
      setLogs((prev) => [...prev, newLog]);
    });
  }, []);

  // ============================================
  // 连接信息更新
  // ============================================
  useEffect(() => {
    if (status === 'running') {
      const info = getConnectionInfo();
      setConnectionInfo({ id: info.id, server: info.server });
    } else {
      setConnectionInfo({ id: '', server: '' });
    }
  }, [status]);

  // ============================================
  // Agent 控制方法
  // ============================================
  const handleStart = async () => {
    setLoading(true);
    try {
      const success = await startAgent();
      if (success) {
        // 状态会通过 onStatusChange 回调更新
        // 获取连接信息中的 session id
        const info = getConnectionInfo();
        setSessionId(info.id || '');
        message.success('Agent 启动成功');
      } else {
        message.error('启动失败');
      }
    } catch (error) {
      message.error('启动失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopAgent();
      setStatus('stopped');
      message.success('Agent 已停止');
    } catch (error) {
      message.error('停止失败');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 状态徽章配置
  // ============================================
  const getBadgeConfig = () => {
    const config: Record<AgentStatus, { status: 'success' | 'processing' | 'error' | 'default' | 'warning'; text: string }> = {
      idle: { status: 'default', text: '就绪' },
      starting: { status: 'processing', text: '启动中' },
      running: { status: 'success', text: '运行中' },
      busy: { status: 'warning', text: '繁忙' },
      stopped: { status: 'default', text: '已停止' },
      error: { status: 'error', text: '错误' },
    };
    return config[status] || config.idle;
  };

  const badge = getBadgeConfig();

  // ============================================
  // 场景配置管理方法
  // ============================================

  const handleSwitchScene = async (sceneId: string) => {
    const success = await switchScene(sceneId);
    if (success) {
      const [scenesData, current] = await Promise.all([
        getAllScenes(),
        getCurrentScene(),
      ]);
      setScenes(scenesData);
      setCurrentScene(current);
    }
  };

  const handleAddConfig = () => {
    setIsNewConfig(true);
    setEditingScene(null);
    setConfigEditorVisible(true);
  };

  const handleEditConfig = (scene: SceneConfig) => {
    setIsNewConfig(false);
    setEditingScene(scene);
    setConfigEditorVisible(true);
  };

  const handleDeleteConfig = async (sceneId: string, sceneName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除配置 "${sceneName}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const success = await deleteCustomScene(sceneId);
        if (success) {
          const [scenesData, current] = await Promise.all([
            getAllScenes(),
            getCurrentScene(),
          ]);
          setScenes(scenesData);
          setCurrentScene(current);
        }
      },
    });
  };

  const handleResetConfig = async () => {
    Modal.confirm({
      title: '重置配置',
      content: '确定要重置为默认配置吗？所有自定义配置将被删除。',
      okText: '重置',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await resetConfig();
        const [scenesData, current] = await Promise.all([
          getAllScenes(),
          getCurrentScene(),
        ]);
        setScenes(scenesData);
        setCurrentScene(current);
      },
    });
  };

  // ============================================
  // 菜单配置
  // ============================================
  const menuItems = [
    { key: 'client', icon: <DashboardOutlined />, label: '客户端' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'dependencies', icon: <FolderOutlined />, label: '依赖' },
    { key: 'permissions', icon: <SafetyOutlined />, label: '权限' },
    { key: 'logs', icon: <FileTextOutlined />, label: '日志' },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于' },
  ];

  // ============================================
  // 渲染：加载中
  // ============================================
  if (setupCompleted === null) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#666' }}>正在加载...</div>
        <style>{`
          .app-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e8eb 100%);
          }
        `}</style>
      </div>
    );
  }

  // ============================================
  // 渲染：初始化向导
  // ============================================
  if (!setupCompleted) {
    return (
      <SetupWizard
        onComplete={() => setSetupCompleted(true)}
      />
    );
  }

  // ============================================
  // 渲染：主界面
  // ============================================
  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <div className="app-header">
        <div className="app-header-logo">
          <RobotOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <span className="app-header-title">NuWax Agent</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Badge status={badge.status} text={<span style={{ color: '#fff' }}>{badge.text}</span>} />
        </div>
      </div>

      {/* 主体部分 */}
      <div className="app-body">
        {/* 左侧边栏 */}
        <div className="app-sider">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              onClick: () => setActiveTab(item.key as TabType),
            }))}
          />
        </div>

        {/* 主内容区 */}
        <div className="app-content">
          {activeTab === 'client' && (
            <ClientPage
              status={status}
              sessionId={sessionId}
              onlineStatus={onlineStatus}
              logs={logs}
              connectionInfo={connectionInfo}
              badge={badge}
              loading={loading}
              onStart={handleStart}
              onStop={handleStop}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsPage
              scenes={scenes}
              currentScene={currentScene}
              onSwitchScene={handleSwitchScene}
              onAddConfig={handleAddConfig}
              onEditConfig={handleEditConfig}
              onDeleteConfig={handleDeleteConfig}
              onResetConfig={handleResetConfig}
            />
          )}
          {activeTab === 'dependencies' && <DependenciesPage />}
          {activeTab === 'permissions' && <PermissionsPage />}
          {activeTab === 'logs' && (
            <LogViewer
              maxHeight={600}
              showSource={true}
              enableRealtime={true}
              autoScrollDefault={true}
            />
          )}
          {activeTab === 'about' && <AboutPage />}
        </div>
      </div>

      {/* 配置编辑弹窗 */}
      <ConfigEditor
        visible={configEditorVisible}
        onCancel={() => setConfigEditorVisible(false)}
        scene={editingScene}
        isNew={isNewConfig}
        onSave={async () => {
          const [scenesData, current] = await Promise.all([
            getAllScenes(),
            getCurrentScene(),
          ]);
          setScenes(scenesData);
          setCurrentScene(current);
          // 同步配置到后端
          await syncConfigToServer();
        }}
      />
    </div>
  );
}

export default App;
