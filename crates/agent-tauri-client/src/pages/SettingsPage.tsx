/**
 * 设置页面
 * 
 * 功能：
 * - 服务配置管理（服务域名、端口、工作区）
 * - 开机自启动设置
 * - 部署环境管理（仅开发模式可见）
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  Input,
  InputNumber,
  message,
  Modal,
  Alert,
  Spin,
} from 'antd';
import {
  CloudServerOutlined,
  SettingOutlined,
  RedoOutlined,
  PlusOutlined,
  EnvironmentOutlined,
  FolderOutlined,
  SaveOutlined,
  EditOutlined,
  PoweroffOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import {
  getStep1Config,
  saveStep1Config,
  selectDirectory,
  type Step1Config,
} from '../services/setup';
import { restartAllServices } from '../services/dependencies';
import { SceneConfig } from '../services/config';

const { Text, Title } = Typography;

// 是否为开发模式
const IS_DEV = import.meta.env.DEV;

interface SettingsPageProps {
  /** 场景列表（开发模式用） */
  scenes?: SceneConfig[];
  /** 当前场景（开发模式用） */
  currentScene?: SceneConfig | null;
  /** 切换场景（开发模式用） */
  onSwitchScene?: (sceneId: string) => void;
  /** 添加配置（开发模式用） */
  onAddConfig?: () => void;
  /** 编辑配置（开发模式用） */
  onEditConfig?: (scene: SceneConfig) => void;
  /** 删除配置（开发模式用） */
  onDeleteConfig?: (sceneId: string, sceneName: string) => void;
  /** 重置配置（开发模式用） */
  onResetConfig?: () => void;
}

/**
 * 设置页面组件
 */
