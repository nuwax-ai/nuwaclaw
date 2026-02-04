/**
 * 客户端页面
 * 
 * 功能：
 * - 显示 Agent 状态
 * - 启动/停止 Agent
 * - 显示连接信息
 * - 快速操作入口
 */

import React from 'react';
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
} from 'antd';
import {
  RobotOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CloudServerOutlined,
  ApiOutlined,
  BellOutlined,
  FolderOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { AgentStatus, LogEntry } from '../services';
import LoginForm from '../components/LoginForm';
import SceneSwitcher from '../components/SceneSwitcher';

const { Text } = Typography;

// 连接信息类型
interface ConnectionInfo {
  id: string;
  server: string;
}

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
}: ClientPageProps) {
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
                onClick={onStart}
                loading={loading}
              >
                启动
              </Button>
            ) : (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={onStop}
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
}
