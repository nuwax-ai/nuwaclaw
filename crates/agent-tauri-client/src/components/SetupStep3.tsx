/**
 * 初始化向导 - 步骤3: 依赖安装
 *
 * 功能:
 * - 检测 Node.js 版本 (>= 22.0.0) - 需要用户手动安装
 * - 自动安装 uv、mcp-proxy (shell-installer)
 * - 自动安装本地 npm 包
 * - 显示完整依赖列表和安装进度
 * - 所有依赖就绪后自动跳转到客户端页面
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Typography,
  Divider,
  Button,
  Space,
  Progress,
  List,
  Tag,
  Alert,
  Spin,
  Result,
  message,
  Card,
} from "antd";
import {
  CloudDownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  FolderOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  LeftOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkNodeVersion,
  checkAllSetupDependencies,
  getAppDataDir,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  checkShellInstallerPackage,
  installShellInstallerPackage,
  checkGlobalNpmPackage,
  installGlobalNpmPackage,
  type LocalDependencyItem,
  type NodeVersionResult,
} from "../services/dependencies";
import {
  getDepsFilter,
  setDepsFilter,
  getDepsShowAll,
  setDepsShowAll,
} from "../services/setup";

const { Title, Text } = Typography;

interface SetupStep3Props {
  /** 完成回调 */
  onComplete: () => void;
  /** 返回上一步回调 */
  onBack?: () => void;
}

// 安装阶段
type InstallPhase =
  | "checking"
  | "system-deps-missing"
  | "ready"
  | "installing"
  | "completed"
  | "error";

// 统一的依赖项接口（用于完整列表展示）
interface UnifiedDependencyItem {
  name: string;
  displayName: string;
  type: "system" | "npm-local" | "npm-global" | "shell-installer";
  description: string;
  status:
    | "checking"
    | "installed"
    | "missing"
    | "outdated"
    | "installing"
    | "error";
  version?: string;
  requiredVersion?: string;
  errorMessage?: string;
  installUrl?: string;
  installCommand?: string;
  // shell-installer 专用
  binName?: string;
  installerUrl?: string;
}

/**
 * 步骤3: 依赖安装组件
 */