export default function SettingsPage({
  scenes = [],
  currentScene = null,
  onSwitchScene,
  onAddConfig,
  onEditConfig,
  onDeleteConfig,
  onResetConfig,
}: SettingsPageProps) {
  // 配置表单
  const [form] = Form.useForm<Step1Config>();
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 编辑模式
  const [editing, setEditing] = useState(false);
  // 保存中
  const [saving, setSaving] = useState(false);
  // 开机自启动
  const [autoLaunch, setAutoLaunch] = useState(false);
  // 原始配置（用于取消编辑时恢复）
  const [originalConfig, setOriginalConfig] = useState<Step1Config | null>(null);

  /**
   * 加载配置
   */
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const config = await getStep1Config();
      form.setFieldsValue(config);
      setOriginalConfig(config);
    } catch (error) {
      console.error('加载配置失败:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [form]);

  /**
   * 加载开机自启动状态
   */
  const loadAutoLaunchState = useCallback(async () => {
    try {
      const enabled = await invoke<boolean>('get_auto_launch');
      setAutoLaunch(enabled);
    } catch (error) {
      console.error('获取开机自启动状态失败:', error);
      // 获取失败时保持默认 false 状态
    }
  }, []);

  // 组件挂载时加载配置和自启动状态
  useEffect(() => {
    loadConfig();
    loadAutoLaunchState();
  }, [loadConfig, loadAutoLaunchState]);

  /**
   * 选择工作区目录
   */
  const handleSelectWorkspace = async () => {
    const dir = await selectDirectory();
    if (dir) {
      form.setFieldValue('workspaceDir', dir);
    }
  };

  /**
   * 进入编辑模式
   */
  const handleEdit = () => {
    setEditing(true);
  };

  /**
   * 取消编辑
   */
  const handleCancelEdit = () => {
    if (originalConfig) {
      form.setFieldsValue(originalConfig);
    }
    setEditing(false);
  };

  /**
   * 保存配置并重启服务
   */
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      
      Modal.confirm({
        title: '保存配置',
        content: '保存配置后需要重启服务才能生效，确定要保存吗？',
        okText: '保存并重启',
        cancelText: '取消',
        onOk: async () => {
          setSaving(true);
          try {
            // 保存配置
            await saveStep1Config(values);
            setOriginalConfig(values);
            setEditing(false);
            
            // 重启服务
            message.loading('正在重启服务...', 0);
            await restartAllServices();
            message.destroy();
            message.success('配置已保存，服务已重启');
          } catch (error) {
            message.destroy();
            console.error('保存配置失败:', error);
            message.error('保存配置失败');
          } finally {
            setSaving(false);
          }
        },
      });
    } catch (error) {
      // 表单验证失败
      console.error('表单验证失败:', error);
    }
  };

  /**
   * 开机自启动设置变更
   * 调用 Rust 后端实现跨平台开机自启动
   */
  const handleAutoLaunchChange = async (checked: boolean) => {
    try {
      // 调用 Tauri 命令设置开机自启动
      await invoke('set_auto_launch', { enabled: checked });
      setAutoLaunch(checked);
      message.success(checked ? '已开启开机自启动' : '已关闭开机自启动');
    } catch (error) {
      console.error('设置开机自启动失败:', error);
      message.error('设置开机自启动失败，请在系统设置中手动配置');
      // 恢复 UI 状态
      setAutoLaunch(!checked);
    }
  };

  /**
   * 判断是否为当前场景（开发模式用）
   */
  const isCurrentScene = (sceneId: string) => currentScene?.id === sceneId;

  // 加载中
  if (loading) {
    return (
      <div style={{ maxWidth: 900, textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>正在加载配置...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* 服务配置 */}
      <Card
        title={
          <Space>
            <SettingOutlined />
            <span>服务配置</span>
          </Space>
        }
        extra={
          editing ? (
            <Space>
              <Button onClick={handleCancelEdit} disabled={saving}>
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存
              </Button>
            </Space>
          ) : (
            <Button icon={<EditOutlined />} onClick={handleEdit}>
              编辑
            </Button>
          )
        }
        style={{ marginBottom: 16 }}
      >
        <Form
          form={form}
          layout="vertical"
          disabled={!editing}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="serverHost"
                label="服务域名"
                rules={[{ required: true, message: '请输入服务域名' }]}
              >
                <Input placeholder="例如: nvwa-api.xspaceagi.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="agentPort"
                label="Agent 服务端口"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="fileServerPort"
                label="文件服务端口"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="proxyPort"
                label="代理服务端口"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="workspaceDir"
            label="工作区目录"
            rules={[{ required: true, message: '请选择工作区目录' }]}
          >
            <Input
              placeholder="点击选择目录"
              readOnly
              addonAfter={
                editing && (
                  <Button
                    type="text"
                    size="small"
                    icon={<FolderOutlined />}
                    onClick={handleSelectWorkspace}
                  >
                    选择
                  </Button>
                )
              }
            />
          </Form.Item>
        </Form>

        {!editing && (
          <Alert
            message="提示"
            description="修改配置后需要重启服务才能生效"
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* 系统设置 */}
      <Card
        title={
          <Space>
            <PoweroffOutlined />
            <span>系统设置</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Form layout="vertical">
          <Form.Item
            label="开机自启动"
            extra="开启后，系统启动时将自动运行 NuWax Agent"
          >
            <Switch
              checked={autoLaunch}
              onChange={handleAutoLaunchChange}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 开发模式：部署环境管理 */}
      {IS_DEV && scenes.length > 0 && (
        <Card 
          title={
            <Space>
              <CloudServerOutlined />
              <span>部署环境</span>
              <Tag color="orange">开发模式</Tag>
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
          <Alert
            message="此功能仅在开发模式下可见"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
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
                      onClick={() => onSwitchScene?.(scene.id)}
                    >
                      切换
                    </Button>
                  ),
                  !scene.isDefault && !isCurrentScene(scene.id) && (
                    <>
                      <Button
                        size="small"
                        onClick={() => onEditConfig?.(scene)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => onDeleteConfig?.(scene.id, scene.name)}
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
      )}
    </div>
  );
}
