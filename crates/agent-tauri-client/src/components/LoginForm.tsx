/**
 * 登录表单组件
 * 支持用户名、邮箱、手机号三种登录方式
 */

import { useState, useEffect, useCallback } from 'react';
import { Form, Input, Button, Card, message, Avatar, Space, Typography, InputNumber } from 'antd';
import { UserOutlined, LockOutlined, LogoutOutlined, CheckCircleOutlined, MailOutlined, PhoneOutlined } from '@ant-design/icons';
import { loginAndRegister, logout, getCurrentAuth, AuthUserInfo } from '../services/auth';

const { Text, Title } = Typography;

// 登录方式类型
type LoginMethod = 'username' | 'email' | 'phone';

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [loading, setLoading] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [userInfo, setUserInfo] = useState<AuthUserInfo | null>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('username');
  const [form] = Form.useForm();

  // 初始化时检查登录状态
  useEffect(() => {
    const auth = getCurrentAuth();
    if (auth.isLoggedIn && auth.userInfo) {
      setIsLogged(true);
      setUserInfo(auth.userInfo);
    }
  }, []);

  /**
   * 检测输入内容自动识别登录方式
   * - 包含 @ 符号识别为邮箱
   * - 纯数字且长度>=7识别为手机号
   * - 其他识别为用户名
   */
  const detectLoginMethod = useCallback((value: string): LoginMethod => {
    if (value.includes('@')) {
      return 'email';
    }
    if (/^\d{7,}$/.test(value)) {
      return 'phone';
    }
    return 'username';
  }, []);

  /**
   * 处理输入变化，自动切换登录方式
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value && !loading) {
      const detected = detectLoginMethod(value);
      if (detected !== loginMethod) {
        setLoginMethod(detected);
      }
    }
  };

  /**
   * 获取登录方式的提示文字
   */
  const getPlaceholder = () => {
    switch (loginMethod) {
      case 'email':
        return '请输入邮箱地址';
      case 'phone':
        return '请输入手机号码';
      default:
        return '用户名 / 手机号';
    }
  };

  /**
   * 获取输入框前缀图标
   */
  const getPrefixIcon = () => {
    switch (loginMethod) {
      case 'email':
        return <MailOutlined />;
      case 'phone':
        return <PhoneOutlined />;
      default:
        return <UserOutlined />;
    }
  };

  /**
   * 表单验证规则
   * 根据登录方式动态验证
   */
  const getUsernameRules = () => {
    const rules = [{ required: true, message: '请输入登录账号' }];

    switch (loginMethod) {
      case 'email':
        // 邮箱格式验证
        rules.push({
          type: 'email' as const,
          message: '请输入有效的邮箱地址',
        });
        break;
      case 'phone':
        // 手机号格式验证（中国大陆手机号11位，其他至少7位数字）
        rules.push({
          pattern: /^\d{7,11}$/,
          message: '请输入有效的手机号码（7-11位数字）',
        });
        break;
      default:
        // 用户名验证（3-20位，可包含字母、数字、下划线）
        rules.push({
          pattern: /^[a-zA-Z0-9_]{3,20}$/,
          message: '用户名应为3-20位字母、数字或下划线',
        });
        break;
    }

    return rules;
  };

  /**
   * 提交登录表单
   */
  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await loginAndRegister(values.username, values.password);
      // 重新获取用户信息
      const auth = getCurrentAuth();
      if (auth.userInfo) {
        setUserInfo(auth.userInfo);
      }
      setIsLogged(true);
      message.success('登录成功！');
      onLoginSuccess();
    } catch (error) {
      // 错误已在 auth.ts 中处理
    } finally {
      setLoading(false);
    }
  };

  /**
   * 退出登录
   */
  const handleLogout = () => {
    logout();
    setIsLogged(false);
    setUserInfo(null);
    form.resetFields();
    message.info('已退出登录');
  };

  // 已登录状态展示
  if (isLogged && userInfo) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Avatar
            icon={<UserOutlined />}
            style={{ backgroundColor: '#52c41a' }}
          >
            <CheckCircleOutlined
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                color: '#52c41a',
                fontSize: 12,
              }}
            />
          </Avatar>
          <div>
            <Text strong>{userInfo.displayName || userInfo.username}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {userInfo.username}
            </Text>
          </div>
          <Button
            type="text"
            danger
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            style={{ marginLeft: 'auto' }}
          >
            退出
          </Button>
        </Space>
      </Card>
    );
  }

  // 未登录状态展示登录表单
  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Title level={5} style={{ marginBottom: 16 }}>
        账号登录
      </Title>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ username: '', password: '' }}
      >
        <Form.Item name="username" rules={getUsernameRules()}>
          <Input
            prefix={getPrefixIcon()}
            placeholder={getPlaceholder()}
            size="large"
            onChange={handleInputChange}
            allowClear
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="密码"
            size="large"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
          >
            登录
          </Button>
        </Form.Item>
      </Form>

      {/* 登录方式提示 */}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          支持用户名、邮箱、手机号登录
        </Text>
      </div>
    </Card>
  );
}