export default function SetupStep3({ onComplete, onBack }: SetupStep3Props) {
  // 统一的依赖列表（系统依赖 + 可自动安装依赖）
  const [allDependencies, setAllDependencies] = useState<
    UnifiedDependencyItem[]
  >([]);

  // Node.js 状态（用于逻辑判断，唯一需要手动安装的系统依赖）
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);

  // 可安装依赖状态（shell-installer + npm-local）
  const [installableDependencies, setInstallableDependencies] = useState<
    LocalDependencyItem[]
  >([]);

  // 安装阶段
  const [installPhase, setInstallPhase] = useState<InstallPhase>("checking");
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>("");
  const [installError, setInstallError] = useState<string>("");

  // 应用目录
  const [appDir, setAppDir] = useState<string>("");
  const [showAllDependencies, setShowAllDependencies] = useState(false);
  const [depFilter, setDepFilter] = useState<
    "all" | "system" | "npm-local" | "shell-installer"
  >("all");
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * 构建统一的依赖列表
   * 直接使用 checkAllSetupDependencies 返回的结果
   */
  const buildUnifiedDependencies = useCallback(
    (deps: LocalDependencyItem[]): UnifiedDependencyItem[] => {
      return deps.map((dep) => ({
        name: dep.name,
        displayName: dep.displayName,
        type: dep.type as
          | "system"
          | "npm-local"
          | "npm-global"
          | "shell-installer",
        description: dep.description,
        status: dep.status as UnifiedDependencyItem["status"],
        version: dep.version,
        requiredVersion: dep.minVersion ? `>= ${dep.minVersion}` : undefined,
        errorMessage: dep.errorMessage,
        installUrl: dep.installUrl,
        binName: dep.binName,
        installerUrl: dep.installerUrl,
      }));
    },
    [],
  );

  /**
   * 检测所有依赖
   * 只有 nodejs 是需要手动安装的系统依赖
   * uv、mcp-proxy、npm包 都可以自动安装
   */
  const checkAllDeps = useCallback(async () => {
    setInstallPhase("checking");

    try {
      // 获取所有依赖状态
      const deps = await checkAllSetupDependencies();

      // 构建统一列表
      const unified = buildUnifiedDependencies(deps);
      setAllDependencies(unified);

      // 获取 Node.js 状态（唯一需要手动安装的系统依赖）
      const nodeDep = deps.find((d) => d.name === "nodejs");
      const nodeReady = nodeDep?.status === "installed";

      if (nodeDep) {
        setNodeResult({
          installed: nodeDep.status !== "missing",
          version: nodeDep.version,
          meetsRequirement: nodeDep.status === "installed",
        });
      }

      // 获取可自动安装的依赖（shell-installer + npm-local + npm-global）
      const installableDeps = deps.filter(
        (d) =>
          d.type === "npm-local" ||
          d.type === "npm-global" ||
          d.type === "shell-installer",
      );
      setInstallableDependencies(installableDeps);

      // 判断 Node.js 是否满足（唯一需要手动安装的依赖）
      if (!nodeReady) {
        setInstallPhase("system-deps-missing");
        return;
      }

      // 检查所有依赖是否已就绪
      const allReady = unified.every((d) => d.status === "installed");
      if (allReady) {
        // 所有依赖都已安装，直接完成
        setInstallPhase("completed");
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setInstallPhase("ready");
      }
    } catch (error) {
      console.error("[SetupStep3] 检测依赖失败:", error);
      setInstallPhase("error");
      setInstallError("检测依赖状态失败");
    }
  }, [buildUnifiedDependencies, onComplete]);

  /**
   * 获取应用目录
   */
  const loadAppDir = useCallback(async () => {
    try {
      const dir = await getAppDataDir();
      setAppDir(dir);
    } catch (error) {
      console.error("[SetupStep3] 获取应用目录失败:", error);
    }
  }, []);

  /**
   * 初始化
   */
  useEffect(() => {
    loadAppDir();
    checkAllDeps();
  }, [checkAllDeps, loadAppDir]);

  useEffect(() => {
    const loadPrefs = async () => {
      const savedFilter = await getDepsFilter();
      const savedShowAll = await getDepsShowAll();
      if (
        savedFilter === "all" ||
        savedFilter === "system" ||
        savedFilter === "npm-local"
      ) {
        setDepFilter(savedFilter);
      }
      if (typeof savedShowAll === "boolean") {
        setShowAllDependencies(savedShowAll);
      }
    };
    loadPrefs();
  }, []);

  useEffect(() => {
    setDepsFilter(depFilter);
  }, [depFilter]);

  useEffect(() => {
    setDepsShowAll(showAllDependencies);
  }, [showAllDependencies]);

  /**
   * 打开 Node.js 官网
   */
  const handleOpenNodejs = async () => {
    try {
      await openUrl("https://nodejs.org");
    } catch (error) {
      console.error("[SetupStep3] 打开链接失败:", error);
      message.error("打开链接失败");
    }
  };

  /**
   * 重新检测所有依赖
   */
  const handleRetryCheck = async () => {
    await checkAllDeps();
  };

  const handleRetryCheckAndFocus = async () => {
    await checkAllDeps();
    setTimeout(() => {
      listContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  /**
   * 开始安装依赖
   * 逐个安装依赖包，实时更新统一依赖列表的状态
   */
  const handleStartInstall = async () => {
    setInstallPhase("installing");
    setInstallProgress(0);
    setInstallError("");

    try {
      // 获取需要安装的包列表（状态不是 installed 的）
      const packagesToInstall = installableDependencies.filter(
        (d) => d.status !== "installed",
      );
      const total = packagesToInstall.length;

      if (total === 0) {
        // 没有需要安装的包
        setInstallProgress(100);
        setInstallPhase("completed");
        setTimeout(() => {
          onComplete();
        }, 1500);
        return;
      }

      // 初始化 npm 环境（如果有 npm-local 类型的依赖）
      const hasNpmDeps = packagesToInstall.some((d) => d.type === "npm-local");
      if (hasNpmDeps) {
        await initLocalNpmEnv();
      }

      // 依次安装每个包
      for (let i = 0; i < packagesToInstall.length; i++) {
        const pkg = packagesToInstall[i];
        setCurrentInstalling(pkg.displayName);
        setInstallProgress(Math.round((i / total) * 100));

        // 更新统一列表中当前包状态为 installing
        setAllDependencies((prev) =>
          prev.map((d) =>
            d.name === pkg.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        // 根据类型检查是否已安装
        let isInstalled = false;
        let checkVersion: string | undefined;

        if (pkg.type === "shell-installer") {
          const checkResult = await checkShellInstallerPackage(
            pkg.binName || pkg.name,
          );
          isInstalled = checkResult.installed;
          checkVersion = checkResult.version;
        } else if (pkg.type === "npm-global") {
          const checkResult = await checkGlobalNpmPackage(
            pkg.binName || pkg.name,
          );
          isInstalled = checkResult.installed;
          checkVersion = checkResult.version;
        } else {
          const checkResult = await checkLocalNpmPackage(pkg.name);
          isInstalled = checkResult.installed;
          checkVersion = checkResult.version;
        }

        if (isInstalled) {
          // 已安装，更新状态
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? {
                    ...d,
                    status: "installed" as const,
                    version: checkVersion,
                  }
                : d,
            ),
          );
          continue;
        }

        // 根据类型安装包
        let installResult;
        if (pkg.type === "shell-installer") {
          if (!pkg.installerUrl) {
            throw new Error(`${pkg.displayName} 缺少 installerUrl 配置`);
          }
          installResult = await installShellInstallerPackage(
            pkg.installerUrl,
            pkg.binName || pkg.name,
          );
        } else if (pkg.type === "npm-global") {
          installResult = await installGlobalNpmPackage(
            pkg.name,
            pkg.binName || pkg.name,
          );
        } else {
          installResult = await installLocalNpmPackage(pkg.name);
        }
        if (installResult.success) {
          // 安装成功，更新状态
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? {
                    ...d,
                    status: "installed" as const,
                    version: installResult.version,
                  }
                : d,
            ),
          );
        } else {
          // 安装失败
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? {
                    ...d,
                    status: "error" as const,
                    errorMessage: installResult.error,
                  }
                : d,
            ),
          );
          setInstallPhase("error");
          setInstallError(
            installResult.error || `安装 ${pkg.displayName} 失败`,
          );
          return;
        }
      }

      // 全部安装成功
      setInstallProgress(100);
      setInstallPhase("completed");

      // 自动触发完成回调（调用 restart_all_services，然后跳转到客户端页面）
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (error) {
      console.error("[SetupStep3] 安装失败:", error);
      setInstallPhase("error");
      setInstallError(error instanceof Error ? error.message : "安装失败");
    }
  };

  /**
   * 重试安装
   */
  const handleRetryInstall = async () => {
    await handleStartInstall();
  };

  /**
   * 获取状态图标
   */
  const getStatusIcon = (item: UnifiedDependencyItem) => {
    // 类型图标
    if (item.type === "system") {
      if (item.name === "nodejs") {
        return (
          <NodeIndexOutlined
            style={{
              color: item.status === "installed" ? "#52c41a" : "#faad14",
            }}
          />
        );
      }
      if (item.name === "uv") {
        return (
          <ThunderboltOutlined
            style={{
              color: item.status === "installed" ? "#52c41a" : "#faad14",
            }}
          />
        );
      }
    }

    // 状态图标
    switch (item.status) {
      case "installed":
        return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
      case "missing":
        return <ExclamationCircleOutlined style={{ color: "#faad14" }} />;
      case "outdated":
        return <ExclamationCircleOutlined style={{ color: "#fa8c16" }} />;
      case "installing":
        return <LoadingOutlined style={{ color: "#1890ff" }} />;
      case "error":
        return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />;
      case "checking":
      default:
        return <LoadingOutlined style={{ color: "#1890ff" }} />;
    }
  };

  /**
   * 获取状态标签
   */
  const getStatusTag = (item: UnifiedDependencyItem) => {
    const config: Record<string, { color: string; text: string }> = {
      installed: { color: "success", text: "已就绪" },
      missing: { color: "warning", text: "未安装" },
      outdated: { color: "orange", text: "版本过低" },
      installing: { color: "processing", text: "安装中" },
      checking: { color: "default", text: "检测中" },
      error: { color: "error", text: "错误" },
    };
    const c = config[item.status] || config.checking;
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  const getStatusText = (status: UnifiedDependencyItem["status"]) => {
    const config: Record<string, string> = {
      installed: "已就绪",
      missing: "未安装",
      outdated: "版本过低",
      installing: "安装中",
      checking: "检测中",
      error: "错误",
    };
    return config[status] || "检测中";
  };

  /**
   * 获取类型标签
   */
  const getTypeTag = (item: UnifiedDependencyItem) => {
    if (item.type === "system") {
      return <Tag color="blue">系统依赖</Tag>;
    }
    if (item.type === "shell-installer") {
      return <Tag color="cyan">shell</Tag>;
    }
    if (item.type === "npm-global") {
      return <Tag color="purple">npm 全局</Tag>;
    }
    return <Tag color="purple">npm 包</Tag>;
  };

  /**
   * 计算依赖统计信息
   */
  const getDependencyStats = () => {
    const total = allDependencies.length;
    const ready = allDependencies.filter(
      (d) => d.status === "installed",
    ).length;
    const systemDeps = allDependencies.filter((d) => d.type === "system");
    const systemReady = systemDeps.filter(
      (d) => d.status === "installed",
    ).length;
    const npmDeps = allDependencies.filter((d) => d.type === "npm-local");
    const npmReady = npmDeps.filter((d) => d.status === "installed").length;

    // 可安装依赖（npm-local、npm-global 和 shell-installer）
    const installableDeps = allDependencies.filter(
      (d) =>
        d.type === "npm-local" ||
        d.type === "npm-global" ||
        d.type === "shell-installer",
    );
    const installableReady = installableDeps.filter(
      (d) => d.status === "installed",
    ).length;
    const installableTotal = installableDeps.length;
    const installablePending = installableTotal - installableReady;

    // 只有当有依赖项且都已安装时才算全部就绪
    const allReady = total > 0 && total === ready;
    const systemAllReady =
      systemDeps.length > 0 && systemDeps.length === systemReady;

    return {
      total,
      ready,
      systemTotal: systemDeps.length,
      systemReady,
      npmTotal: npmDeps.length,
      npmReady,
      installableTotal,
      installableReady,
      installablePending,
      allReady,
      systemAllReady,
    };
  };

  const stats = getDependencyStats();
  const problemCount = allDependencies.filter(
    (d) => d.status !== "installed",
  ).length;
  const systemProblemCount = allDependencies.filter(
    (d) => d.type === "system" && d.status !== "installed",
  ).length;
  const npmProblemCount = allDependencies.filter(
    (d) => d.type === "npm-local" && d.status !== "installed",
  ).length;
  const systemProblemUrls = allDependencies
    .filter(
      (d) =>
        d.type === "system" &&
        (d.status === "missing" || d.status === "outdated") &&
        d.installUrl,
    )
    .map((d) => d.installUrl!) as string[];

  const handleOpenInstallGuides = async () => {
    for (const url of systemProblemUrls) {
      try {
        await openUrl(url);
      } catch (error) {
        console.error("[SetupStep3] 打开链接失败:", error);
      }
    }
  };

  const handleFocusProblems = () => {
    setDepFilter("all");
    setShowAllDependencies(false);
    setTimeout(() => {
      listContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const handleCopyProblems = async () => {
    if (problemCount === 0) {
      return;
    }
    const problems = allDependencies.filter((d) => d.status !== "installed");
    const lines = problems.map((d) => {
      const parts = [
        `${d.displayName} - ${getStatusText(d.status)}`,
        d.requiredVersion ? `要求 ${d.requiredVersion}` : "",
        d.installCommand ? `安装命令: ${d.installCommand}` : "",
      ].filter(Boolean);
      return parts.join(" | ");
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      message.info("已复制问题清单");
    } catch {
      message.error("复制失败");
    }
  };

  /**
   * 渲染完整依赖列表（系统依赖 + npm 包）
   */
  const renderDependencyList = () => (
    <Card
      size="small"
      title={
        <Space>
          <AppstoreOutlined />
          <span>依赖清单</span>
          <Tag color={stats.allReady ? "success" : "processing"}>
            {stats.ready}/{stats.total}
          </Tag>
          <Tag color={problemCount > 0 ? "warning" : "success"}>
            问题 {problemCount}
          </Tag>
        </Space>
      }
      extra={
        <Space size={6}>
          {systemProblemUrls.length > 0 && (
            <Button size="small" onClick={handleOpenInstallGuides}>
              安装指引
            </Button>
          )}
          {problemCount > 0 && (
            <Button size="small" onClick={handleFocusProblems}>
              定位问题
            </Button>
          )}
          {problemCount > 0 && (
            <Button size="small" onClick={handleCopyProblems}>
              复制问题
            </Button>
          )}
          <Button
            size="small"
            type={depFilter === "all" ? "primary" : "default"}
            onClick={() => setDepFilter("all")}
          >
            全部 {problemCount > 0 ? `(${problemCount})` : ""}
          </Button>
          <Button
            size="small"
            type={depFilter === "system" ? "primary" : "default"}
            onClick={() => setDepFilter("system")}
          >
            系统 {systemProblemCount > 0 ? `(${systemProblemCount})` : ""}
          </Button>
          <Button
            size="small"
            type={depFilter === "npm-local" ? "primary" : "default"}
            onClick={() => setDepFilter("npm-local")}
          >
            npm {npmProblemCount > 0 ? `(${npmProblemCount})` : ""}
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => setShowAllDependencies((prev) => !prev)}
          >
            {showAllDependencies ? "仅显示问题" : "展开全部"}
          </Button>
        </Space>
      }
      style={{ marginBottom: 12 }}
    >
      <div ref={listContainerRef}>
        <List
          size="small"
          dataSource={(() => {
            const byType =
              depFilter === "all"
                ? allDependencies
                : allDependencies.filter((item) => item.type === depFilter);
            const filtered = showAllDependencies
              ? byType
              : byType.filter((item) => item.status !== "installed");
            if (!showAllDependencies) {
              return filtered;
            }
            return [...filtered].sort((a, b) => {
              const aProblem = a.status !== "installed";
              const bProblem = b.status !== "installed";
              if (aProblem === bProblem) return 0;
              return aProblem ? -1 : 1;
            });
          })()}
          locale={{ emptyText: "暂无问题项" }}
          renderItem={(item) => {
            const isSystemDep = item.type === "system";
            const needsAction =
              item.status === "missing" || item.status === "outdated";
            const isProblem = item.status !== "installed";

            return (
              <List.Item
                style={{
                  background:
                    item.status === "installed"
                      ? "#f6ffed"
                      : item.status === "error"
                        ? "#fff2f0"
                        : item.status === "installing"
                          ? "#e6f7ff"
                          : "#fffbe6",
                  borderRadius: 6,
                  marginBottom: 6,
                  padding: "8px 12px",
                }}
                actions={[
                  getStatusTag(item),
                  // 系统依赖显示安装链接
                  isSystemDep && needsAction && item.installUrl && (
                    <Button
                      size="small"
                      type="link"
                      icon={<LinkOutlined />}
                      onClick={() => openUrl(item.installUrl!)}
                    >
                      安装说明
                    </Button>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={getStatusIcon(item)}
                  title={
                    <Space>
                      <Text strong>{item.displayName}</Text>
                      {getTypeTag(item)}
                      {item.version && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          v{item.version}
                        </Text>
                      )}
                    </Space>
                  }
                  description={
                    isProblem ? (
                      <Space direction="vertical" size={2}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.description}
                          {item.requiredVersion && (
                            <span> (要求 {item.requiredVersion})</span>
                          )}
                        </Text>
                        {/* 系统依赖的安装命令 */}
                        {isSystemDep && needsAction && item.installCommand && (
                          <Text code copyable style={{ fontSize: 11 }}>
                            {item.installCommand}
                          </Text>
                        )}
                        {/* 错误信息 */}
                        {item.errorMessage && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {item.errorMessage}
                          </Text>
                        )}
                      </Space>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已就绪
                      </Text>
                    )
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>
    </Card>
  );

  /**
   * 渲染安装进度
   */
  const renderInstallProgress = () => (
    <div className="install-progress compact-status">
      <Space size={8} align="center">
        <Spin size="small" />
        <Text>
          {currentInstalling ? `正在安装 ${currentInstalling}` : "准备安装"}
        </Text>
      </Space>
      <Progress
        size="small"
        percent={installProgress}
        status={installPhase === "error" ? "exception" : "active"}
        style={{ marginTop: 6 }}
      />
    </div>
  );

  /**
   * 渲染主内容
   */
  const renderContent = () => {
    // 检测中
    if (installPhase === "checking") {
      return (
        <div className="compact-status">
          <Space size={8} align="center">
            <Spin size="small" />
            <Text>正在检测依赖环境...</Text>
          </Space>
        </div>
      );
    }

    // 安装完成
    if (installPhase === "completed") {
      return (
        <>
          {/* 显示完整依赖列表（全部已就绪） */}
          {renderDependencyList()}

          <Result
            icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
            title="所有依赖已就绪"
            subTitle="正在启动服务，即将进入客户端页面..."
            extra={<Spin size="large" />}
          />
        </>
      );
    }

    // 安装错误
    if (installPhase === "error") {
      return (
        <>
          {/* 显示依赖列表（含错误状态） */}
          {renderDependencyList()}

          <Alert
            message="安装失败"
            description={installError}
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
          />

          <div className="step-actions">
            <Space>
              <Button type="primary" onClick={handleRetryInstall}>
                重试安装
              </Button>
              <Button onClick={handleRetryCheck}>重新检测</Button>
            </Space>
          </div>
        </>
      );
    }

    // 系统依赖未就绪 或 准备安装
    return (
      <>
        {/* 统计信息 */}
        <Alert
          message={
            <Space>
              <span>依赖检测结果</span>
              <Tag color={stats.systemAllReady ? "success" : "warning"}>
                系统依赖 {stats.systemReady}/{stats.systemTotal}
              </Tag>
              <Tag
                color={
                  stats.installableReady === stats.installableTotal
                    ? "success"
                    : "processing"
                }
              >
                可安装依赖 {stats.installableReady}/{stats.installableTotal}
              </Tag>
            </Space>
          }
          description={
            !stats.systemAllReady
              ? '请先安装 Node.js，然后点击"重新检测"继续'
              : stats.allReady
                ? "所有依赖已就绪"
                : '系统依赖已就绪，点击"开始安装"自动安装其他依赖'
          }
          type={
            stats.systemAllReady
              ? stats.allReady
                ? "success"
                : "info"
              : "warning"
          }
          showIcon
          style={{ marginBottom: 12 }}
        />

        {/* 安装目录提示 */}
        {appDir && stats.systemAllReady && (
          <Alert
            message="本地安装目录"
            description={
              <Space direction="vertical" size={0}>
                <Text copyable={{ text: `${appDir}/node_modules` }}>
                  <FolderOutlined style={{ marginRight: 8 }} />
                  {appDir}/node_modules
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                  npm 包将安装到应用本地目录，不会影响系统全局环境
                </Text>
              </Space>
            }
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}

        {/* 完整依赖列表 */}
        {renderDependencyList()}

        {/* 安装进度 */}
        {installPhase === "installing" && renderInstallProgress()}

        {/* 操作按钮 */}
        <Divider />
        <div className="step-actions">
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRetryCheckAndFocus}
            >
              重新检测
            </Button>
            {/* 只有系统依赖都就绪才能安装 npm 包 */}
            {stats.systemAllReady &&
              !stats.allReady &&
              installPhase !== "installing" && (
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  onClick={handleStartInstall}
                  size="middle"
                >
                  开始安装 ({stats.installablePending} 个)
                </Button>
              )}
          </Space>
        </div>
      </>
    );
  };

  return (
    <div className="setup-step3">
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
            <CloudDownloadOutlined style={{ marginRight: 8 }} />
            依赖安装
          </Title>
        </Space>
        <Text type="secondary">检测并安装运行所需的系统依赖和 npm 包</Text>
      </div>

      <Divider />

      {renderContent()}

      {/* 内联样式 */}
      <style>{`
        .setup-step3 {
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

        .install-progress {
          padding: 8px 10px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-top: 10px;
        }

        .compact-status {
          padding: 8px 10px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 12px;
          font-size: 12px;
        }

        .step-actions {
          display: flex;
          justify-content: flex-end;
        }

        .setup-step3 .ant-divider {
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
}
