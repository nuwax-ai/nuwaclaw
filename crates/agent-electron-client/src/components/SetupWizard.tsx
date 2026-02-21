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
      message.success('Step 1 completed!');
    } catch (error) {
      message.error('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      message.warning('Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      // Placeholder: Replace with actual auth server call
      await authService.login(username, password);
      await setupService.completeStep2();
      setCurrentStep(2);
      message.success('Login successful!');
    } catch (error) {
      message.error('Login failed');
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
      message.success('Setup completed!');
    } catch (error) {
      message.error('Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  if (completed) {
    return null;
  }

  const steps = [
    { title: 'Basic Config', icon: <SettingOutlined /> },
    { title: 'Login', icon: <UserOutlined /> },
    { title: 'Ready', icon: <ApiOutlined /> },
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
      <Card style={{ width: 600 }}>
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {currentStep === 0 && (
          <Form layout="vertical">
            <Alert
              message="Basic Configuration"
              description="Configure your service connections"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item label="Server Host" required>
              <Input
                value={step1Config.serverHost}
                onChange={(e) => setStep1Config({ ...step1Config, serverHost: e.target.value })}
                placeholder="localhost or your server address"
              />
            </Form.Item>

            <Form.Item label="Agent Port">
              <InputNumber
                value={step1Config.agentPort}
                onChange={(value) => setStep1Config({ ...step1Config, agentPort: value || 8086 })}
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item label="File Server Port">
              <InputNumber
                value={step1Config.fileServerPort}
                onChange={(value) => setStep1Config({ ...step1Config, fileServerPort: value || 8080 })}
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item label="Workspace Directory">
              <Input
                value={step1Config.workspaceDir}
                onChange={(e) => setStep1Config({ ...step1Config, workspaceDir: e.target.value })}
                placeholder="~/workspace or custom path"
              />
            </Form.Item>

            <Button
              type="primary"
              onClick={handleStep1Submit}
              loading={loading}
              block
            >
              Next: Login
            </Button>
          </Form>
        )}

        {currentStep === 1 && (
          <Form layout="vertical">
            <Alert
              message="Login"
              description="Enter your credentials to continue"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item label="Username" required>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
              />
            </Form.Item>

            <Form.Item label="Password" required>
              <Input.Password
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
            </Form.Item>

            <Space>
              <Button onClick={() => setCurrentStep(0)}>
                Back
              </Button>
              <Button
                type="primary"
                onClick={handleLogin}
                loading={loading}
              >
                Login
              </Button>
            </Space>
          </Form>
        )}

        {currentStep === 2 && (
          <Result
            status="success"
            title="Setup Complete!"
            subTitle="Your client is ready to use. Click below to start."
            extra={[
              <Button
                type="primary"
                key="complete"
                onClick={handleComplete}
                loading={loading}
              >
                Start Using
              </Button>,
              <Button key="back" onClick={() => setCurrentStep(0)}>
                Reconfigure
              </Button>,
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export default SetupWizard;
