/**
 * 初始化向导 - 步骤2: 账号登录
 * 
 * 功能:
 * - 检查网络连接
 * - 用户账号登录
 * - 登录成功后进入下一步
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Form,
  Input,
  Button,
  Space,
  Typography,
  Divider,
  message,
  Alert,
  Spin,
  Result,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  CheckCircleOutlined,
  WifiOutlined,
  DisconnectOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  loginAndRegister,
  getCurrentAuth,
  initAuthStore,
} from '../services/auth';
import { completeStep2 } from '../services/setup';

const { Title, Text } = Typography;

interface SetupStep2Props {
  /** 完成回调 */
  onComplete: () => void;
}

// 网络连接状态
type NetworkStatus = 'checking' | 'connected' | 'disconnected';

/**
 * 步骤2: 账号登录组件
 */
export default function SetupStep2({ onComplete }: SetupStep2Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('checking');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  /**
   * 检查网络连接（通过 navigator.onLine 和尝试 fetch）
   */
  const checkNetworkConnection = useCallback(async () => {
    setNetworkStatus('checking');
    
    // 首先检查 navigator.onLine
    if (!navigator.onLine) {
      setNetworkStatus('disconnected');
      return;
    }
    
    // 尝试发起一个简单的网络请求来确认连接
    try {
      // 尝试访问一个可靠的端点（可以是你的服务器）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      await fetch('https://nvwa-api.xspaceagi.com/health', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      setNetworkStatus('connected');
    } catch (error) {
      console.warn('[SetupStep2] 网络连接检测:', error);
      // 即使 fetch 失败，如果 navigator.onLine 为 true，也假设网络可用
      // 因为 no-cors 模式下可能会有各种原因导致失败
      setNetworkStatus('connected');
    }
  }, []);

  /**
   * 检查登录状态
   */
  const checkLoginStatus = useCallback(async () => {
    setCheckingAuth(true);
    try {
      await initAuthStore();
      const auth = await getCurrentAuth();
      if (auth.isLoggedIn) {
        setIsLoggedIn(true);
      }
    } catch (error) {
      console.error('[SetupStep2] 检查登录状态失败:', error);
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  /**
   * 初始化
   */
  useEffect(() => {
    const init = async () => {
      await checkNetworkConnection();
      await checkLoginStatus();
    };
    init();
  }, [checkNetworkConnection, checkLoginStatus]);

  /**
   * 重新检查网络连接
   */
  const handleRetryNetworkCheck = async () => {
    await checkNetworkConnection();
  };

  /**
   * 提交登录表单
   */
  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await loginAndRegister(values.username, values.password);
      message.success('登录成功');
      
      // 登录成功后自动进入下一步
      await completeStep2();
      onComplete();
    } catch (error) {
      // 错误已在 auth.ts 中处理
      console.error('[SetupStep2] 登录失败:', error);
      setLoading(false);
    }
  };

  /**
   * 继续下一步（已登录状态下点击按钮）
   */
  const handleContinue = async () => {
    try {
      await completeStep2();
      onComplete();
    } catch (error) {
      console.error('[SetupStep2] 保存进度失败:', error);
      // 即使保存失败也继续
      onComplete();
    }
  };

  /**
   * 渲染网络连接状态
   */
  const renderNetworkCheck = () => {
    if (networkStatus === 'checking') {
      return (
        <Alert
          message="正在检查网络连接..."
          type="info"
          icon={<Spin size="small" />}
          showIcon
          style={{ marginBottom: 12 }}
        />
      );
    }

    if (networkStatus === 'disconnected') {
      return (
        <Alert
          message="网络连接不可用"
          description={
            <Space direction="vertical">
              <Text>请检查您的网络连接后重试。</Text>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleRetryNetworkCheck}
              >
                重新检查
              </Button>
            </Space>
          }
          type="error"
          icon={<DisconnectOutlined />}
          showIcon
          style={{ marginBottom: 12 }}
        />
      );
    }

    return (
      <Alert
        message="网络连接正常"
        type="success"
        icon={<WifiOutlined />}
        showIcon
        style={{ marginBottom: 12 }}
      />
    );
  };

  /**
   * 渲染登录成功状态
   */
  const renderLoggedIn = () => (
    <Result
      icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
      title="登录成功"
      subTitle="您已成功登录，可以继续下一步"
      extra={
        <Button type="primary" size="middle" onClick={handleContinue}>
          下一步
        </Button>
      }
    />
  );

  /**
   * 渲染登录表单
   */
  const renderLoginForm = () => (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{ username: '', password: '' }}
    >
      <Form.Item
        name="username"
        label="账号"
        rules={[{ required: true, message: '请输入账号' }]}
      >
        <Input
          prefix={<UserOutlined />}
          placeholder="用户名 / 手机号 / 邮箱"
          size="middle"
          autoComplete="username"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="请输入密码"
          size="middle"
          autoComplete="current-password"
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 0, marginTop: 12 }}>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          size="middle"
          block
          disabled={networkStatus !== 'connected'}
        >
          登录
        </Button>
      </Form.Item>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          支持用户名、邮箱、手机号登录
        </Text>
      </div>
    </Form>
  );

  // 检查中
  if (checkingAuth) {
    return (
      <div className="setup-step2">
        <div className="step-loading">
          <Spin size="large" />
          <Text style={{ marginTop: 16 }}>正在检查登录状态...</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-step2">
      <div className="step-header">
        <Title level={4}>
          <UserOutlined style={{ marginRight: 8 }} />
          账号登录
        </Title>
        <Text type="secondary">
          登录您的 NuWax 账号以使用完整功能
        </Text>
      </div>

      <Divider />

      {/* 网络权限检查 */}
      {!isLoggedIn && renderNetworkCheck()}

      {/* 登录表单或登录成功 */}
      {isLoggedIn ? renderLoggedIn() : renderLoginForm()}

      {/* 内联样式 */}
      <style>{`
        .setup-step2 {
          padding: 8px 0;
        }
        
        .step-header {
          margin-bottom: 6px;
        }
        
        .step-header .ant-typography {
          margin-bottom: 2px;
        }
        
        .step-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 36px 0;
        }

        .setup-step2 .ant-form-item {
          margin-bottom: 12px;
        }

        .setup-step2 .ant-divider {
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
}
