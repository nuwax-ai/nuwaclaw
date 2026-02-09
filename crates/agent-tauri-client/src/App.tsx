/**
 * NuWax Agent 主应用入口
 *
 * 职责：
 * - 初始化向导状态管理
 * - Tab 导航切换
 * - 布局结构
 * - 状态管理和事件监听
 */

import React, { useState, useEffect, useCallback } from "react";
import { Badge, Menu, Spin, message } from "antd";
import {
  RobotOutlined,
  FileTextOutlined,
  SettingOutlined,
  DashboardOutlined,
  SafetyOutlined,
  FolderOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import {
  AgentStatus,
  LogEntry,
  startAgent,
  stopAgent,
  getConnectionInfo,
  onStatusChange,
  onLogChange,
  getOnlineStatus,
} from "./services";
import SetupWizard from "./components/SetupWizard";
import LogViewerWithBackend from "./components/LogViewerWithBackend";
import {
  ClientPage,
  SettingsPage,
  DependenciesPage,
  PermissionsPage,
  AboutPage,
} from "./pages";
import { initConfigStore } from "./services/config";
import {
  initAuthStore,
  getSavedKey,
  syncConfigToServer,
} from "./services/auth";
import { isSetupCompleted } from "./services/setup";
import { restartAllServices } from "./services/dependencies";

// Tab 类型定义
type TabType =
  | "client"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about";

/**
 * 主应用组件
 */
function App() {
  // ============================================
  // 初始化向导状态
  // ============================================
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);

  // ============================================
  // 核心状态
  // ============================================
  const [activeTab, setActiveTab] = useState<TabType>("client");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [sessionId, setSessionId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [storeInitialized, setStoreInitialized] = useState(false);

  // 连接信息
  const [connectionInfo, setConnectionInfo] = useState<{
    id: string;
    server: string;
  }>({
    id: "",
    server: "",
  });

  // ============================================
  // CLI 启动参数监听
  // 用于接收来自 Rust 后端的导航事件
  // ============================================
  useEffect(() => {
    // 预定义合法的 Tab 名称列表
    const VALID_TABS: TabType[] = [
      "client",
      "settings",
      "dependencies",
      "permissions",
      "logs",
      "about",
    ];

    let unlisten: (() => void) | undefined;

    const setupNavigationListener = async () => {
      try {
        unlisten = await listen<string>("navigate-to-tab", (event) => {
          const targetTab = event.payload as TabType;

          // 验证 Tab 名称是否合法
          if (VALID_TABS.includes(targetTab)) {
            console.log(`[App] 收到导航事件: ${targetTab}`);
            setActiveTab(targetTab);
            message.info(`正在跳转到「${targetTab}」页面`);
          } else {
            console.warn(`[App] 收到无效的 Tab 参数: ${targetTab}`);
          }
        });
        console.log("[App] 导航事件监听已注册");
      } catch (error) {
        console.error("[App] 注册导航事件监听失败:", error);
      }
    };

    setupNavigationListener();

    // 清理函数
    return () => {
      if (unlisten) {
        unlisten();
        console.log("[App] 导航事件监听已移除");
      }
    };
  }, []);

  // ============================================
  // 检查初始化向导状态
  // ============================================
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const completed = await isSetupCompleted();
        setSetupCompleted(completed);
      } catch (error) {
        console.error("检查初始化状态失败:", error);
        // 如果检查失败，假设已完成（避免阻塞用户）
        setSetupCompleted(true);
      }
    };
    checkSetup();
  }, []);

  // ============================================
  // 初始化存储服务（仅在初始化向导完成后执行）
  // ============================================
  useEffect(() => {
    // 只有在初始化向导完成后才加载主界面数据
    if (setupCompleted !== true) {
      return;
    }

    const init = async () => {
      try {
        // 初始化认证存储
        await initAuthStore();
        // 初始化配置存储
        await initConfigStore();
        // 加载在线状态
        const status = await getOnlineStatus();
        setOnlineStatus(status);
        setStoreInitialized(true);
      } catch (error) {
        console.error("初始化存储服务失败:", error);
        // 即使失败也标记为已初始化，使用默认配置
        setStoreInitialized(true);
      }
    };
    init();
  }, [setupCompleted]);

  // ============================================
  // 自动重连：应用重新打开时，如有 savedKey 则自动调用 reg 并启动服务
  // ============================================
  useEffect(() => {
    // 必须在初始化完成且 store 已初始化后才执行
    if (setupCompleted !== true || !storeInitialized) {
      return;
    }

    const autoReconnect = async () => {
      try {
        const savedKey = await getSavedKey();
        if (savedKey) {
          console.log("[App] 检测到 savedKey，自动重连...");
          // 调用 reg 接口（传入 savedKey）
          const result = await syncConfigToServer();
          if (result) {
            console.log("[App] 重连成功，启动服务...");
            await restartAllServices();
            // 更新在线状态
            setOnlineStatus(result.online);
            message.success("服务已自动启动");
          }
        } else {
          console.log("[App] 未检测到 savedKey，跳过自动重连");
        }
      } catch (error) {
        console.error("[App] 自动重连失败:", error);
        // 自动重连失败不阻塞用户使用，仅记录错误
      }
    };

    autoReconnect();
  }, [setupCompleted, storeInitialized]);

  // ============================================
  // 权限状态轮询机制
  // ============================================
  // 用于自动检测权限状态变化，当用户打开系统设置完成授权后返回应用时自动更新
  const [permissionPollingEnabled, setPermissionPollingEnabled] =
    useState(false);
  const [lastPermissionStatus, setLastPermissionStatus] = useState<
    Map<string, string>
  >(new Map());

  // 轮询间隔（毫秒）
  const POLLING_INTERVAL = 3000;

  // 权限变化检测函数
  const checkPermissionChanges = useCallback(async () => {
    try {
      // 导入权限检查函数
      const { checkAllPermissions } = await import("./services/permissions");

      // 获取当前权限状态
      const permissionsState = await checkAllPermissions();
      const currentPermissions = permissionsState.items;

      // 检查是否有权限状态变化
      let hasChanges = false;

      for (const perm of currentPermissions) {
        const lastStatus = lastPermissionStatus.get(perm.id);
        if (lastStatus !== perm.status) {
          console.log(
            `[App] 权限状态变化: ${perm.id} ${lastStatus || "unknown"} -> ${perm.status}`,
          );
          hasChanges = true;
          lastPermissionStatus.set(perm.id, perm.status);
        }
      }

      // 如果有权限变化且有必需的权限从 denied/pending 变为 granted，提示用户
      if (hasChanges) {
        const newlyGranted = currentPermissions.filter(
          (p) =>
            p.required &&
            p.status === "granted" &&
            lastPermissionStatus.get(p.id) !== "granted",
        );

        if (newlyGranted.length > 0) {
          message.success(
            `权限已更新: ${newlyGranted.map((p) => p.displayName).join(", ")}`,
          );
        }

        // 更新状态
        setLastPermissionStatus(new Map(lastPermissionStatus));
      }

      return hasChanges;
    } catch (error) {
      console.error("[App] 权限状态检查失败:", error);
      return false;
    }
  }, [lastPermissionStatus]);

  // 启动权限轮询
  const startPermissionPolling = useCallback(() => {
    console.log("[App] 启动权限状态轮询");
    setPermissionPollingEnabled(true);
  }, []);

  // 停止权限轮询
  const stopPermissionPolling = useCallback(() => {
    console.log("[App] 停止权限状态轮询");
    setPermissionPollingEnabled(false);
  }, []);

  // 轮询 effect：应用激活时定期检查权限状态
  useEffect(() => {
    // 只有在启用轮询时才执行
    if (!permissionPollingEnabled || setupCompleted !== true) {
      return;
    }

    console.log("[App] 权限轮询已启动");

    // 立即执行一次检查
    checkPermissionChanges();

    // 设置定时器
    const intervalId = setInterval(() => {
      checkPermissionChanges();
    }, POLLING_INTERVAL);

    // 清理函数
    return () => {
      clearInterval(intervalId);
      console.log("[App] 权限轮询已停止");
    };
  }, [permissionPollingEnabled, setupCompleted, checkPermissionChanges]);

  // 监听应用焦点事件：失焦时停止轮询，聚焦时启动轮询
  useEffect(() => {
    const unlistenFocus = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      return listen("tauri://focus", () => {
        console.log("[App] 应用获得焦点");
        // 聚焦时执行一次权限检查
        if (permissionPollingEnabled) {
          checkPermissionChanges();
        }
      });
    };

    const unlistenBlur = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      return listen("tauri://blur", () => {
        console.log("[App] 应用失去焦点");
        // 失焦时可以停止轮询以节省资源（可选）
        // stopPermissionPolling();
      });
    };

    let focusUnlisten: (() => void) | undefined;
    let blurUnlisten: (() => void) | undefined;

    unlistenFocus().then((unlisten) => {
      focusUnlisten = unlisten;
    });

    unlistenBlur().then((unlisten) => {
      blurUnlisten = unlisten;
    });

    return () => {
      if (focusUnlisten) focusUnlisten();
      if (blurUnlisten) blurUnlisten();
    };
  }, [permissionPollingEnabled, checkPermissionChanges]);

  // ============================================
  // 状态监听
  // ============================================
  useEffect(() => {
    // 订阅状态变化
    onStatusChange((newStatus: AgentStatus) => {
      setStatus(newStatus);
      if (newStatus === "running") {
        setIsConnected(true);
      } else if (newStatus === "stopped" || newStatus === "error") {
        setIsConnected(false);
      }
    });

    // 订阅日志变化
    onLogChange((newLog: LogEntry) => {
      setLogs((prev) => [...prev, newLog]);
    });
  }, []);

  // ============================================
  // 连接信息更新
  // ============================================
  useEffect(() => {
    if (status === "running") {
      const info = getConnectionInfo();
      setConnectionInfo({ id: info.id, server: info.server });
    } else {
      setConnectionInfo({ id: "", server: "" });
    }
  }, [status]);

  // ============================================
  // Agent 控制方法
  // ============================================
  const handleStart = async () => {
    setLoading(true);
    try {
      const success = await startAgent();
      if (success) {
        // 状态会通过 onStatusChange 回调更新
        // 获取连接信息中的 session id
        const info = getConnectionInfo();
        setSessionId(info.id || "");
        message.success("Agent 启动成功");
      } else {
        message.error("启动失败");
      }
    } catch (error) {
      message.error("启动失败");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopAgent();
      setStatus("stopped");
      message.success("Agent 已停止");
    } catch (error) {
      message.error("停止失败");
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 状态徽章配置
  // ============================================
  const getBadgeConfig = () => {
    const config: Record<
      AgentStatus,
      {
        status: "success" | "processing" | "error" | "default" | "warning";
        text: string;
      }
    > = {
      idle: { status: "default", text: "就绪" },
      starting: { status: "processing", text: "启动中" },
      running: { status: "success", text: "运行中" },
      busy: { status: "warning", text: "繁忙" },
      stopped: { status: "default", text: "已停止" },
      error: { status: "error", text: "错误" },
    };
    return config[status] || config.idle;
  };

  const badge = getBadgeConfig();

  // ============================================
  // 菜单配置
  // ============================================
  const menuItems = [
    { key: "client", icon: <DashboardOutlined />, label: "客户端" },
    { key: "settings", icon: <SettingOutlined />, label: "设置" },
    { key: "dependencies", icon: <FolderOutlined />, label: "依赖" },
    { key: "permissions", icon: <SafetyOutlined />, label: "权限" },
    { key: "logs", icon: <FileTextOutlined />, label: "日志" },
    { key: "about", icon: <InfoCircleOutlined />, label: "关于" },
  ];

  // ============================================
  // 渲染：加载中
  // ============================================
  if (setupCompleted === null) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <div style={{ marginTop: 16, color: "#71717a", fontSize: 13 }}>
          正在加载...
        </div>
      </div>
    );
  }

  // ============================================
  // 渲染：初始化向导
  // ============================================
  if (!setupCompleted) {
    return <SetupWizard onComplete={() => setSetupCompleted(true)} />;
  }

  // ============================================
  // 渲染：主界面
  // ============================================
  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <div className="app-header">
        <div className="app-header-logo">
          <RobotOutlined style={{ fontSize: 16, color: "#18181b" }} />
          <span className="app-header-title">NuWax Agent</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Badge
            status={badge.status}
            text={
              <span style={{ color: "#52525b", fontSize: 12 }}>
                {badge.text}
              </span>
            }
          />
        </div>
      </div>

      {/* 主体部分 */}
      <div className="app-body">
        {/* 左侧边栏 - 浅色简洁 */}
        <div className="app-sider">
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              onClick: () => setActiveTab(item.key as TabType),
            }))}
          />
        </div>

        {/* 主内容区 */}
        <div className="app-content">
          {activeTab === "client" && (
            <ClientPage
              status={status}
              sessionId={sessionId}
              onlineStatus={onlineStatus}
              logs={logs}
              connectionInfo={connectionInfo}
              badge={badge}
              loading={loading}
              onStart={handleStart}
              onStop={handleStop}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === "settings" && <SettingsPage />}
          {activeTab === "dependencies" && <DependenciesPage />}
          {activeTab === "permissions" && <PermissionsPage />}
          {activeTab === "logs" && (
            <LogViewerWithBackend
              showSource={true}
              enableRealtime={true}
              autoScrollDefault={true}
            />
          )}
          {activeTab === "about" && <AboutPage />}
        </div>
      </div>
    </div>
  );
}

export default App;
