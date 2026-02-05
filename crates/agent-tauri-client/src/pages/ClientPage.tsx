/**
 * 客户端页面
 * 
 * 功能：
 * - 显示所有服务状态
 * - 启动/停止服务
 * - 显示连接信息
 * - 快速操作入口
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Space,
  Badge,
  Card,
  Button,
  Descriptions,
  Tag,
  Row,
  Col,
  Tooltip,
  Alert,
  Progress,
  List,
  Spin,
} from 'antd';
import {
  RobotOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CloudServerOutlined,
  ApiOutlined,
  FolderOutlined,
  SafetyOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { AgentStatus, LogEntry } from '../services';
import {
  getServicesStatus,
  restartAllServices,
  stopAllServices,
  ServiceInfo,
  SERVICE_DISPLAY_NAMES,
  SERVICE_STATE_COLORS,
} from '../services/dependencies';
import LoginForm from '../components/LoginForm';
import SceneSwitcher from '../components/SceneSwitcher';

const { Text } = Typography;

// 连接信息类型
interface ConnectionInfo {
  id: string;
  server: string;
}

// Tab 类型
type TabType = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

interface ClientPageProps {
  /** Agent 状态 */
  status: AgentStatus;
  /** 会话 ID */
  sessionId: string;
  /** 在线状态 */
  onlineStatus: boolean | null;
  /** 日志列表 */
  logs: LogEntry[];
  /** 连接信息 */
  connectionInfo: ConnectionInfo;
  /** 状态徽章配置 */
  badge: { status: 'success' | 'processing' | 'error' | 'default' | 'warning'; text: string };
  /** 是否加载中 */
  loading: boolean;
  /** 启动 Agent */
  onStart: () => void;
  /** 停止 Agent */
  onStop: () => void;
  /** 导航到其他 Tab */
  onNavigate?: (tab: TabType) => void;
}

/**
 * 客户端页面组件
 */
