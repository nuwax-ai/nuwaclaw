/**
 * ClientPage - Dashboard page (Electron version)
 *
 * Adapted from the Tauri client. Replaces Rust invocations with
 * window.electronAPI IPC calls.
 *
 * Sections:
 *   1. Login status — user info, logout, start session
 *   2. Service status — agent / file-server / lanproxy with start/stop
 *   3. Dependency check — alert when deps are missing
 *   4. Quick action buttons — navigate to settings / deps / about
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Tag,
  Alert,
  Spin,
  message,
  Form,
  Input,
  Modal,
  Tooltip,
} from "antd";
import {
  UserOutlined,
  LockOutlined,
  GlobalOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  SettingOutlined,
  AppstoreOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { QRCodeSVG } from "qrcode.react";
import {
  loginAndRegister,
  logout,
  getCurrentAuth,
  syncConfigToServer,
} from "../../services/core/auth";
import type { ServiceItem } from "../../App";
import { buildRedirectUrl } from "../../services/utils/sessionUrl";
import { t } from "../../services/core/i18n";
import { resolveDepDisplayName } from "../../utils/dependencyI18n";
import styles from "../../styles/components/ClientPage.module.css";
import { FEATURES } from "@shared/featureFlags";

// ======================== Types =================
type TabKey =
  | "client"
  | "sessions"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about";

interface ClientPageProps {
  onNavigate?: (tab: TabKey) => void;
  services: ServiceItem[];
  servicesLoading: boolean;
  startingServices?: Set<string>;
  setStartingServices?: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRefreshServices: () => Promise<void>;
  /** 当 reg 成功或登录后由父组件递增，用于刷新账号状态（用户名等）以与 reg 返回一致 */
  authRefreshTrigger?: number;
  /** 登录/注销后通知父组件刷新顶部栏用户名等 */
  onAuthChange?: () => void;
  /** 登录流程启动服务前通知父组件标记（内存变量，不持久化） */
  onLoginStarted?: () => void;
}

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  domain: string | null;
  userId?: number;
}

