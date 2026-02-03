/**
 * 登录表单组件
 */

import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Avatar, Space, Typography } from 'antd';
import { UserOutlined, LockOutlined, LogoutOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { loginAndRegister, logout, getCurrentAuth } from '../services/auth';

const { Text, Title } = Typography;

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [loading, setLoading] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [username, setUsername] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('');
  const [form] = Form.useForm();

  useEffect(() => {
    // 检查登录状态
    const auth = getCurrentAuth();
    if (auth.isLoggedIn && auth.userInfo) {
      setIsLogged(true);
      setUsername(auth.userInfo.username || '');
      setUserDisplayName(auth.userInfo.displayName || auth.username || '');
    }
  }, []);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await loginAndRegister(values.username, values.password);
      setIsLogged(true);
      setUsername(values.username);
      setUserDisplayName(values.username);
      message.success('登录成功！');
      onLoginSuccess();
    } catch (error) {
      // 错误已在 auth.ts 中处理
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setIsLogged(false);
    setUsername('');
    setUserDisplayName('');
    form.resetFields();
    message.info('已退出登录');
  };

  if (isLogged) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#52c41a' }}>
            <CheckCircleOutlined style={{ position: 'absolute', bottom: -4, right: -4, color: '#52c41a', fontSize: 12 }} />
          </Avatar>
          <div>
            <Text strong>{userDisplayName}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{username}</Text>
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

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Title level={5} style={{ marginBottom: 16 }}>账号登录</Title>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ username: '', password: '' }}
      >
        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="用户名 / 手机号"
            size="large"
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
    </Card>
  );
}
