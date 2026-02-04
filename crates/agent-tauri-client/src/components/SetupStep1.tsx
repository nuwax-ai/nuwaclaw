/**
 * 初始化向导 - 步骤1: 基础设置
 * 
 * 配置内容:
 * - 服务域名
 * - Agent 服务端口
 * - 文件服务端口
 * - 代理服务端口
 * - 工作区目录
 */

import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Typography,
  Divider,
  message,
  Tooltip,
} from 'antd';
import {
  GlobalOutlined,
  ApiOutlined,
  FolderOutlined,
  CloudServerOutlined,
  FileOutlined,
  SwapOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  saveStep1Config,
  getStep1Config,
  selectDirectory,
  type Step1Config,
} from '../services/setup';
import { DEFAULT_SETUP_STATE } from '../services/store';

const { Title, Text } = Typography;

interface SetupStep1Props {
  /** 完成回调 */
  onComplete: () => void;
}

/**
 * 步骤1: 基础设置组件
 */
export default function SetupStep1({ onComplete }: SetupStep1Props) {
  const [form] = Form.useForm<Step1Config>();
  const [loading, setLoading] = useState(false);
  const [selectingDir, setSelectingDir] = useState(false);

  /**
   * 加载已保存的配置
   */
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getStep1Config();
        form.setFieldsValue(config);
      } catch (error) {
        console.error('[SetupStep1] 加载配置失败:', error);
        // 使用默认值
        form.setFieldsValue({
          serverHost: DEFAULT_SETUP_STATE.serverHost,
          agentPort: DEFAULT_SETUP_STATE.agentPort,
          fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
          proxyPort: DEFAULT_SETUP_STATE.proxyPort,
          workspaceDir: DEFAULT_SETUP_STATE.workspaceDir,
        });
      }
    };
    loadConfig();
  }, [form]);

  /**
   * 选择工作区目录
   */
  const handleSelectDir = async () => {
    setSelectingDir(true);
    try {
      const dir = await selectDirectory();
      if (dir) {
        form.setFieldValue('workspaceDir', dir);
        message.success('已选择目录');
      }
    } catch (error) {
      console.error('[SetupStep1] 选择目录失败:', error);
      message.error('选择目录失败');
    } finally {
      setSelectingDir(false);
    }
  };

  /**
   * 提交表单
   */
  const handleSubmit = async (values: Step1Config) => {
    setLoading(true);
    try {
      await saveStep1Config(values);
      message.success('设置已保存');
      onComplete();
    } catch (error) {
      console.error('[SetupStep1] 保存配置失败:', error);
      message.error('保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 重置为默认值
   */
  const handleReset = () => {
    form.setFieldsValue({
      serverHost: DEFAULT_SETUP_STATE.serverHost,
      agentPort: DEFAULT_SETUP_STATE.agentPort,
      fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
      proxyPort: DEFAULT_SETUP_STATE.proxyPort,
      workspaceDir: '',
    });
    message.info('已重置为默认值');
  };

  return (
    <div className="setup-step1">
      <div className="step-header">
        <Title level={4}>
          <SettingOutlined style={{ marginRight: 8 }} />
          基础设置
        </Title>
        <Text type="secondary">
          配置服务器连接和本地工作目录
        </Text>
      </div>

      <Divider />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          serverHost: DEFAULT_SETUP_STATE.serverHost,
          agentPort: DEFAULT_SETUP_STATE.agentPort,
          fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
          proxyPort: DEFAULT_SETUP_STATE.proxyPort,
          workspaceDir: '',
        }}
      >
        {/* 服务域名 */}
        <Form.Item
          name="serverHost"
          label={
            <Space>
              <GlobalOutlined />
              <span>服务域名</span>
              <Tooltip title="NuWax 云服务的 API 地址">
                <QuestionCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          rules={[
            { required: true, message: '请输入服务域名' },
            { type: 'url', message: '请输入有效的 URL 地址' },
          ]}
        >
          <Input
            prefix={<CloudServerOutlined />}
            placeholder="https://nvwa-api.xspaceagi.com"
            size="large"
          />
        </Form.Item>

        {/* 端口配置 */}
        <div className="port-group">
          <Text strong style={{ display: 'block', marginBottom: 12 }}>
            <ApiOutlined style={{ marginRight: 8 }} />
            端口配置
          </Text>
          
          <Space wrap style={{ width: '100%' }}>
            {/* Agent 端口 */}
            <Form.Item
              name="agentPort"
              label="Agent 服务端口"
              rules={[
                { required: true, message: '请输入端口' },
                { type: 'number', min: 1, max: 65535, message: '端口范围 1-65535' },
              ]}
              style={{ marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder="9086"
                style={{ width: 150 }}
              />
            </Form.Item>

            {/* 文件服务端口 */}
            <Form.Item
              name="fileServerPort"
              label="文件服务端口"
              rules={[
                { required: true, message: '请输入端口' },
                { type: 'number', min: 1, max: 65535, message: '端口范围 1-65535' },
              ]}
              style={{ marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder="60000"
                style={{ width: 150 }}
              />
            </Form.Item>

            {/* 代理服务端口 */}
            <Form.Item
              name="proxyPort"
              label="代理服务端口"
              rules={[
                { required: true, message: '请输入端口' },
                { type: 'number', min: 1, max: 65535, message: '端口范围 1-65535' },
              ]}
              style={{ marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder="9099"
                style={{ width: 150 }}
              />
            </Form.Item>
          </Space>
        </div>

        <Divider />

        {/* 工作区目录 */}
        <Form.Item
          name="workspaceDir"
          label={
            <Space>
              <FolderOutlined />
              <span>工作区目录</span>
              <Tooltip title="用于存放项目文件和临时数据的本地目录">
                <QuestionCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: '请选择工作区目录' }]}
        >
          <Input
            prefix={<FileOutlined />}
            placeholder="选择本地目录..."
            size="large"
            readOnly
            addonAfter={
              <Button
                type="link"
                onClick={handleSelectDir}
                loading={selectingDir}
                style={{ padding: 0 }}
              >
                浏览...
              </Button>
            }
          />
        </Form.Item>

        <Divider />

        {/* 操作按钮 */}
        <Form.Item style={{ marginBottom: 0 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button onClick={handleReset} icon={<SwapOutlined />}>
              重置默认
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              size="large"
            >
              下一步
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 内联样式 */}
      <style>{`
        .setup-step1 {
          padding: 16px 0;
        }
        
        .step-header {
          margin-bottom: 8px;
        }
        
        .step-header .ant-typography {
          margin-bottom: 4px;
        }
        
        .port-group {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 16px;
        }
      `}</style>
    </div>
  );
}