// ======================== Component =================
function ClientPage({
  onNavigate,
  services,
  servicesLoading,
  startingServices,
  setStartingServices,
  onRefreshServices,
  authRefreshTrigger,
  onAuthChange,
  onLoginStarted,
}: ClientPageProps) {
  const getStartupServiceKeys = useCallback(async (): Promise<string[]> => {
    const keys = ["mcpProxy", "agent", "fileServer", "lanproxy"];
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) return keys;
    try {
      const guiEnabledRes = await window.electronAPI?.guiServer?.isEnabled();
      if (guiEnabledRes?.enabled) {
        keys.splice(3, 0, "guiServer");
      }
    } catch (e) {
      console.warn("[ClientPage] Failed to read GUI MCP enabled status:", e);
    }
    return keys;
  }, []);

  // ---------- Auth state ----------
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: false,
    username: null,
    domain: null,
  });
  const [authLoading, setAuthLoading] = useState(true);

  // ---------- Login form ----------
  const [loginDomain, setLoginDomain] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ---------- Services ----------
  const [stoppingServices, setStoppingServices] = useState<Set<string>>(
    new Set(),
  );
  const isAnyStarting = (startingServices?.size ?? 0) > 0;
  const isAnyStopping = stoppingServices.size > 0;
  const isAnyOperating = isAnyStarting || isAnyStopping;

  // ---------- Dependencies ----------
  const [missingDeps, setMissingDeps] = useState<
    { name: string; displayName: string }[]
  >([]);
  const [depsChecked, setDepsChecked] = useState(false);

  // ---------- QR Code ----------
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // 登录页“用户输入业务域名”的本地兜底缓存。
  // 用途：当 authState.domain 在短时间内尚未刷新，或被历史配置影响时，UI 仍优先展示用户最近一次明确输入/确认的业务域名。
  // 注意：该值仅用于渲染显示，不参与 reg/lanproxy 的服务端配置逻辑。
  const [displayDomainFallback, setDisplayDomainFallback] = useState("");

  // ======================== Auth =================
  const loadAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const auth = await getCurrentAuth();
      setAuthState({
        isLoggedIn: auth.isLoggedIn,
        username: auth.userInfo?.displayName || auth.username || null,
        domain: auth.userInfo?.currentDomain || null,
        userId: auth.userInfo?.id,
      });
      if (!auth.isLoggedIn) {
        // Pre-fill domain from step1 config
        const step1 = (await window.electronAPI?.settings.get(
          "step1_config",
        )) as { serverHost?: string } | null;
        if (step1?.serverHost) {
          setLoginDomain(step1.serverHost);
          // 未登录时，同步更新展示兜底，确保输入框默认域名可用于后续显示兜底。
          setDisplayDomainFallback(step1.serverHost);
        }
      } else {
        // 已登录时，优先使用认证状态中的业务域名作为展示兜底。
        // 这样在服务状态刷新或局部重载期间，域名显示更稳定，不会闪回到代理配置地址。
        setDisplayDomainFallback(auth.userInfo?.currentDomain || "");
      }
    } catch (error) {
      console.error("[ClientPage] loadAuth failed:", error);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!loginDomain) {
      message.warning(t("Claw.Client.domainRequired"));
      return;
    }
    if (!loginUsername) {
      message.warning(t("Claw.Client.accountRequired"));
      return;
    }
    if (!loginPassword) {
      message.warning(t("Claw.Client.codeRequired"));
      return;
    }

    setLoginLoading(true);
    try {
      // 记录用户本次明确输入的业务域名，作为登录成功后的展示兜底来源之一。
      // 说明：这里的域名语义是“业务访问域名”，与 reg 返回的 lanproxy serverHost 不是同一概念。
      setDisplayDomainFallback(loginDomain);
      await loginAndRegister(loginUsername, loginPassword, {
        domain: loginDomain,
      });
      setLoginPassword("");
      await loadAuth();
      // 通知父组件：服务由登录流程启动（内存变量，不持久化)
      onLoginStarted?.();

      // 1. 先调用 reg 接口，获取最新配置（serverHost/serverPort）
      try {
        await syncConfigToServer({ suppressToast: true });
      } catch (e) {
        console.error("[ClientPage] Reg sync failed after login:", e);
      }

      // 2. reg 返回后，step by step 启动服务
      // loginAndRegister 内部已调用 reg 接口并保存 serverHost/serverPort，无需再次调用
      // step by step 启动服务
      const startupServiceKeys = await getStartupServiceKeys();
      for (const key of startupServiceKeys) {
        await handleStartService(key, true);
      }

      // 通知父组件刷新顶部栏用户名/电脑名称
      onAuthChange?.();
      await onRefreshServices();
    } catch {
      // 错误提示由 loginAndRegister 内部统一展示，此处不再重复 toast
      setLoginPassword("");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    Modal.confirm({
      title: t("Claw.Client.logoutConfirm"),
      content: t("Claw.Client.logoutConfirmDetail"),
      okText: t("Claw.Client.logout"),
      cancelText: t("Claw.Client.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          // 停止所有运行中或处于 error 状态的服务（error 状态进程可能仍驻留）
          const toStop = services.filter((s) => s.running || !!s.error);
          for (const svc of toStop) {
            try {
              if (svc.key === "agent")
                await window.electronAPI?.agent.destroy();
              else if (svc.key === "fileServer")
                await window.electronAPI?.fileServer.stop();
              else if (svc.key === "lanproxy")
                await window.electronAPI?.lanproxy.stop();
              else if (svc.key === "mcpProxy")
                await window.electronAPI?.mcp.stop();
            } catch (e) {
              console.error(`[ClientPage] Failed to stop ${svc.label}:`, e);
            }
          }
          // computerServer 不在 services 列表中，需单独停止，避免进程残留导致端口冲突
          await window.electronAPI?.computerServer
            .stop()
            .catch((e: unknown) => {
              console.error("[ClientPage] Failed to stop computerServer:", e);
            });

          await logout();
          // 退出登录后，默认回填上一次“服务域名”到登录输入框，减少用户重复输入。
          // 回填优先级说明（从高到低）：
          // 1) displayDomainFallback：本页面内最近一次明确业务域名（用户输入/认证状态同步得到）；
          // 2) authState.domain：当前登录态里记录的业务域名；
          // 3) step1_config.serverHost：持久化配置兜底（首次进入或刷新后也可恢复）。
          // 说明：这里回填的是“业务域名”，仅用于登录输入体验，不改变 reg/lanproxy 的代理地址逻辑。
          const step1 = (await window.electronAPI?.settings.get(
            "step1_config",
          )) as { serverHost?: string } | null;
          const lastDomain =
            displayDomainFallback ||
            authState.domain ||
            step1?.serverHost ||
            "";
          setLoginDomain(lastDomain);
          setDisplayDomainFallback(lastDomain);

          setAuthState({ isLoggedIn: false, username: null, domain: null });
          onAuthChange?.();
        } catch {
          message.error(t("Claw.Client.logoutFailed"));
        }
      },
    });
  };

  const getRedirectUrl = useCallback(() => {
    if (!authState.domain || !authState.userId) return "";
    return buildRedirectUrl(authState.domain, authState.userId);
  }, [authState.domain, authState.userId]);

  const handleStartSession = async () => {
    // Navigate to the Sessions tab (embedded webview) instead of opening a new window
    onNavigate?.("sessions");
  };

  const handleShowQrCode = () => {
    const url = getRedirectUrl();
    if (!url) {
      message.warning(t("Claw.Client.getSessionUrlFailed"));
      return;
    }
    setQrModalVisible(true);
  };

  // 服务名称映射（i18n key）
  const serviceNameMap: Record<string, string> = {
    agent: "Claw.Service.agent",
    fileServer: "Claw.Service.file",
    guiServer: "Claw.Service.guiMcp",
    lanproxy: "Claw.Service.proxy",
    mcpProxy: "Claw.Service.mcp",
  };
  const getServiceLabel = (key: string) => t(serviceNameMap[key] || key);

  // ======================== Services =================
  const handleStartService = async (
    key: string,
    silent = false,
  ): Promise<boolean> => {
    setStartingServices?.((prev) => new Set(prev).add(key));
    try {
      let result: { success: boolean; error?: string } | undefined;

      if (key === "agent") {
        const agentConfig = (await window.electronAPI?.settings.get(
          "agent_config",
        )) as any;
        const step1 = (await window.electronAPI?.settings.get(
          "step1_config",
        )) as { workspaceDir?: string } | null;
        result = await window.electronAPI?.agent.init({
          engine: agentConfig?.type || "claude-code",
          apiKey: agentConfig?.apiKey,
          baseUrl: agentConfig?.apiBaseUrl,
          model: agentConfig?.model,
          workspaceDir: step1?.workspaceDir || "",
          port: agentConfig?.backendPort || undefined,
          engineBinaryPath: agentConfig?.binPath || undefined,
        });
        // ComputerServer 是 Agent 的 HTTP 接口，随 Agent 一起启动
        await window.electronAPI?.computerServer.start().catch(() => undefined);
      } else if (key === "fileServer") {
        const step1 = (await window.electronAPI?.settings.get(
          "step1_config",
        )) as { fileServerPort?: number } | null;
        result = await window.electronAPI?.fileServer.start(
          step1?.fileServerPort ?? 60000,
        );
      } else if (key === "lanproxy") {
        const clientKey = (await window.electronAPI?.settings.get(
          "auth.saved_key",
        )) as string | null;
        const lpConfig = (await window.electronAPI?.settings.get(
          "lanproxy_config",
        )) as {
          serverIp?: string;
          serverPort?: number;
          ssl?: boolean;
        } | null;
        const serverIp =
          lpConfig?.serverIp ||
          (
            (await window.electronAPI?.settings.get("lanproxy.server_host")) as
              | string
              | null
          )?.replace(/^https?:\/\//, "");
        const serverPort =
          lpConfig?.serverPort ||
          ((await window.electronAPI?.settings.get("lanproxy.server_port")) as
            | number
            | null);
        if (!serverIp || !clientKey || !serverPort) {
          if (!silent) message.info(t("Claw.Client.loginFirst"));
          await onRefreshServices();
          return false;
        }
        result = await window.electronAPI?.lanproxy.start({
          serverIp,
          serverPort,
          clientKey,
          ssl: lpConfig?.ssl,
        });
      } else if (key === "mcpProxy") {
        result = await window.electronAPI?.mcp.start();
      } else if (key === "guiServer") {
        const guiEnabledRes = await window.electronAPI?.guiServer?.isEnabled();
        if (!guiEnabledRes?.enabled) {
          await onRefreshServices();
          return false;
        }
        result = await window.electronAPI?.guiServer?.start();
      }

      await onRefreshServices();

      // 启动失败时直接展示错误信息
      if (result && !result.success) {
        const errorMsg = result.error || t("Claw.Client.startFailed");
        message.error(
          t("Claw.Client.serviceStartFailed", getServiceLabel(key), errorMsg),
        );
      }

      return result?.success ?? false;
    } catch (error) {
      console.error(`[ClientPage] Failed to start ${key}:`, error);
      message.error(
        t(
          "Claw.Client.serviceStartFailed",
          getServiceLabel(key),
          String(error),
        ),
      );
      await onRefreshServices();
      return false;
    } finally {
      setStartingServices?.((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  /**
   * 手动启动单个服务（UI 按钮触发）。
   * 手动启动不调用 reg 接口，直接启动服务。
   * reg 调用仅在「登录」「启动全部」「自动重连」场景触发。
   */
  const handleStartServiceManual = async (key: string) => {
    await handleStartService(key);
  };

  const handleStopService = async (key: string) => {
    console.log("[ClientPage] handleStopService called with key:", key);
    setStoppingServices((prev) => new Set(prev).add(key));
    try {
      if (key === "agent") {
        await window.electronAPI?.agent.destroy();
        await window.electronAPI?.computerServer.stop().catch(() => {});
      } else if (key === "fileServer")
        await window.electronAPI?.fileServer.stop();
      else if (key === "lanproxy") await window.electronAPI?.lanproxy.stop();
      else if (key === "mcpProxy") await window.electronAPI?.mcp.stop();
      else if (key === "guiServer") await window.electronAPI?.guiServer?.stop();
    } catch (error) {
      message.error(t("Claw.Client.stopFailed", String(error)));
    } finally {
      setStoppingServices((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      await onRefreshServices();
    }
  };

  const handleStartAll = async () => {
    // 未登录时禁止启动全部服务，避免 agent 无 apiKey / lanproxy 无 clientKey 的半启动状态
    if (!authState.isLoggedIn) {
      message.warning(t("Claw.Client.loginFirstToStart"));
      return;
    }
    if (missingDeps.length > 0) {
      message.warning(t("Claw.Client.missingDeps"));
      return;
    }

    // 确定需要启动的服务，提前设置 starting 状态（覆盖 reg 调用期间）
    const allServices = await getStartupServiceKeys();
    const servicesToStart = allServices.filter((key) => {
      const svc = services.find((s) => s.key === key);
      return svc && !svc.running;
    });

    // 提前设置所有待启动服务的 starting 状态
    if (servicesToStart.length > 0) {
      setStartingServices?.((prev) => {
        const next = new Set(prev);
        servicesToStart.forEach((key) => next.add(key));
        return next;
      });
    }

    try {
      let startedCount = 0;

      // 1. 先调用 reg 接口，获取最新配置（serverHost/serverPort）
      try {
        await syncConfigToServer({ suppressToast: true });
      } catch (e) {
        console.error("[ClientPage] Reg sync failed:", e);
      }

      // 2. reg 返回后，step by step 启动服务
      for (const key of servicesToStart) {
        await handleStartService(key);
        startedCount++;
      }

      if (startedCount === 0) {
        message.info(t("Claw.Client.allServicesRunning"));
      }
    } finally {
      await onRefreshServices();
    }
  };

  const handleStopAll = async () => {
    const toStop = services.filter((s) => s.running || !!s.error);
    setStoppingServices(new Set(toStop.map((s) => s.key)));
    try {
      for (const svc of toStop) {
        try {
          if (svc.key === "agent") await window.electronAPI?.agent.destroy();
          else if (svc.key === "fileServer")
            await window.electronAPI?.fileServer.stop();
          else if (svc.key === "lanproxy")
            await window.electronAPI?.lanproxy.stop();
          else if (svc.key === "mcpProxy") await window.electronAPI?.mcp.stop();
          else if (svc.key === "guiServer")
            await window.electronAPI?.guiServer?.stop();
        } catch (error) {
          console.error(`[ClientPage] Failed to stop ${svc.label}:`, error);
        }
      }
      await window.electronAPI?.computerServer.stop().catch(() => {});
    } finally {
      setStoppingServices(new Set());
      await onRefreshServices();
    }
  };

  // ======================== Dependencies =================
  const checkDependencies = useCallback(async () => {
    try {
      const result = await window.electronAPI?.dependencies.checkAll();
      const deps = result?.results || [];
      const syncInProgress = result?.syncInProgress ?? false;
      // 依赖同步进行中时不显示缺失提示（升级后正在自动安装新版本）
      if (syncInProgress) {
        setMissingDeps([]);
      } else {
        // 与 App.tsx 保持一致：outdated 视为"已安装"，不阻断服务启动
        // 仅 missing / error 才视为缺失依赖
        const missing = deps.filter(
          (d: any) =>
            d.required && (d.status === "missing" || d.status === "error"),
        );
        setMissingDeps(
          missing.map((d: any) => ({
            name: d.name,
            // 统一依赖名称的 i18n 兜底，避免后端返回 key/异常 key 直接显示到 UI
            displayName: resolveDepDisplayName({
              name: d.name,
              displayName: d.displayName,
            }),
          })),
        );
      }
    } catch (error) {
      console.error("[ClientPage] checkDependencies failed:", error);
    } finally {
      setDepsChecked(true);
    }
  }, []);

  // ======================== Lifecycle =================
  useEffect(() => {
    loadAuth();
    onRefreshServices();
    checkDependencies();

    // 监听依赖同步完成事件（客户端升级后自动安装新版本依赖），重新检测
    const handleDepsSyncCompleted = () => {
      checkDependencies();
    };
    window.electronAPI?.on(
      "deps:syncCompleted",
      handleDepsSyncCompleted as any,
    );
    return () => {
      window.electronAPI?.off(
        "deps:syncCompleted",
        handleDepsSyncCompleted as any,
      );
    };
  }, [loadAuth, onRefreshServices, checkDependencies]);

  // reg 成功或登录后父组件递增 authRefreshTrigger，刷新账号状态（用户名等）以与 reg 返回一致
  useEffect(() => {
    if (authRefreshTrigger != null && authRefreshTrigger > 0) {
      loadAuth();
    }
  }, [authRefreshTrigger, loadAuth]);

  // ======================== Render helpers =================
  const renderLoginSection = () => {
    if (authLoading) {
      return (
        <div className={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    if (authState.isLoggedIn) {
      const redirectUrl = getRedirectUrl();
      // 域名展示优先级：
      // 1) authState.domain：当前登录态中明确的业务域名（首选）；
      // 2) displayDomainFallback：用户最近输入或最近一次已知业务域名（兜底）；
      // 3) 空字符串：无可用信息时不展示。
      // 这样可避免在 reg 同步/状态切换瞬间，UI 被代理地址或空值“覆盖”导致的域名跳变。
      const displayDomain = authState.domain || displayDomainFallback || "";
      // 与 Tauri 一致：服务未全部启动时禁用「开始会话」「扫码使用」
      // 注意：guiServer 是可选服务，其启动失败不阻塞 Start Session
      const allServicesRunning =
        services.length > 0 &&
        services.filter((s) => s.key !== "guiServer").every((s) => s.running);
      const isButtonDisabled = !redirectUrl || !allServicesRunning;

      return (
        <div className={styles.sectionBody}>
          {/* 左右布局：左侧用户信息 + 右侧按钮 */}
          <div className={styles.loggedInContainer}>
            {/* 左侧：用户信息 */}
            <div className={styles.userInfo}>
              <CheckCircleOutlined
                style={{ color: "var(--color-success)", fontSize: 14 }}
              />
              <div className={styles.userInfoText}>
                <span className={styles.username}>
                  {authState.username || t("Claw.Client.defaultUser")}
                </span>
                <div className={styles.domain}>{displayDomain}</div>
              </div>
            </div>

            {/* 右侧：操作按钮（服务未全部启动时禁用，与 Tauri 行为一致） */}
            <div className={styles.actionButtons}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartSession}
                size="small"
                disabled={isButtonDisabled}
                title={
                  !allServicesRunning
                    ? t("Claw.Client.startAllServicesFirst")
                    : undefined
                }
              >
                {t("Claw.Client.startSession")}
              </Button>
              <Button
                icon={<QrcodeOutlined />}
                onClick={handleShowQrCode}
                size="small"
                disabled={isButtonDisabled}
                title={
                  !allServicesRunning
                    ? t("Claw.Client.startAllServicesFirst")
                    : undefined
                }
              >
                {t("Claw.Client.qrCode")}
              </Button>
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                size="small"
                danger
              >
                {t("Claw.Client.logout")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Not logged in — show login form
    return (
      <div className={styles.sectionBody}>
        <Form layout="vertical" size="small" onFinish={handleLogin}>
          <Form.Item style={{ marginBottom: 10 }}>
            <Input
              prefix={<GlobalOutlined />}
              value={loginDomain}
              onChange={(e) => setLoginDomain(e.target.value)}
              placeholder={t("Claw.Client.domainPlaceholder")}
              allowClear
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 10 }}>
            <Input
              prefix={<UserOutlined />}
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder={t("Claw.Client.usernamePlaceholder")}
              autoComplete="username"
              allowClear
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Input.Password
              prefix={<LockOutlined />}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder={t("Claw.Client.passwordPlaceholder")}
              autoComplete="current-password"
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loginLoading} block>
            {t("Claw.Client.login")}
          </Button>
        </Form>

        <div className={styles.loginHint}>
          <span className={styles.loginHintText}>
            {t("Claw.Client.loginHint")}
          </span>
        </div>
      </div>
    );
  };

  const renderServicesSection = () => {
    // 首次加载中
    if (servicesLoading && services.length === 0) {
      return (
        <div className={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    return (
      <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
        {/* 服务列表 */}
        {services.map((svc) => {
          const isStarting = startingServices?.has(svc.key);
          const isStopping = stoppingServices.has(svc.key);
          const hasError = !svc.running && !!svc.error;
          return (
            <div key={svc.key} className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                {isStarting || isStopping ? (
                  <LoadingOutlined
                    style={{ color: "var(--color-info)", fontSize: 14 }}
                  />
                ) : svc.running ? (
                  <CheckCircleOutlined
                    style={{ color: "var(--color-success)", fontSize: 14 }}
                  />
                ) : hasError ? (
                  <ExclamationCircleOutlined
                    style={{ color: "var(--color-error)", fontSize: 14 }}
                  />
                ) : (
                  <CloseCircleOutlined
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 14,
                    }}
                  />
                )}
                <div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span className={styles.serviceLabel}>{svc.label}</span>
                    {isStarting ? (
                      <Tag
                        color="processing"
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {t("Claw.Client.starting")}
                      </Tag>
                    ) : isStopping ? (
                      <Tag
                        color="processing"
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {t("Claw.Client.stopping")}
                      </Tag>
                    ) : svc.running ? (
                      <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
                        {t("Claw.Client.running")}
                      </Tag>
                    ) : hasError ? (
                      <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
                        {t("Claw.Client.startFailed")}
                      </Tag>
                    ) : (
                      <Tag style={{ margin: 0, fontSize: 11 }}>
                        {t("Claw.Client.stopped")}
                      </Tag>
                    )}
                  </div>
                  <div className={styles.serviceDescription}>
                    {hasError ? (
                      <Tooltip title={svc.error}>
                        <span
                          style={{
                            color: "var(--color-error)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                        >
                          {svc.error}
                        </span>
                      </Tooltip>
                    ) : (
                      svc.description
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.serviceActions}>
                {isStarting ? (
                  <Button size="small" disabled loading>
                    {t("Claw.Client.starting")}
                  </Button>
                ) : isStopping ? (
                  <Button size="small" disabled loading>
                    {t("Claw.Client.stopping")}
                  </Button>
                ) : svc.running ? (
                  <Button
                    size="small"
                    danger
                    className={styles.dangerButton}
                    icon={<PoweroffOutlined />}
                    onClick={() => handleStopService(svc.key)}
                    disabled={isAnyOperating}
                  >
                    {t("Claw.Client.stop")}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleStartServiceManual(svc.key)}
                    disabled={isAnyOperating}
                  >
                    {t("Claw.Client.start")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDependencyAlert = () => {
    if (!depsChecked || missingDeps.length === 0) return null;

    const allStopped = services.length > 0 && services.every((s) => !s.running);

    return (
      <Alert
        message={t("Claw.Client.missingDepsCannotStart")}
        description={
          <div>
            <div style={{ marginBottom: 8 }}>
              {missingDeps.map((dep) => (
                <Tag
                  key={dep.name}
                  color="error"
                  style={{ marginBottom: 4, marginRight: 4 }}
                >
                  {dep.displayName}
                </Tag>
              ))}
            </div>
            <Button
              size="small"
              type="primary"
              onClick={() => onNavigate?.("dependencies")}
            >
              {t("Claw.Client.goInstall")}
            </Button>
          </div>
        }
        type={allStopped ? "error" : "warning"}
        showIcon
        className={styles.dependencyAlert}
        icon={<ExclamationCircleOutlined />}
      />
    );
  };

  const renderQuickActions = () => {
    return (
      <div className={styles.sectionBody}>
        <div className={styles.quickActions}>
          <Button
            icon={<SettingOutlined />}
            onClick={() => onNavigate?.("settings")}
            size="small"
          >
            {t("Claw.Client.settings")}
          </Button>
          <Button
            icon={<AppstoreOutlined />}
            onClick={() => onNavigate?.("dependencies")}
            size="small"
          >
            {t("Claw.Client.dependencies")}
          </Button>
          <Button
            icon={<InfoCircleOutlined />}
            onClick={() => onNavigate?.("about")}
            size="small"
          >
            {t("Claw.Client.about")}
          </Button>
        </div>
      </div>
    );
  };

  // ======================== Main render =================
  return (
    <div className={styles.page}>
      {/* Dependency alert */}
      {renderDependencyAlert()}

      {/* Login status */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <UserOutlined
            style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
          />
          <span className={styles.sectionTitle}>
            {t("Claw.Client.accountStatus")}
          </span>
        </div>
        {renderLoginSection()}
      </div>

      {/* Service status */}
      <div className={styles.section} style={{ position: "relative" }}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <PlayCircleOutlined
              style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
            />
            <span className={styles.sectionTitle}>
              {t("Claw.Client.services")}
            </span>
            {!servicesLoading &&
              (() => {
                const runningCount = services.filter((s) => s.running).length;
                const totalCount = services.length;
                const hasErrors = services.some((s) => !!s.error);
                const badgeColor = hasErrors
                  ? "error"
                  : runningCount === totalCount
                    ? "success"
                    : runningCount === 0
                      ? "default"
                      : "warning";
                return (
                  <Tag color={badgeColor} style={{ margin: 0, fontSize: 11 }}>
                    {runningCount}/{totalCount}
                  </Tag>
                );
              })()}
          </div>
          {!servicesLoading && (
            <div className={styles.servicesHeaderActions}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => onRefreshServices()}
              >
                {t("Claw.Client.refresh")}
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartAll}
                loading={isAnyStarting}
                disabled={
                  !depsChecked ||
                  missingDeps.length > 0 ||
                  services.every((s) => s.running) ||
                  isAnyStopping
                }
              >
                {t("Claw.Client.startAll")}
              </Button>
              <Button
                size="small"
                danger
                className={styles.dangerButton}
                icon={<PoweroffOutlined />}
                onClick={handleStopAll}
                loading={isAnyStopping}
                disabled={
                  services.every((s) => !s.running && !s.error) || isAnyStarting
                }
              >
                {t("Claw.Client.stopAll")}
              </Button>
            </div>
          )}
        </div>
        {renderServicesSection()}
      </div>

      {/* Quick actions */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <AppstoreOutlined
            style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
          />
          <span className={styles.sectionTitle}>
            {t("Claw.Client.quickActions")}
          </span>
        </div>
        {renderQuickActions()}
      </div>

      {/* QR code modal - always available */}
      <Modal
        title={t("Claw.Client.qrCode")}
        open={qrModalVisible}
        onCancel={() => setQrModalVisible(false)}
        footer={null}
        centered
        width={320}
      >
        <div className={styles.qrCodeContainer}>
          {(() => {
            const url = getRedirectUrl();
            return url && <QRCodeSVG value={url} size={200} />;
          })()}
        </div>
      </Modal>
    </div>
  );
}

export default ClientPage;
