/**
 * 设置页面
 * 
 * 功能：
 * - 服务配置管理（服务域名、端口、工作区）
 * - 开机自启动设置
 * - 开发工具（仅开发模式，通过 DevToolsPanel 动态加载）
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Space,
  Card,
  Button,
  Switch,
  Form,
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
  SettingOutlined,
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
import { IS_DEV, DevToolsPanel } from '../components/dev';

const { Text } = Typography;

/**
 * 设置页面组件
 */
export default function SettingsPage() {
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

      {/* 开发工具面板 - 仅开发环境动态加载 */}
      {IS_DEV && DevToolsPanel && (
        <Suspense fallback={
          <Card size="small" style={{ textAlign: 'center', padding: 20 }}>
            <Spin />
            <div style={{ marginTop: 8 }}>加载开发工具...</div>
          </Card>
        }>
          <DevToolsPanel />
        </Suspense>
      )}
    </div>
  );
}