export default function ClientPage({
  status,
  sessionId,
  onlineStatus,
  logs,
  connectionInfo,
  badge,
  loading,
  onStart,
  onStop,
  onNavigate,
}: ClientPageProps) {
  // 服务状态
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesOperating, setServicesOperating] = useState(false);

  // 加载服务状态
  const loadServicesStatus = useCallback(async () => {
    setServicesLoading(true);
    try {
      const result = await getServicesStatus();
      setServices(result);
    } catch (error) {
      console.error('[ClientPage] 获取服务状态失败:', error);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // 初始加载和定时刷新
  useEffect(() => {
    loadServicesStatus();
    // 每 5 秒刷新一次服务状态
    const interval = setInterval(loadServicesStatus, 5000);
    return () => clearInterval(interval);
  }, [loadServicesStatus]);

  // 启动所有服务
  const handleStartServices = async () => {
    setServicesOperating(true);
    try {
      await restartAllServices();
      await loadServicesStatus();
    } catch (error) {
      console.error('[ClientPage] 启动服务失败:', error);
    } finally {
      setServicesOperating(false);
    }
  };

  // 停止所有服务
  const handleStopServices = async () => {
    setServicesOperating(true);
    try {
      await stopAllServices();
      await loadServicesStatus();
    } catch (error) {
      console.error('[ClientPage] 停止服务失败:', error);
    } finally {
      setServicesOperating(false);
    }
  };

  // 计算服务统计
  const runningCount = services.filter(s => s.state === 'Running').length;
  const totalCount = services.length;
  const allRunning = totalCount > 0 && runningCount === totalCount;
  const allStopped = totalCount > 0 && runningCount === 0;

  // 获取服务状态图标
  const getServiceStateIcon = (state: string) => {
    switch (state) {
      case 'Running':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'Stopped':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'Starting':
      case 'Stopping':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      default:
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    }
  };

  // 获取服务状态标签
  const getServiceStateTag = (state: string) => {
    const config: Record<string, { color: string; text: string }> = {
      Running: { color: 'success', text: '运行中' },
      Stopped: { color: 'error', text: '已停止' },
      Starting: { color: 'processing', text: '启动中' },
      Stopping: { color: 'warning', text: '停止中' },
      Error: { color: 'error', text: '错误' },
    };
    const c = config[state] || { color: 'default', text: state };
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  return (
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

      {/* 服务状态卡片 */}
      <Card
        title={
          <Space>
            <CloudServerOutlined />
            <span>服务状态</span>
            <Tag color={allRunning ? 'success' : allStopped ? 'error' : 'warning'}>
              {runningCount}/{totalCount} 运行中
            </Tag>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined spin={servicesLoading} />}
              onClick={loadServicesStatus}
              disabled={servicesLoading}
            >
              刷新
            </Button>
            {allStopped ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartServices}
                loading={servicesOperating}
              >
                启动全部
              </Button>
            ) : (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStopServices}
                loading={servicesOperating}
              >
                停止全部
              </Button>
            )}
          </Space>
        }
      >
        {servicesLoading && services.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">正在获取服务状态...</Text>
            </div>
          </div>
        ) : services.length === 0 ? (
          <Alert
            message="未检测到服务"
            description="请先完成初始化配置并安装依赖"
            type="info"
            showIcon
          />
        ) : (
          <List
            size="small"
            dataSource={services}
            renderItem={(service) => (
              <List.Item
                actions={[
                  getServiceStateTag(service.state),
                  service.pid ? <Text type="secondary">PID: {service.pid}</Text> : null,
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={getServiceStateIcon(service.state)}
                  title={SERVICE_DISPLAY_NAMES[service.serviceType] || service.serviceType}
                  description={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {service.serviceType === 'Rcoder' && 'HTTP Server / Agent 核心服务'}
                      {service.serviceType === 'NuwaxFileServer' && '本地文件服务 / 工作区管理'}
                      {service.serviceType === 'NuwaxLanproxy' && '内网穿透代理 / 远程连接'}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}

        {allStopped && services.length > 0 && (
          <Alert
            message="服务未启动"
            description="点击「启动全部」按钮启动所有服务"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
        
        {allRunning && (
          <Alert
            message="所有服务运行正常"
            type="success"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* 连接信息 */}
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>连接信息</span>
          </Space>
        }
        style={{ marginTop: 16 }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="连接状态">
                <Tag color={onlineStatus === true ? 'green' : onlineStatus === false ? 'red' : 'default'}>
                  {onlineStatus === true ? '在线' : onlineStatus === false ? '离线' : '未知'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="会话 ID">
                <Text code>{sessionId || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="平台">
                macOS / arm64
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="客户端 ID">
                <Text code copyable={!!connectionInfo.id}>
                  {connectionInfo.id || '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="服务器">
                <Text copyable={!!connectionInfo.server}>
                  {connectionInfo.server || '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="日志">
                {logs.length} 条记录
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {/* 快速操作 */}
      <Card title="快速操作" style={{ marginTop: 16 }}>
        <Space wrap>
          <Tooltip title="服务配置">
            <Button 
              icon={<SettingOutlined />} 
              onClick={() => onNavigate?.('settings')}
            >
              服务配置
            </Button>
          </Tooltip>
          <Tooltip title="依赖管理">
            <Button 
              icon={<FolderOutlined />} 
              onClick={() => onNavigate?.('dependencies')}
            >
              依赖管理
            </Button>
          </Tooltip>
          <Tooltip title="权限设置">
            <Button 
              icon={<SafetyOutlined />} 
              onClick={() => onNavigate?.('permissions')}
            >
              权限设置
            </Button>
          </Tooltip>
          <Tooltip title="查看日志">
            <Button 
              icon={<FileTextOutlined />} 
              onClick={() => onNavigate?.('logs')}
            >
              查看日志
            </Button>
          </Tooltip>
        </Space>
      </Card>
    </div>
  );
}
