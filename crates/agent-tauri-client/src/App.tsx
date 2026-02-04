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
  Input,
  Switch,
  Select,
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
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  UserOutlined,
  GlobalOutlined,
  CodeOutlined,
  UploadOutlined,
  RedoOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  DesktopOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  AgentStatus,
  LogEntry,
  PermissionItem,
  getAgentStatus,
  startAgent,
  stopAgent,
  getLogs,
  getPermissions,
  refreshPermissions,
  openSystemPreferences,
  getConnectionInfo,
  onStatusChange,
  onLogChange,
} from './services';
import LoginForm from './components/LoginForm';
import SceneSwitcher from './components/SceneSwitcher';
import ConfigEditor from './components/ConfigEditor';
import LogViewer from './components/LogViewer';
import {
  DependencyItem,
  DependencyStatus,
  getDependencies,
  installDependency,
  installAllDependencies,
  uninstallDependency,
} from './services/dependencies';
import {
  getAllScenes,
  getCurrentScene,
  switchScene,
  deleteCustomScene,
  resetConfig,
  SceneConfig,
} from './services/config';

import { Typography } from 'antd';
const { Title, Text, Paragraph } = Typography;

type TabType = 'client' | 'settings' | 'dependencies' | 'permissions' | 'about' | 'debug';

