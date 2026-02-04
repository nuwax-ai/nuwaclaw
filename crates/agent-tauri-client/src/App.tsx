import React, { useState, useEffect, useCallback } from 'react';
import {
  Space,
  Badge,
  Menu,
  Card,
  Button,
  Descriptions,
  Tag,
  List,
  Switch,
  Form,
  Alert,
  message,
  Progress,
  Divider,
  Row,
  Col,
  Tooltip,
  Avatar,
  Modal,
  Spin,
} from 'antd';
import {
  RobotOutlined,
  FileTextOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CloudServerOutlined,
  ApiOutlined,
  BellOutlined,
  DashboardOutlined,
  SafetyOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  BugOutlined,
  CodeOutlined,
  UploadOutlined,
  RedoOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import {
  AgentStatus,
  LogEntry,
  PermissionItem,
  startAgent,
  stopAgent,
  getPermissions,
  refreshPermissions,
  openSystemPreferences,
  getConnectionInfo,
  onStatusChange,
  onLogChange,
  syncConfigToServer,
  getOnlineStatus,
} from './services';
import LoginForm from './components/LoginForm';
import SceneSwitcher from './components/SceneSwitcher';
import ConfigEditor from './components/ConfigEditor';
import LogViewer from './components/LogViewer';
import SetupWizard from './components/SetupWizard';
import {
  DependencyStatus,
  checkNodeVersion,
  checkAllSetupDependencies,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  type LocalDependencyItem,
  type NodeVersionResult,
} from './services/dependencies';
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

import { Typography } from 'antd';
const { Title, Text, Paragraph } = Typography;

type TabType = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about' | 'debug';

function App() {
  // 初始化向导状态
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [sessionId, setSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('client');
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  
  // 场景配置状态
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentScene, setCurrentScene] = useState<SceneConfig | null>(null);
  const [configEditorVisible, setConfigEditorVisible] = useState(false);
  const [editingScene, setEditingScene] = useState<SceneConfig | null>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);
  const [storeInitialized, setStoreInitialized] = useState(false);

  // 检查初始化向导状态
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

  // 初始化存储服务和场景配置（仅在初始化向导完成后执行）
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

  // 监听 Agent 状态和日志变化
  useEffect(() => {
    onStatusChange((newStatus: AgentStatus) => {
      setStatus(newStatus);
      if (newStatus === 'running') {
        message.success('Agent 已启动');
      } else if (newStatus === 'idle' || newStatus === 'stopped') {
        setSessionId('');
      }
    });

    onLogChange((log: LogEntry) => {
      setLogs(prev => [log, ...prev].slice(0, 100));
    });
  }, []);

  // 获取当前场景（如果未初始化则返回默认场景）
  const getEffectiveScene = useCallback((): SceneConfig => {
    if (currentScene) {
      return currentScene;
    }
    // 返回默认场景
    return {
      id: 'local',
      name: '本地开发',
      isDefault: true,
      server: { apiUrl: 'http://localhost:8080', timeout: 30000 },
      local: {
        agent: { host: '127.0.0.1', port: 8080, scheme: 'http', path: '/api' },
        vnc: { host: '127.0.0.1', port: 5900, scheme: 'vnc' },
        fileServer: { host: '127.0.0.1', port: 8081, scheme: 'http', path: '/files' },
        websocket: { host: '127.0.0.1', port: 8080, scheme: 'ws', path: '/ws' },
      },
    };
  }, [currentScene]);

  // 检查是否为当前场景
  const isCurrentScene = useCallback((sceneId: string): boolean => {
    const scene = getEffectiveScene();
    return sceneId === scene.id;
  }, [getEffectiveScene]);

  const handleStart = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await startAgent();
      setIsConnected(true);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleStop = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await stopAgent();
      message.success('Agent 已停止');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const getStatusBadge = () => {
    const config: Record<AgentStatus, { status: 'success' | 'processing' | 'warning' | 'error' | 'default'; text: string; color: string }> = {
      running: { status: 'success', text: '运行中', color: '#52c41a' },
      starting: { status: 'processing', text: '启动中...', color: '#1890ff' },
      busy: { status: 'warning', text: '忙碌中', color: '#faad14' },
      error: { status: 'error', text: '错误', color: '#ff4d4f' },
      stopped: { status: 'default', text: '已停止', color: '#d9d9d9' },
      idle: { status: 'default', text: '已停止', color: '#d9d9d9' },
    };
    return config[status];
  };

  const badge = getStatusBadge();
  const connectionInfo = getConnectionInfo();

  const menuItems = [
    { key: 'client', icon: <DashboardOutlined />, label: '客户端' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'dependencies', icon: <FolderOutlined />, label: '依赖' },
    { key: 'permissions', icon: <SafetyOutlined />, label: '权限' },
    { key: 'logs', icon: <FileTextOutlined />, label: '日志' },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于' },
    // { key: 'debug', icon: <BugOutlined />, label: '调试' },
  ];

  // 过滤后的日志（目前不需要前端过滤，依赖后端过滤）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _filteredLogs = logs.filter(
    (log) => true // 占位，始终返回所有日志
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getLogColor = (level: string) => {
    switch (level) {
      case 'success': return 'green';
      case 'warning': return 'orange';
      case 'error': return 'red';
      default: return 'blue';
    }
  };

  // 客户端页面
  const renderClientPage = () => (
    <div style={{ maxWidth: 900 }}>
      {/* 场景切换 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <RobotOutlined style={{ fontSize: 16, color: '#1890ff' }} />
            <span style={{ fontWeight: 500 }}>NuWax Agent</span>
          </Space>
          <SceneSwitcher showLabel={false} size="small" />
        </Space>
      </Card>

      {/* 登录表单 */}
      <LoginForm onLoginSuccess={() => {}} />

      {/* 状态卡片 */}
      <Card
        title={
          <Space>
            <RobotOutlined />
            <span>Agent 状态</span>
          </Space>
        }
        extra={
          <Space>
            {status === 'idle' || status === 'stopped' ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                loading={loading}
              >
                启动
              </Button>
            ) : (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                loading={loading}
              >
                停止
              </Button>
            )}
          </Space>
        }
      >
        <Row gutter={16}>
          <Col span={8}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态">
                <Badge status={badge.status} text={badge.text} />
              </Descriptions.Item>
              <Descriptions.Item label="会话 ID">
                <Text code>{sessionId || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="连接状态">
                <Tag color={onlineStatus === true ? 'green' : onlineStatus === false ? 'red' : 'default'}>
                  {onlineStatus === true ? '在线' : onlineStatus === false ? '离线' : '未知'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={8}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="运行时间">
                {status === 'running' ? '00:00:00' : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="任务队列">
                {status === 'running' ? `${logs.length} 条日志` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="平台">
                macOS / arm64
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={8}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button icon={<ApiOutlined />} block>执行命令</Button>
              <Button icon={<FileTextOutlined />} block>查看日志</Button>
            </Space>
          </Col>
        </Row>

        {status === 'idle' && (
          <Alert
            message="就绪"
            description="点击启动按钮开始运行 Agent"
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* 快速操作 */}
      <Card title="快速操作" style={{ marginTop: 16 }}>
        <Space wrap>
          <Tooltip title="连接管理">
            <Button icon={<CloudServerOutlined />}>连接管理</Button>
          </Tooltip>
          <Tooltip title="消息中心">
            <Button icon={<BellOutlined />}>消息中心</Button>
          </Tooltip>
          <Tooltip title="依赖管理">
            <Button icon={<FolderOutlined />}>依赖管理</Button>
          </Tooltip>
          <Tooltip title="权限设置">
            <Button icon={<SafetyOutlined />}>权限设置</Button>
          </Tooltip>
        </Space>
      </Card>

      {/* 连接信息卡片 */}
      <Card title="连接信息" style={{ marginTop: 16 }}>
        {!connectionInfo.id ? (
          // 空状态：未连接时显示提示
          <Space direction="vertical" style={{ width: '100%' }} align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>
              启动 Agent 后显示连接信息
            </Text>
          </Space>
        ) : (
          // 有连接时显示详细信息
          <Row gutter={16}>
            <Col span={12}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="客户端 ID">
                  <Text code copyable>
                    {connectionInfo.id}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label="服务器">
                  <Text copyable>
                    {connectionInfo.server}
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Progress
                  percent={status === 'running' ? 100 : 0}
                  status={status === 'running' ? 'success' : 'exception'}
                  size="small"
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {status === 'running' ? '已连接到服务器' : '未连接'}
                </Text>
              </Space>
            </Col>
          </Row>
        )}
      </Card>
    </div>
  );

  // 场景配置管理
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

  // 设置页面
  const renderSettingsPage = () => (
    <div style={{ maxWidth: 900 }}>
      {/* 场景切换 */}
      <Card 
        title={
          <Space>
            <CloudServerOutlined />
            <span>部署环境</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<RedoOutlined />} onClick={handleResetConfig}>
              重置
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddConfig}>
              添加配置
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <List
          dataSource={scenes}
          renderItem={(scene) => (
            <List.Item
              actions={[
                isCurrentScene(scene.id) ? (
                  <Tag color="green">当前</Tag>
                ) : (
                  <Button
                    size="small"
                    onClick={() => handleSwitchScene(scene.id)}
                  >
                    切换
                  </Button>
                ),
                !scene.isDefault && !isCurrentScene(scene.id) && (
                  <>
                    <Button
                      size="small"
                      onClick={() => handleEditConfig(scene)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => handleDeleteConfig(scene.id, scene.name)}
                    >
                      删除
                    </Button>
                  </>
                ),
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar
                    icon={<EnvironmentOutlined />}
                    style={{
                      backgroundColor: isCurrentScene(scene.id) ? '#1890ff' : '#52c41a'
                    }}
                  />
                }
                title={
                  <Space>
                    <span>{scene.name}</span>
                    {scene.isDefault && <Tag color="blue">默认</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Text type="secondary">{scene.description || '无描述'}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      API: {scene.server.apiUrl}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* 当前场景详情 */}
      <Card
        title={
          <Space>
            <SettingOutlined />
            <span>当前配置详情</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="场景名称">{getEffectiveScene().name}</Descriptions.Item>
              <Descriptions.Item label="API 服务器">{getEffectiveScene().server.apiUrl}</Descriptions.Item>
              <Descriptions.Item label="超时时间">{getEffectiveScene().server.timeout}ms</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Agent">
                {getEffectiveScene().local.agent.host}:{getEffectiveScene().local.agent.port}
              </Descriptions.Item>
              <Descriptions.Item label="VNC">
                {getEffectiveScene().local.vnc.host}:{getEffectiveScene().local.vnc.port}
              </Descriptions.Item>
              <Descriptions.Item label="文件服务">
                {getEffectiveScene().local.fileServer.host}:{getEffectiveScene().local.fileServer.port}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {/* 连接设置 */}
      <Card title="连接设置" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item label="开机自启动">
            <Switch checked={autoConnect} onChange={setAutoConnect} />
          </Form.Item>
          <Form.Item label="桌面通知">
            <Switch checked={notifications} onChange={setNotifications} />
          </Form.Item>
          <Form.Item label="自动重连">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );

  // 配置编辑弹窗
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _renderConfigEditor = () => (
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
  );

  // 依赖管理页面状态
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>([]);
  const [depLoading, setDepLoading] = useState(false);
  const [depInstalling, setDepInstalling] = useState(false);
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>('');

  // 加载依赖数据（Node.js + npm 包）
  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      // 检测 Node.js 版本
      const nodeRes = await checkNodeVersion();
      setNodeResult(nodeRes);
      
      // 检测所有依赖状态，只保留 npm-local 类型
      const deps = await checkAllSetupDependencies();
      const npmDeps = deps.filter(d => d.type === 'npm-local');
      setLocalDeps(npmDeps);
    } catch (error) {
      console.error('加载依赖数据失败:', error);
      message.error('加载依赖数据失败');
    } finally {
      setDepLoading(false);
    }
  }, []);

  // 依赖页面激活时加载数据
  useEffect(() => {
    if (activeTab === 'dependencies') {
      loadDependencies();
    }
  }, [activeTab, loadDependencies]);

  // 获取依赖统计
  const depSummary = {
    total: localDeps.length,
    installed: localDeps.filter(d => d.status === 'installed').length,
    missing: localDeps.filter(d => d.status === 'missing').length,
  };

  // 安装单个依赖
  const handleInstallSingleDep = async (packageName: string, displayName: string) => {
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    
    // 更新状态为 installing
    setLocalDeps(prev => prev.map(d => 
      d.name === packageName ? { ...d, status: 'installing' as const } : d
    ));
    
    try {
      await initLocalNpmEnv();
      const result = await installLocalNpmPackage(packageName);
      
      if (result.success) {
        // 更新状态为 installed
        setLocalDeps(prev => prev.map(d => 
          d.name === packageName 
            ? { ...d, status: 'installed' as const, version: result.version, binPath: result.binPath }
            : d
        ));
        message.success(`${displayName} 安装成功`);
      } else {
        // 更新状态为 error
        setLocalDeps(prev => prev.map(d => 
          d.name === packageName 
            ? { ...d, status: 'error' as const, errorMessage: result.error }
            : d
        ));
        message.error(`${displayName} 安装失败: ${result.error}`);
      }
    } catch (error) {
      setLocalDeps(prev => prev.map(d => 
        d.name === packageName 
          ? { ...d, status: 'error' as const, errorMessage: String(error) }
          : d
      ));
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep('');
    }
  };

  // 安装所有缺失依赖
  const handleInstallAllDeps = async () => {
    const missingDeps = localDeps.filter(d => d.status === 'missing' || d.status === 'error');
    if (missingDeps.length === 0) {
      message.info('没有需要安装的依赖');
      return;
    }
    
    setDepInstalling(true);
    
    try {
      await initLocalNpmEnv();
      
      for (const dep of missingDeps) {
        setCurrentInstallingDep(dep.displayName);
        
        // 更新状态为 installing
        setLocalDeps(prev => prev.map(d => 
          d.name === dep.name ? { ...d, status: 'installing' as const } : d
        ));
        
        // 检查是否已安装
        const checkResult = await checkLocalNpmPackage(dep.name);
        if (checkResult.installed) {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'installed' as const, version: checkResult.version, binPath: checkResult.binPath }
              : d
          ));
          continue;
        }
        
        // 安装
        const result = await installLocalNpmPackage(dep.name);
        if (result.success) {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'installed' as const, version: result.version, binPath: result.binPath }
              : d
          ));
        } else {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'error' as const, errorMessage: result.error }
              : d
          ));
          message.error(`${dep.displayName} 安装失败: ${result.error}`);
        }
      }
      
      message.success('依赖安装完成');
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep('');
    }
  };

  // 获取状态标签配置
  const getDepStatusTag = (status: DependencyStatus) => {
    const config: Record<string, { color: string; text: string }> = {
      installed: { color: 'success', text: '已安装' },
      missing: { color: 'warning', text: '待安装' },
      installing: { color: 'processing', text: '安装中' },
      checking: { color: 'default', text: '检测中' },
      error: { color: 'error', text: '错误' },
      outdated: { color: 'orange', text: '版本过低' },
    };
    return config[status] || config.checking;
  };

  // 获取状态图标
  const getDepStatusIcon = (status: DependencyStatus) => {
    switch (status) {
      case 'installed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'missing':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'installing':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <LoadingOutlined />;
    }
  };

  // 渲染依赖页面
  const renderDependenciesPage = () => {
    // 加载中
    if (depLoading && !nodeResult) {
      return (
        <div style={{ maxWidth: 900, textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>正在检测依赖状态...</div>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 900 }}>
        {/* Node.js 状态卡片（只读） */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <CodeOutlined style={{ fontSize: 20, color: '#1890ff' }} />
              <Text strong>Node.js 运行环境</Text>
              {nodeResult?.installed ? (
                nodeResult.meetsRequirement ? (
                  <Tag color="success">已安装</Tag>
                ) : (
                  <Tag color="warning">版本过低</Tag>
                )
              ) : (
                <Tag color="error">未安装</Tag>
              )}
            </Space>
            {nodeResult?.installed && (
              <Text type="secondary" style={{ marginLeft: 28 }}>
                当前版本: v{nodeResult.version}
                {!nodeResult.meetsRequirement && (
                  <Text type="danger"> (需要 &gt;= 22.0.0，请手动升级)</Text>
                )}
              </Text>
            )}
            {!nodeResult?.installed && (
              <Text type="secondary" style={{ marginLeft: 28 }}>
                请先安装 Node.js 22 或更高版本
              </Text>
            )}
          </Space>
        </Card>

        {/* 统计信息 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space split={<Divider type="vertical" />}>
            <Text>本地 npm 包: {depSummary.total} 个</Text>
            <Text type="success">已安装: {depSummary.installed}</Text>
            <Text type="warning">待安装: {depSummary.missing}</Text>
          </Space>
        </Card>

        {/* npm 包列表 */}
        <Card
          title="本地 npm 包"
          extra={
            <Space>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={loadDependencies} 
                loading={depLoading}
              >
                刷新
              </Button>
              {depSummary.missing > 0 && (
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  onClick={handleInstallAllDeps}
                  loading={depInstalling}
                  disabled={!nodeResult?.meetsRequirement}
                >
                  安装全部
                </Button>
              )}
            </Space>
          }
        >
          <List
            loading={depLoading}
            dataSource={localDeps}
            renderItem={(item) => {
              const statusConfig = getDepStatusTag(item.status);
              const isInstalling = item.status === 'installing';
              const canInstall = (item.status === 'missing' || item.status === 'error') && 
                                 nodeResult?.meetsRequirement && 
                                 !depInstalling;

              return (
                <List.Item
                  actions={[
                    <Tag color={statusConfig.color}>{statusConfig.text}</Tag>,
                    canInstall && (
                      <Button
                        type="primary"
                        size="small"
                        icon={<CloudDownloadOutlined />}
                        onClick={() => handleInstallSingleDep(item.name, item.displayName)}
                      >
                        安装
                      </Button>
                    ),
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={getDepStatusIcon(item.status)}
                    title={
                      <Space>
                        <span>{item.displayName}</span>
                        <Tag color="purple">npm</Tag>
                        {item.required && <Tag color="blue">必需</Tag>}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">{item.description}</Text>
                        {item.version && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            版本: {item.version}
                          </Text>
                        )}
                        {item.binPath && (
                          <Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: item.binPath }}>
                            路径: {item.binPath}
                          </Text>
                        )}
                        {item.errorMessage && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            错误: {item.errorMessage}
                          </Text>
                        )}
                        {isInstalling && currentInstallingDep === item.displayName && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            <LoadingOutlined style={{ marginRight: 4 }} />
                            正在安装...
                          </Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Card>

        {/* Node.js 未满足要求时的提示 */}
        {nodeResult && !nodeResult.meetsRequirement && (
          <Alert
            message="Node.js 环境不满足要求"
            description="请先安装或升级 Node.js 到 22.0.0 或更高版本后才能安装 npm 包"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </div>
    );
  };

  // 权限页面
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  // 关键权限列表（只显示需要系统授权的权限）
  const KEY_PERMISSIONS = ['accessibility', 'file_access'];

  // 过滤后的权限列表
  const filteredPermissions = permissions.filter(p => KEY_PERMISSIONS.includes(p.id));

  // 加载权限数据
  const loadPermissions = useCallback(async () => {
    setPermissionsLoading(true);
    try {
      const data = await getPermissions();
      setPermissions(data.items);
    } catch (error) {
      message.error('加载权限数据失败');
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  // 刷新权限
  const handleRefreshPermissions = async () => {
    message.loading('正在刷新权限状态...', 1);
    const data = await refreshPermissions();
    setPermissions(data.items);
    message.success('权限状态已刷新');
  };

  // 打开系统偏好设置
  const handleOpenSettings = async (permissionId: string) => {
    await openSystemPreferences(permissionId);
    message.info('请在系统偏好设置中完成权限授权');
  };

  // 获取权限状态对应的颜色和标签
  const getStatusConfig = (status: string) => {
    const baseConfig: Record<string, { color: string; text: string }> = {
      granted: { color: 'success', text: '已授权' },
      denied: { color: 'error', text: '已拒绝' },
      pending: { color: 'warning', text: '待授权' },
      unknown: { color: 'default', text: '未知' },
    };
    return baseConfig[status] || baseConfig.unknown;
  };

  // 获取权限图标
  const getPermissionIcon = (permissionId: string) => {
    switch (permissionId) {
      case 'accessibility':
        return <ApiOutlined />;
      case 'file_access':
        return <FolderOutlined />;
      default:
        return <SafetyOutlined />;
    }
  };

  // 计算权限统计（只统计关键权限）
  const grantedCount = filteredPermissions.filter((p) => p.status === 'granted').length;
  const totalCount = filteredPermissions.length;
  const allGranted = grantedCount === totalCount && totalCount > 0;

  // 权限页面
  const renderPermissionsPage = () => (
    <div style={{ maxWidth: 900 }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>系统权限</Title>
        <Button icon={<ReloadOutlined />} onClick={handleRefreshPermissions} loading={permissionsLoading}>
          刷新状态
        </Button>
      </div>

      {/* 权限状态摘要 */}
      <Alert
        message={allGranted ? '权限正常' : '需要授权'}
        description={
          allGranted
            ? '所有关键权限已授权，客户端可正常工作'
            : `已授权 ${grantedCount}/${totalCount} 个关键权限，请完成剩余权限授权`
        }
        type={allGranted ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 权限列表 */}
      <Card title="关键权限">
        <List
          loading={permissionsLoading}
          dataSource={filteredPermissions}
          renderItem={(item) => {
            const statusConfig = getStatusConfig(item.status);
            const isGranted = item.status === 'granted';
            
            return (
              <List.Item
                style={{
                  background: !isGranted ? '#fffbe6' : undefined,
                  borderRadius: 8,
                  marginBottom: 8,
                  padding: '12px 16px',
                }}
                actions={[
                  <Tag color={statusConfig.color}>{statusConfig.text}</Tag>,
                  !isGranted && (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => handleOpenSettings(item.id)}
                    >
                      前往授权
                    </Button>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      icon={getPermissionIcon(item.id)}
                      style={{
                        backgroundColor: isGranted ? '#52c41a' : '#faad14',
                      }}
                    />
                  }
                  title={
                    <Space>
                      <span>{item.displayName}</span>
                      <Tag color="blue">必需</Tag>
                    </Space>
                  }
                  description={
                    <Text type="secondary">{item.description}</Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>

      {/* 提示信息 */}
      <Alert
        message="权限说明"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><strong>辅助功能</strong>：用于远程控制时模拟键盘鼠标输入（macOS 需要在系统设置中授权）</li>
            <li><strong>文件访问</strong>：用于文件传输和本地文件操作</li>
          </ul>
        }
        type="info"
        style={{ marginTop: 16 }}
      />
    </div>
  );

  // 关于页面
  const renderAboutPage = () => (
    <Card>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <Avatar size={80} icon={<RobotOutlined />} style={{ backgroundColor: '#1890ff' }} />
        <Title level={3} style={{ marginTop: 16 }}>NuWax Agent</Title>
        <Text type="secondary">版本 v0.1.0</Text>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          跨平台 Agent 客户端
        </Paragraph>

        <Divider />

        <Descriptions column={1} style={{ textAlign: 'left', maxWidth: 400, margin: '0 auto' }}>
          <Descriptions.Item label="框架">Tauri 2.0 + React 18 + Ant Design 5</Descriptions.Item>
          <Descriptions.Item label="协议版本">v1.0.0</Descriptions.Item>
          <Descriptions.Item label="平台">macOS / arm64</Descriptions.Item>
          <Descriptions.Item label="许可证">Apache-2.0</Descriptions.Item>
        </Descriptions>

        <Space style={{ marginTop: 24 }}>
          <Button>导出日志</Button>
          <Button type="primary">官网</Button>
        </Space>
      </div>
    </Card>
  );

  // 调试页面
  const renderDebugPage = () => (
    <Card title="调试">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message="日志操作"
          description="导出或上报日志用于问题排查"
          type="info"
          showIcon
        />
        <Space>
          <Button icon={<FileTextOutlined />}>导出日志</Button>
          <Button type="primary" icon={<UploadOutlined />}>上报日志</Button>
        </Space>
      </Space>
    </Card>
  );

  // 日志页面
  const renderLogsPage = () => (
    <LogViewer
      maxHeight={600}
      showSource={true}
      enableRealtime={true}
      autoScrollDefault={true}
    />
  );

  // 正在检查初始化状态
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

  // 未完成初始化，显示向导
  if (!setupCompleted) {
    return (
      <SetupWizard
        onComplete={() => setSetupCompleted(true)}
      />
    );
  }

  // 已完成初始化，显示主界面
  return (
    // 最外层容器 - 100vh
    <div className="app-container">
      
      {/* 顶部栏 - 固定高度 56px */}
      <div className="app-header">
        <div className="app-header-logo">
          <RobotOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <span className="app-header-title">NuWax Agent</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Badge status={badge.status} text={<span style={{ color: '#fff' }}>{badge.text}</span>} />
        </div>
      </div>

      {/* 主体部分 - flex:1，flex-row */}
      <div className="app-body">
        
        {/* 左侧边栏 - 固定宽度 160px */}
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

        {/* 主内容区 - 自动填充剩余空间 */}
        <div className="app-content">
          {activeTab === 'client' && renderClientPage()}
          {activeTab === 'settings' && renderSettingsPage()}
          {activeTab === 'dependencies' && renderDependenciesPage()}
          {activeTab === 'permissions' && renderPermissionsPage()}
          {activeTab === 'about' && renderAboutPage()}
          {/* {activeTab === 'debug' && renderDebugPage()} */}
          {activeTab === 'logs' && renderLogsPage()}
        </div>
      </div>
    </div>
  );
}

export default App;
