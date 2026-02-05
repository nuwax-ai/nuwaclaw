/**
 * 初始化向导 - 步骤2: 账号登录
 *
 * 功能:
 * - 检查网络连接
 * - 用户账号登录
 * - 登录成功后进入下一步
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
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
} from "antd";
import {
  UserOutlined,
  LockOutlined,
  CheckCircleOutlined,
  WifiOutlined,
  DisconnectOutlined,
  ReloadOutlined,
  LeftOutlined,
} from "@ant-design/icons";
import {
  loginAndRegister,
  getCurrentAuth,
  initAuthStore,
  getAuthErrorMessage,
  getSavedUsername,
} from "../services/auth";
import { completeStep2 } from "../services/setup";

const { Title, Text } = Typography;

interface SetupStep2Props {
  /** 完成回调 */
  onComplete: () => void;
  /** 返回上一步回调 */
  onBack?: () => void;
}

// 网络连接状态
type NetworkStatus = "checking" | "connected" | "disconnected";

/**
 * 步骤2: 账号登录组件
 */
export default function SetupStep2({ onComplete, onBack }: SetupStep2Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("checking");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [statusHint, setStatusHint] = useState<string>("");
  const [statusType, setStatusType] = useState<"info" | "error">("info");
  const continueButtonRef = useRef<HTMLButtonElement | null>(null);
  const [loginError, setLoginError] = useState<string>("");
  const [retryCooldown, setRetryCooldown] = useState(0);
  const [copiedError, setCopiedError] = useState(false);

  /**
   * 检查网络连接（通过 navigator.onLine 和尝试 fetch）
   */
  const showStatus = (text: string, type: "info" | "error" = "info") => {
    setStatusHint(text);
    setStatusType(type);
    setTimeout(() => setStatusHint(""), 1500);
  };

  const checkNetworkConnection = useCallback(async () => {
    setNetworkStatus("checking");
    showStatus("正在检查网络连接...");

    // 首先检查 navigator.onLine
    if (!navigator.onLine) {
      setNetworkStatus("disconnected");
      showStatus("网络连接不可用", "error");
      return;
    }

    // 尝试发起一个简单的网络请求来确认连接
    try {
      // 尝试访问一个可靠的端点（可以是你的服务器）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch("https://nvwa-api.xspaceagi.com/health", {
        method: "HEAD",
        mode: "no-cors",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      setNetworkStatus("connected");
      showStatus("网络连接正常");
    } catch (error) {
      console.warn("[SetupStep2] 网络连接检测:", error);
      // 即使 fetch 失败，如果 navigator.onLine 为 true，也假设网络可用
      // 因为 no-cors 模式下可能会有各种原因导致失败
      setNetworkStatus("connected");
      showStatus("网络连接正常");
    }
  }, []);

  /**
   * 检查登录状态
   */
  const checkLoginStatus = useCallback(async () => {
    setCheckingAuth(true);
    showStatus("正在检查登录状态...");
    try {
      await initAuthStore();
      const savedUsername = await getSavedUsername();
      if (savedUsername) {
        form.setFieldValue("username", savedUsername);
      }
      const auth = await getCurrentAuth();
      if (auth.isLoggedIn) {
        setIsLoggedIn(true);
        showStatus("已登录");
      }
    } catch (error) {
      console.error("[SetupStep2] 检查登录状态失败:", error);
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

  useEffect(() => {
    if (isLoggedIn) {
      setTimeout(() => {
        continueButtonRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 100);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (retryCooldown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setRetryCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryCooldown]);

  /**
   * 重新检查网络连接
   */
  const handleRetryNetworkCheck = async () => {
    await checkNetworkConnection();
  };

  /**
   * 提交登录表单
   */
  const handleSubmit = async (values: {
    username: string;
    password: string;
  }) => {
    setLoading(true);
    setLoginError("");
    showStatus("正在登录...");
    try {
      await loginAndRegister(values.username, values.password, {
        suppressToast: true,
      });
      showStatus("登录成功");
      setLoginError("");

      // 登录成功后自动进入下一步
      await completeStep2();
      onComplete();
    } catch (error) {
      // 错误已在 auth.ts 中处理
      console.error("[SetupStep2] 登录失败:", error);
      setLoading(false);
      const errorMessage = getAuthErrorMessage(error);
      message.error(errorMessage);
      showStatus(errorMessage, "error");
      setLoginError(errorMessage);
      form.setFieldsValue({ password: "" });
      setRetryCooldown(3);
    }
  };

  const handleCopyError = async () => {
    if (!loginError) {
      return;
    }
    try {
      await navigator.clipboard.writeText(loginError);
      setCopiedError(true);
      showStatus("已复制错误详情");
      setTimeout(() => setCopiedError(false), 1500);
    } catch {
      showStatus("复制失败，请手动选择", "error");
    }
  };

  /**
   * 继续下一步（已登录状态下点击按钮）
   */
  const handleContinue = async () => {
    try {
      showStatus("正在进入下一步...");
      await completeStep2();
      onComplete();
    } catch (error) {
      console.error("[SetupStep2] 保存进度失败:", error);
      // 即使保存失败也继续
      onComplete();
    }
  };

  /**
   * 渲染网络连接状态
   */
  const renderNetworkCheck = () => {
    if (networkStatus === "checking") {
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

    if (networkStatus === "disconnected") {
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
      <div className="network-compact">
        <Space size={6}>
          <WifiOutlined />
          <Text type="secondary">网络连接正常</Text>
        </Space>
      </div>
    );
  };

  /**
   * 渲染登录成功状态
   */
  const renderLoggedIn = () => (
    <div className="logged-in-compact">
      <Result
        icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
        title="登录成功"
        subTitle="您已成功登录，可以继续下一步"
        extra={
          <Button
            ref={continueButtonRef}
            type="primary"
            size="middle"
            onClick={handleContinue}
          >
            下一步
          </Button>
        }
      />
    </div>
  );

  /**
   * 渲染登录表单
   */
  const renderLoginForm = () => (
    <Form
      form={form}
      layout="vertical"
      size="middle"
      onFinish={handleSubmit}
      initialValues={{ username: "", password: "" }}
    >
      <Form.Item
        name="username"
        label="账号"
        rules={[{ required: true, message: "请输入账号" }]}
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
        rules={[{ required: true, message: "请输入密码" }]}
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
          disabled={networkStatus !== "connected" || retryCooldown > 0}
        >
          {retryCooldown > 0 ? `请稍后 (${retryCooldown}s)` : "登录"}
        </Button>
      </Form.Item>

      <div style={{ textAlign: "center", marginTop: 16 }}>
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
        <Space align="center" style={{ marginBottom: 4 }}>
          {onBack && (
            <Button
              type="text"
              size="small"
              icon={<LeftOutlined />}
              onClick={onBack}
              style={{ marginRight: 4 }}
            >
              上一步
            </Button>
          )}
          <Title level={4} style={{ margin: 0 }}>
            <UserOutlined style={{ marginRight: 8 }} />
            账号登录
          </Title>
        </Space>
        <Text type="secondary">登录您的 NuWax 账号以使用完整功能</Text>
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

      {loginError && (
        <Alert
          message="登录失败"
          description={
            <Text copyable={{ text: loginError }} type="secondary">
              {loginError}
            </Text>
          }
          type="error"
          showIcon
          action={
            <Button size="small" onClick={handleCopyError}>
              {copiedError ? "已复制" : "复制详情"}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

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

        .setup-step2 .ant-form-item-label > label {
          font-size: 12px;
        }

        .setup-step2 .ant-form-item-label {
          padding-bottom: 4px;
        }

        .setup-step2 .step-hint {
          margin-bottom: 12px;
          padding: 6px 10px;
          font-size: 12px;
        }

        .setup-step2 .network-compact {
          margin-bottom: 10px;
          padding: 6px 8px;
          background: #f6ffed;
          border-radius: 6px;
          font-size: 12px;
        }

        .setup-step2 .logged-in-compact .ant-result {
          padding: 8px 0 0;
        }

        .setup-step2 .logged-in-compact .ant-result-title {
          font-size: 16px;
        }

        .setup-step2 .logged-in-compact .ant-result-subtitle {
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