function App() {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [sessionId, setSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('client');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  
  // 场景配置状态
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentScene, setCurrentScene] = useState<SceneConfig>(getCurrentScene());
  const [configEditorVisible, setConfigEditorVisible] = useState(false);
  const [editingScene, setEditingScene] = useState<SceneConfig | null>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);

  // 初始化场景配置
  useEffect(() => {
    setScenes(getAllScenes());
    setCurrentScene(getCurrentScene());
  }, []);

  // 监听 Agent 状态和日志变化
  useEffect(() => {
    onStatusChange((newStatus: AgentStatus) => {
      setStatus(newStatus);
      if (newStatus === 'running') {
        message.success('Agent 已启动');
      } else if (newStatus === 'idle' || newStatus === 'stopped') {
        setSessionId('');
        setIsConnected(false);
      }
    });

    onLogChange((log: LogEntry) => {
      setLogs(prev => [log, ...prev].slice(0, 100));
    });
  }, []);

  const initData = async () => {
    const [statusRes, logsRes, connInfo] = await Promise.all([
      getAgentStatus(),
      getLogs(),
      Promise.resolve(getConnectionInfo()),
    ]);
    setStatus(statusRes.status as AgentStatus);
    setSessionId(statusRes.session_id || '');
    setLogs(logsRes);
    setIsConnected(connInfo.status === 'connected');
  };

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
      setIsConnected(false);
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

  // 菜单配置（参考 gpui-client）
  const menuItems = [
    { key: 'client', icon: <DashboardOutlined />, label: '客户端' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'dependencies', icon: <FolderOutlined />, label: '依赖' },
    { key: 'permissions', icon: <SafetyOutlined />, label: '权限' },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于' },
    { key: 'debug', icon: <BugOutlined />, label: '调试' },
  ];

  const filteredLogs = logs.filter(
    (log) => filterLevel === 'all' || log.level === filterLevel
  );

  const getLogColor = (level: string) => {
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
        <Space justify="space-between" style={{ width: '100%' }}>
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
                <Tag color={isConnected ? 'green' : 'red'}>
                  {isConnected ? '已连接' : '未连接'}
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
        <Row gutter={16}>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="客户端 ID">
                <Text code copyable>{connectionInfo.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="服务器">
                <Text copyable>{connectionInfo.server}</Text>
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
      </Card>
    </div>
  );

  // 场景配置管理
  const handleSwitchScene = async (sceneId: string) => {
    await switchScene(sceneId);
    setCurrentScene(getCurrentScene());
    setScenes(getAllScenes());
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

  const handleDeleteConfig = (sceneId: string, sceneName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除配置 "${sceneName}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk() {
        deleteCustomScene(sceneId);
        setScenes(getAllScenes());
      },
    });
  };

  const handleResetConfig = () => {
    Modal.confirm({
      title: '重置配置',
      content: '确定要重置为默认配置吗？所有自定义配置将被删除。',
      okText: '重置',
      okType: 'warning',
      cancelText: '取消',
      onOk() {
        resetConfig();
        setScenes(getAllScenes());
        setCurrentScene(getCurrentScene());
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
                scene.id === currentScene.id ? (
                  <Tag color="green">当前</Tag>
                ) : (
                  <Button 
                    size="small"
                    onClick={() => handleSwitchScene(scene.id)}
                  >
                    切换
                  </Button>
                ),
                !scene.isDefault && scene.id !== currentScene.id && (
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
                      backgroundColor: scene.id === currentScene.id ? '#1890ff' : '#52c41a' 
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
              <Descriptions.Item label="场景名称">{currentScene.name}</Descriptions.Item>
              <Descriptions.Item label="API 服务器">{currentScene.server.apiUrl}</Descriptions.Item>
              <Descriptions.Item label="超时时间">{currentScene.server.timeout}ms</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Agent">
                {currentScene.local.agent.host}:{currentScene.local.agent.port}
              </Descriptions.Item>
              <Descriptions.Item label="VNC">
                {currentScene.local.vnc.host}:{currentScene.local.vnc.port}
              </Descriptions.Item>
              <Descriptions.Item label="文件服务">
                {currentScene.local.fileServer.host}:{currentScene.local.fileServer.port}
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
  const configEditor = (
    <ConfigEditor
      visible={configEditorVisible}
      onCancel={() => setConfigEditorVisible(false)}
      scene={editingScene}
      isNew={isNewConfig}
      onSave={() => {
        setScenes(getAllScenes());
        setCurrentScene(getCurrentScene());
      }}
    />
  );

  // 依赖管理页面
  const [dependencies, setDependencies] = useState<DependencyItem[]>([]);
  const [depLoading, setDepLoading] = useState(false);

  // 加载依赖数据
  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      const data = await getDependencies();
      setDependencies(data);
    } catch (error) {
      message.error('加载依赖数据失败');
    } finally {
      setDepLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  // 获取依赖统计
  const depSummary = {
    total: dependencies.length,
    installed: dependencies.filter(d => d.status === 'installed').length,
    missing: dependencies.filter(d => d.status === 'missing').length,
  };

  // 安装依赖
  const handleInstallDependency = async (name: string) => {
    await installDependency(name);
    await loadDependencies();
  };

  // 安装所有缺失依赖
  const handleInstallAll = async () => {
    await installAllDependencies();
    await loadDependencies();
  };

  // 卸载依赖
  const handleUninstallDependency = async (name: string) => {
    Modal.confirm({
      title: '确认卸载',
      content: `确定要卸载 ${name} 吗？`,
      okText: '卸载',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        await uninstallDependency(name);
        await loadDependencies();
      },
    });
  };

  // 获取状态标签
  const getStatusTag = (status: DependencyStatus) => {
    const config: Record<DependencyStatus, { color: string; text: string }> = {
      installed: { color: 'green', text: '已安装' },
      missing: { color: 'red', text: '未安装' },
      outdated: { color: 'orange', text: '需更新' },
      installing: { color: 'blue', text: '安装中...' },
      checking: { color: 'processing', text: '检查中...' },
      error: { color: 'red', text: '错误' },
    };
    return config[status] || { color: 'default', text: '未知' };
  };

  // 渲染依赖项
  const renderDependencyItem = (item: DependencyItem) => {
    const status = getStatusTag(item.status);
    const isNpmPackage = item.name.startsWith('@') || item.name.includes('-');
    
    // 构建操作按钮
    const actions: React.ReactNode[] = [
      <Tag color={status.color}>{status.text}</Tag>,
    ];
    
    if (item.status === 'missing' && !item.required) {
      actions.push(
        <Button
          type="primary"
          size="small"
          onClick={() => handleInstallDependency(item.name)}
        >
          安装
        </Button>
      );
    }
    
    if (item.status === 'installed' && !item.required) {
      actions.push(
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => handleUninstallDependency(item.name)}
        >
          卸载
        </Button>
      );
    }
    
    return (
      <List.Item actions={actions}>
        <List.Item.Meta
          avatar={<Avatar icon={<CodeOutlined />} style={{ backgroundColor: item.required ? '#1890ff' : '#52c41a' }} />}
          title={
            <Space>
              <span>{item.displayName}</span>
              {item.required && <Tag color="red">必需</Tag>}
              {isNpmPackage && <Tag color="orange">npm</Tag>}
            </Space>
          }
          description={
            <Space direction="vertical" size={0}>
              <Text type="secondary">{item.description}</Text>
              {item.version && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  版本: {item.version}
                  {item.source && ` | 来源: ${item.source}`}
                </Text>
              )}
            </Space>
          }
        />
      </List.Item>
    );
  };

  const renderDependenciesPage = () => (
    <div style={{ maxWidth: 900 }}>
      {/* 统计卡片 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space split="|">
          <Text>共 {depSummary.total} 个依赖</Text>
          <Text type="success">已安装 {depSummary.installed}</Text>
          <Text type="danger">缺失 {depSummary.missing}</Text>
        </Space>
        {depSummary.missing > 0 && (
          <Button
            type="primary"
            size="small"
            style={{ marginLeft: 16 }}
            onClick={handleInstallAll}
          >
            安装全部缺失依赖
          </Button>
        )}
      </Card>

      {/* 依赖列表 */}
      <Card
        title="依赖列表"
        extra={
          <Button icon={<RedoOutlined />} onClick={loadDependencies} loading={depLoading}>
            刷新
          </Button>
        }
      >
        <List
          loading={depLoading}
          dataSource={dependencies}
          renderItem={renderDependencyItem}
        />
      </Card>
    </div>
  );

  // 权限页面
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

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
  const getStatusConfig = (status: string, required: boolean) => {
    const baseConfig: Record<string, { color: string; text: string }> = {
      granted: { color: 'success', text: '已授权' },
      denied: { color: 'error', text: '已拒绝' },
      pending: { color: 'warning', text: '待授权' },
      unknown: { color: 'default', text: '未知' },
    };
    return baseConfig[status] || baseConfig.unknown;
  };

  // 计算权限统计
  const grantedCount = permissions.filter((p) => p.status === 'granted').length;
  const totalCount = permissions.length;
  const allGranted = grantedCount === totalCount;

  // 权限页面
  const renderPermissionsPage = () => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>权限设置</Title>
        <Button icon={<RedoOutlined />} onClick={handleRefreshPermissions} loading={permissionsLoading}>
          刷新
        </Button>
      </div>

      {/* 权限状态摘要 */}
      <Alert
        message={allGranted ? '权限正常' : '权限提醒'}
        description={
          allGranted
            ? `所有权限已授权 (${grantedCount}/${totalCount})`
            : `已授权 ${grantedCount}/${totalCount} 个权限`
        }
        type={allGranted ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 权限列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <List
          loading={permissionsLoading}
          dataSource={permissions}
          renderItem={(item) => {
            const statusConfig = getStatusConfig(item.status, item.required);
            return (
              <List.Item
                style={{
                  background: item.required && item.status !== 'granted' ? '#fffbe6' : undefined,
                  borderRadius: 8,
                  marginBottom: 8,
                  padding: '12px 16px',
                }}
                actions={[
                  <Button
                    type="link"
                    size="small"
                    onClick={() => handleOpenSettings(item.id)}
                  >
                    前往设置
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      icon={<SafetyOutlined />}
                      style={{
                        backgroundColor:
                          item.status === 'granted'
                            ? '#52c41a'
                            : item.required
                            ? '#faad14'
                            : '#d9d9d9',
                      }}
                    />
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{item.displayName}</span>
                      {item.required && (
                        <Tag color="red" style={{ fontSize: 12 }}>
                          必需
                        </Tag>
                      )}
                    </div>
                  }
                  description={
                    <div>
                      <div style={{ color: '#666', marginBottom: 4 }}>{item.description}</div>
                      <Tag color={statusConfig.color}>{statusConfig.text}</Tag>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>
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
          {activeTab === 'debug' && renderDebugPage()}
          {activeTab === 'logs' && renderLogsPage()}
        </div>
      </div>
    </div>
  );
}

export default App;
