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
  Alert,
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
  getRecentWorkspaces,
  addRecentWorkspace,
  clearRecentWorkspaces,
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
  const [statusHint, setStatusHint] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error'>('info');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);

  const showStatus = (text: string, type: 'info' | 'error' = 'info') => {
    setStatusHint(text);
    setStatusType(type);
    setTimeout(() => setStatusHint(''), 1500);
  };

  /**
   * 加载已保存的配置
   */
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getStep1Config();
        form.setFieldsValue(config);
        const recent = await getRecentWorkspaces();
        setRecentWorkspaces(recent);
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
    showStatus('正在打开目录选择器...');
    try {
      const dir = await selectDirectory();
      if (dir) {
        form.setFieldValue('workspaceDir', dir);
        showStatus('已选择目录');
        await addRecentWorkspace(dir);
        setRecentWorkspaces(await getRecentWorkspaces());
      }
    } catch (error) {
      console.error('[SetupStep1] 选择目录失败:', error);
      message.error('选择目录失败');
      showStatus('选择目录失败', 'error');
    } finally {
      setSelectingDir(false);
    }
  };

  /**
   * 提交表单
   */
  const handleSubmit = async (values: Step1Config) => {
    setLoading(true);
    showStatus('正在保存设置...');
    try {
      await saveStep1Config(values);
      showStatus('设置已保存');
      if (values.workspaceDir) {
        await addRecentWorkspace(values.workspaceDir);
        setRecentWorkspaces(await getRecentWorkspaces());
      }
      onComplete();
    } catch (error) {
      console.error('[SetupStep1] 保存配置失败:', error);
      message.error('保存配置失败');
      showStatus('保存配置失败', 'error');
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
    showStatus('已重置为默认值');
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

      {statusHint && (
        <Alert
          message={statusHint}
          type={statusType}
          showIcon
          className="step-hint"
        />
      )}

      <Form
        form={form}
        layout="vertical"
        size="middle"
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
            size="middle"
          />
        </Form.Item>

        {/* 端口配置 */}
        <div className="port-group">
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            <ApiOutlined style={{ marginRight: 8 }} />
            端口配置
          </Text>
          
          <Space wrap size={8} style={{ width: '100%' }}>
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
                size="middle"
                style={{ width: 130 }}
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
                size="middle"
                style={{ width: 130 }}
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
                size="middle"
                style={{ width: 130 }}
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
            size="middle"
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

        {recentWorkspaces.length > 0 && (
          <div className="recent-workspaces">
            <div className="recent-header">
              <Text type="secondary" style={{ fontSize: 12 }}>
                最近使用
              </Text>
              <Button
                type="link"
                size="small"
                onClick={async () => {
                  await clearRecentWorkspaces();
                  setRecentWorkspaces([]);
                  showStatus('已清空最近记录');
                }}
              >
                清除
              </Button>
            </div>
            <Space wrap size={6} style={{ marginTop: 6 }}>
              {recentWorkspaces.map(dir => (
                <Button
                  key={dir}
                  size="small"
                  onClick={() => form.setFieldValue('workspaceDir', dir)}
                >
                  {dir}
                </Button>
              ))}
            </Space>
          </div>
        )}

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
              size="middle"
            >
              下一步
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 内联样式 */}
      <style>{`
        .setup-step1 {
          padding: 8px 0;
        }
        
        .step-header {
          margin-bottom: 6px;
        }
        
        .step-header .ant-typography {
          margin-bottom: 2px;
        }
        
        .port-group {
          background: #f5f5f5;
          padding: 10px 12px;
          border-radius: 8px;
          margin-bottom: 12px;
        }

        .setup-step1 .ant-form-item {
          margin-bottom: 12px;
        }

        .setup-step1 .ant-divider {
          margin: 12px 0;
        }

        .setup-step1 .ant-form-item-label > label {
          font-size: 12px;
        }

        .setup-step1 .ant-form-item-label {
          padding-bottom: 4px;
        }

        .setup-step1 .step-hint {
          margin-bottom: 12px;
          padding: 6px 10px;
          font-size: 12px;
        }

        .setup-step1 .recent-workspaces {
          margin-top: -4px;
          margin-bottom: 10px;
        }

        .setup-step1 .recent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .setup-step1 .recent-workspaces .ant-btn {
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
