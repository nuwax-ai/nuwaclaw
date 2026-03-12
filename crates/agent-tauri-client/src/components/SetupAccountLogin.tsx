/**
 * 初始化向导 - 账号登录
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Form,
  Input,
  Button,
  Typography,
  message,
  Alert,
  Result,
  Spin,
} from "antd";
import {
  UserOutlined,
  LockOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  LeftOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import {
  loginAndRegister,
  getCurrentAuth,
  initAuthStore,
  getAuthErrorMessage,
  getSavedUsername,
  logout,
} from "../services/auth";
import { completeStep2, getStep1Config } from "../services/setup";

const { Text } = Typography;

interface SetupStep2Props {
  onComplete: () => void;
  onBack?: () => void;
}

type NetworkStatus = "checking" | "connected" | "disconnected";

export default function SetupStep2({ onComplete, onBack }: SetupStep2Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("checking");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loginError, setLoginError] = useState<string>("");
  const [retryCooldown, setRetryCooldown] = useState(0);
  const [domain, setDomain] = useState("");

  const checkNetworkConnection = useCallback(async () => {
    setNetworkStatus("checking");
    try {
      const connected = await invoke<boolean>("check_network_cn");
      setNetworkStatus(connected ? "connected" : "disconnected");
    } catch {
      setNetworkStatus("disconnected");
    }
  }, []);

  const checkLoginStatus = useCallback(async () => {
    setCheckingAuth(true);
    try {
      await initAuthStore();
      const step1Config = await getStep1Config();
      setDomain(step1Config.serverHost);
      form.setFieldValue("domain", step1Config.serverHost);
      const savedUsername = await getSavedUsername();
      if (savedUsername) form.setFieldValue("username", savedUsername);
      const auth = await getCurrentAuth();
      if (auth.isLoggedIn) setIsLoggedIn(true);
    } catch (error) {
      console.error("[SetupStep2] 检查登录状态失败:", error);
    } finally {
      setCheckingAuth(false);
    }
  }, [form]);

  useEffect(() => {
    const init = async () => {
      await checkNetworkConnection();
      await checkLoginStatus();
    };
    init();
  }, [checkNetworkConnection, checkLoginStatus]);

  useEffect(() => {
    if (retryCooldown <= 0) return;
    const timer = setInterval(() => {
      setRetryCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryCooldown]);

  const handleSubmit = async (values: {
    domain: string;
    username: string;
    password: string;
  }) => {
    setLoading(true);
    setLoginError("");
    try {
      await loginAndRegister(values.username, values.password, {
        suppressToast: true,
        domain: values.domain,
      });
      setDomain(values.domain);
      setLoginError("");
      await completeStep2();
      onComplete();
    } catch (error) {
      setLoading(false);
      const errorMessage = getAuthErrorMessage(error);
      message.error(errorMessage);
      setLoginError(errorMessage);
      form.setFieldsValue({ password: "" });
      setRetryCooldown(3);
    }
  };

  const handleContinue = async () => {
    try {
      await completeStep2();
      onComplete();
    } catch {
      onComplete();
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setIsLoggedIn(false);
    } catch {
      message.error("退出登录失败");
    }
  };

  if (checkingAuth) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {onBack && (
          <Button
            type="text"
            size="small"
            icon={<LeftOutlined />}
            onClick={onBack}
          />
        )}
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#18181b" }}>
            账号登录
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa" }}>
            登录账号以使用完整功能
          </div>
        </div>
      </div>

      {loginError && (
        <Alert
          message="登录失败"
          description={
            <Text
              copyable={{ text: loginError }}
              style={{ fontSize: 12, color: "#52525b" }}
            >
              {loginError}
            </Text>
          }
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {networkStatus === "disconnected" && !isLoggedIn && (
        <Alert
          message="网络不可用"
          description={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={checkNetworkConnection}
            >
              重新检查
            </Button>
          }
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {isLoggedIn ? (
        <Result
          icon={<CheckCircleOutlined style={{ color: "#16a34a" }} />}
          title="已登录"
          subTitle={`当前域名：${domain || "-"}`}
          extra={
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button onClick={handleLogout} size="small">
                退出登录
              </Button>
              <Button type="primary" onClick={handleContinue}>
                下一步
              </Button>
            </div>
          }
          style={{ padding: "16px 0" }}
        />
      ) : (
        <>
          <Form
            form={form}
            layout="vertical"
            size="small"
            onFinish={handleSubmit}
            initialValues={{ username: "", password: "" }}
          >
            <Form.Item
              name="domain"
              label="服务域名"
              rules={[{ required: true, message: "请输入服务域名" }]}
            >
              <Input
                prefix={<GlobalOutlined />}
                placeholder="例如：https://agent.nuwax.com"
              />
            </Form.Item>

            <Form.Item
              name="username"
              label="账号"
              rules={[{ required: true, message: "请输入账号" }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="用户名 / 手机号 / 邮箱"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label="动态认证码"
              rules={[
                {
                  required: true,
                  message: "请填写动态认证码（在PC端或移动端的个人资料中查看）",
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请填写动态认证码（在PC端或移动端的个人资料中查看）"
                autoComplete="current-password"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              disabled={networkStatus !== "connected" || retryCooldown > 0}
              style={{ marginTop: 4 }}
            >
              {retryCooldown > 0 ? `请稍后 (${retryCooldown}s)` : "登录"}
            </Button>
          </Form>

          <div style={{ textAlign: "center", marginTop: 12 }}>
            <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
              支持用户名、邮箱、手机号登录
            </Text>
          </div>
        </>
      )}
    </div>
  );
}
