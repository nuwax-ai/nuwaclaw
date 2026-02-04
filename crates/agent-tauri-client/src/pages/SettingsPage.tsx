/**
 * 设置页面
 * 
 * 功能：
 * - 部署环境管理（场景切换）
 * - 配置详情显示
 * - 连接设置
 */

import React from 'react';
import {
  Space,
  Card,
  Button,
  Tag,
  List,
  Switch,
  Form,
  Avatar,
  Descriptions,
  Row,
  Col,
} from 'antd';
import {
  CloudServerOutlined,
  SettingOutlined,
  RedoOutlined,
  PlusOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { SceneConfig } from '../services/config';

const { Text } = Typography;

interface SettingsPageProps {
  /** 场景列表 */
  scenes: SceneConfig[];
  /** 当前场景 */
  currentScene: SceneConfig | null;
  /** 自动连接设置 */
  autoConnect: boolean;
  /** 通知设置 */
  notifications: boolean;
  /** 切换场景 */
  onSwitchScene: (sceneId: string) => void;
  /** 添加配置 */
  onAddConfig: () => void;
  /** 编辑配置 */
  onEditConfig: (scene: SceneConfig) => void;
  /** 删除配置 */
  onDeleteConfig: (sceneId: string, sceneName: string) => void;
  /** 重置配置 */
  onResetConfig: () => void;
  /** 设置自动连接 */
  onAutoConnectChange: (value: boolean) => void;
  /** 设置通知 */
  onNotificationsChange: (value: boolean) => void;
  /** 获取有效场景配置 */
  getEffectiveScene: () => SceneConfig;
}

/**
 * 设置页面组件
 */
export default function SettingsPage({
  scenes,
  currentScene,
  autoConnect,
  notifications,
  onSwitchScene,
  onAddConfig,
  onEditConfig,
  onDeleteConfig,
  onResetConfig,
  onAutoConnectChange,
  onNotificationsChange,
  getEffectiveScene,
}: SettingsPageProps) {
  // 判断是否为当前场景
  const isCurrentScene = (sceneId: string) => currentScene?.id === sceneId;

  return (
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
            <Button icon={<RedoOutlined />} onClick={onResetConfig}>
              重置
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddConfig}>
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
                    onClick={() => onSwitchScene(scene.id)}
                  >
                    切换
                  </Button>
                ),
                !scene.isDefault && !isCurrentScene(scene.id) && (
                  <>
                    <Button
                      size="small"
                      onClick={() => onEditConfig(scene)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => onDeleteConfig(scene.id, scene.name)}
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
            <Switch checked={autoConnect} onChange={onAutoConnectChange} />
          </Form.Item>
          <Form.Item label="桌面通知">
            <Switch checked={notifications} onChange={onNotificationsChange} />
          </Form.Item>
          <Form.Item label="自动重连">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
