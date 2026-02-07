/**
 * 登录表单组件
 */

import { useState, useEffect, useCallback } from "react";
import { Form, Input, Button, message, Typography } from "antd";
import {
  UserOutlined,
  LockOutlined,
  LogoutOutlined,
  CheckCircleOutlined,
  MailOutlined,
  PhoneOutlined,
} from "@ant-design/icons";
import {
  loginAndRegister,
  logout,
  getCurrentAuth,
  initAuthStore,
} from "../services/auth";
import type { AuthUserInfo } from "../services/store";

const { Text } = Typography;

type LoginMethod = "username" | "email" | "phone";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [loading, setLoading] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [userInfo, setUserInfo] = useState<AuthUserInfo | null>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("username");
  const [form] = Form.useForm();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await initAuthStore();
        const auth = await getCurrentAuth();
        if (auth.isLoggedIn && auth.userInfo) {
          setIsLogged(true);
          setUserInfo(auth.userInfo);
        }
      } catch (error) {
        console.error("初始化认证状态失败:", error);
      } finally {
        setInitialized(true);
      }
    };
    init();
  }, []);

  const detectLoginMethod = useCallback((value: string): LoginMethod => {
    if (value.includes("@")) return "email";
    if (/^\d{7,}$/.test(value)) return "phone";
    return "username";
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value && !loading) {
      const detected = detectLoginMethod(value);
      if (detected !== loginMethod) setLoginMethod(detected);
    }
  };

  const getPlaceholder = () => {
    switch (loginMethod) {
      case "email":
        return "邮箱地址";
      case "phone":
        return "手机号码";
      default:
        return "用户名 / 手机号";
    }
  };

  const getPrefixIcon = () => {
    switch (loginMethod) {
      case "email":
        return <MailOutlined />;
      case "phone":
        return <PhoneOutlined />;
      default:
        return <UserOutlined />;
    }
  };

  const getUsernameRules = () => {
    const baseRules: Array<{ required: boolean; message: string }> = [
      { required: true, message: "请输入登录账号" },
    ];
    switch (loginMethod) {
      case "email":
        return [
          ...baseRules,
          { type: "email" as const, message: "请输入有效的邮箱" },
        ];
      case "phone":
        return [
          ...baseRules,
          { pattern: /^\d{7,11}$/, message: "请输入有效的手机号" },
        ];
      default:
        return [
          ...baseRules,
          {
            pattern: /^[a-zA-Z0-9_]{3,20}$/,
            message: "3-20位字母、数字或下划线",
          },
        ];
    }
  };

  const handleSubmit = async (values: {
    username: string;
    password: string;
  }) => {
    setLoading(true);
    try {
      await loginAndRegister(values.username, values.password);
      const auth = await getCurrentAuth();
      if (auth.userInfo) setUserInfo(auth.userInfo);
      setIsLogged(true);
      message.success("登录成功");
      onLoginSuccess();
    } catch (error) {
      // 错误已在 auth.ts 中处理
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsLogged(false);
    setUserInfo(null);
    form.resetFields();
    message.info("已退出登录");
  };

  if (!initialized) return null;

  // 已登录
  if (isLogged && userInfo) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          background: "#fff",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircleOutlined style={{ color: "#16a34a", fontSize: 12 }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {userInfo.displayName || userInfo.username}
          </span>
          <span style={{ fontSize: 12, color: "#a1a1aa" }}>
            {userInfo.username}
          </span>
        </div>
        <Button
          type="text"
          size="small"
          danger
          icon={<LogoutOutlined />}
          onClick={handleLogout}
        >
          退出
        </Button>
      </div>
    );
  }

  // 未登录
  return (
    <div
      style={{
        border: "1px solid #e4e4e7",
        borderRadius: 8,
        background: "#fff",
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "#18181b",
          marginBottom: 12,
        }}
      >
        账号登录
      </div>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ username: "", password: "" }}
        size="small"
      >
        <Form.Item
          name="username"
          rules={getUsernameRules()}
          style={{ marginBottom: 10 }}
        >
          <Input
            prefix={getPrefixIcon()}
            placeholder={getPlaceholder()}
            onChange={handleInputChange}
            allowClear
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
          style={{ marginBottom: 12 }}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="密码" />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={loading} block>
          登录
        </Button>
      </Form>

      <div style={{ marginTop: 8, textAlign: "center" }}>
        <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
          支持用户名、邮箱、手机号
        </Text>
      </div>
    </div>
  );
}
