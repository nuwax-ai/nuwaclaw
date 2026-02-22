import React, { useState, useEffect } from 'react';
import {
  Card,
  Steps,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Result,
  message,
  Alert,
} from 'antd';
import {
  SettingOutlined,
  UserOutlined,
  ApiOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { setupService, authService, Step1Config, DEFAULT_STEP1_CONFIG } from '../services/setup';

interface SetupWizardProps {
  onComplete: () => void;
}

function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step1Config, setStep1Config] = useState<Step1Config>(DEFAULT_STEP1_CONFIG);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    checkSetupState();
  }, []);

  const checkSetupState = async () => {
    const state = await setupService.getSetupState();
    if (state.completed) {
      setCompleted(true);
      onComplete();
    } else {
      setCurrentStep(state.currentStep - 1);
    }

    const config = await setupService.getStep1Config();
    setStep1Config(config);
  };

  const handleStep1Submit = async () => {
    setLoading(true);
    try {
      await setupService.saveStep1Config(step1Config);
      setCurrentStep(1);
      message.success('基础配置已保存');
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      message.warning('请输入账号和密码');
      return;
    }

    setLoading(true);
    try {
      await authService.login(username, password);
      await setupService.completeStep2();
      setCurrentStep(2);
      message.success('登录成功');
    } catch (error) {
      message.error('登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await setupService.completeSetup();
      setCompleted(true);
      onComplete();
      message.success('初始化完成');
    } catch (error) {
      message.error('完成初始化失败');
    } finally {
      setLoading(false);
    }
  };

  if (completed) {
    return null;
  }

  const steps = [
    { title: '基础设置', icon: <SettingOutlined /> },
    { title: '账号登录', icon: <UserOutlined /> },
    { title: '完成', icon: <CheckCircleOutlined /> },
  ];

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#f0f2f5',
      padding: 24,
    }}>
      <Card style={{ width: 600 }} title="初始化向导">
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {currentStep === 0 && (
          <Form layout="vertical">
            <Alert
              message="基础设置"
              description="完成配置后即可使用，进度自动保存"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item label="服务域名" required>
              <Input
                value={step1Config.serverHost}
                onChange={(e) => setStep1Config({ ...step1Config, serverHost: e.target.value })}
                placeholder="例如：https://agent.nuwax.com"
              />
            </Form.Item>

            <Form.Item label="Agent 端口">
              <InputNumber
                value={step1Config.agentPort}
                onChange={(value) => setStep1Config({ ...step1Config, agentPort: value || 8086 })}
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item label="文件服务端口">
              <InputNumber
                value={step1Config.fileServerPort}
                onChange={(value) => setStep1Config({ ...step1Config, fileServerPort: value || 8080 })}
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item label="工作区目录">
              <Input
                value={step1Config.workspaceDir}
                onChange={(e) => setStep1Config({ ...step1Config, workspaceDir: e.target.value })}
                placeholder="请输入有效的绝对路径（如 /path/to/dir）"
              />
            </Form.Item>

            <Button
              type="primary"
              onClick={handleStep1Submit}
              loading={loading}
              block
            >
              下一步：账号登录
            </Button>
          </Form>
        )}

        {currentStep === 1 && (
          <Form layout="vertical">
            <Alert
              message="账号登录"
              description="登录 NuWax 账号以使用完整功能"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item label="账号" required>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名 / 手机号 / 邮箱"
              />
            </Form.Item>

            <Form.Item label="动态认证码" required>
              <Input.Password
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请填写动态认证码"
              />
            </Form.Item>

            <Space>
              <Button onClick={() => setCurrentStep(0)}>
                上一步
              </Button>
              <Button
                type="primary"
                onClick={handleLogin}
                loading={loading}
              >
                登录
              </Button>
            </Space>
          </Form>
        )}

        {currentStep === 2 && (
          <Result
            status="success"
            title="初始化完成"
            subTitle="正在进入主界面，请稍候..."
            extra={[
              <Button
                type="primary"
                key="complete"
                onClick={handleComplete}
                loading={loading}
              >
                开始使用
              </Button>,
              <Button key="back" onClick={() => setCurrentStep(0)}>
                重新配置
              </Button>,
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export default SetupWizard;
