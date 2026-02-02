import { useState, useEffect, useCallback } from 'react';
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
} from '@ant-design/icons';
import {
  AgentStatus,
  LogEntry,
  getAgentStatus,
  startAgent,
  stopAgent,
  getLogs,
  getConnectionInfo,
  onStatusChange,
  onLogChange,
} from './services';

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
  const [serverUrl, setServerUrl] = useState('http://localhost:8080');
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  // 初始化
  useEffect(() => {
    initData();

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

  // 设置页面
  const renderSettingsPage = () => (
    <div style={{ maxWidth: 600 }}>
      <Card title="服务器配置">
        <Form layout="vertical">
          <Form.Item label="API 服务器地址">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:8080"
              prefix={<GlobalOutlined />}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card title="连接设置" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item label="开机自启动">
            <Switch checked={autoConnect} onChange={setAutoConnect} />
          </Form.Item>
          <Form.Item label="桌面通知">
            <Switch checked={notifications} onChange={setNotifications} />
          </Form.Item>
          <Form.Item label="自动重连">
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      <Card title="安全设置" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item label="加密通信">
            <Switch defaultChecked />
          </Form.Item>
          <Form.Item label="身份验证">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );

  // 依赖管理页面
  const renderDependenciesPage = () => (
    <Card title="依赖管理">
      <List
        dataSource={[
          { name: 'Node.js', version: 'v18.19.0', status: 'installed' },
          { name: 'npm', version: 'v10.2.4', status: 'installed' },
          { name: 'pnpm', version: 'v8.15.0', status: 'installed' },
          { name: 'Python', version: 'v3.11.0', status: 'missing' },
        ]}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Tag color={item.status === 'installed' ? 'green' : 'red'}>
                {item.status === 'installed' ? '已安装' : '未安装'}
              </Tag>
            ]}
          >
            <List.Item.Meta
              avatar={<Avatar icon={<CodeOutlined />} />}
              title={item.name}
              description={`版本: ${item.version}`}
            />
          </List.Item>
        )}
      />
    </Card>
  );

  // 权限页面
  const renderPermissionsPage = () => (
    <Card title="权限设置">
      <List
        dataSource={[
          { name: '屏幕录制', desc: '用于远程桌面功能', granted: true },
          { name: '辅助功能', desc: '用于控制键盘鼠标', granted: false },
          { name: '文件访问', desc: '用于文件传输', granted: true },
          { name: '网络访问', desc: '用于通信连接', granted: true },
        ]}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Tag color={item.granted ? 'green' : 'orange'}>
                {item.granted ? '已授权' : '未授权'}
              </Tag>
            ]}
          >
            <List.Item.Meta
              avatar={<Avatar icon={<SafetyOutlined />} />}
              title={item.name}
              description={item.desc}
            />
          </List.Item>
        )}
      />
    </Card>
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
    <Card
      title={
        <Space>
          <FileTextOutlined />
          <span>操作日志</span>
        </Space>
      }
      extra={
        <Select
          value={filterLevel}
          onChange={setFilterLevel}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部' },
            { value: 'info', label: '信息' },
            { value: 'success', label: '成功' },
            { value: 'warning', label: '警告' },
            { value: 'error', label: '错误' },
          ]}
        />
      }
    >
      <List
        dataSource={filteredLogs}
        renderItem={(log) => (
          <List.Item>
            <List.Item.Meta
              avatar={
                <Tag color={getLogColor(log.level)}>
                  {log.level.toUpperCase()}
                </Tag>
              }
              title={<Text code>{log.timestamp}</Text>}
              description={log.message}
            />
          </List.Item>
        )}
        locale={{ emptyText: '暂无日志' }}
      />
    </Card>
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
