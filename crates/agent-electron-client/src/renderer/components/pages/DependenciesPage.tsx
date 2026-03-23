/**
 * 依赖管理页面 (Electron 版)
 *
 * 从 Tauri 版 DependenciesPage 适配而来:
 * - invoke() → window.electronAPI.dependencies.*
 * - 类型来自 ../types/electron.d.ts
 * - 刷新时由后端查询 npm registry 获取 latestVersion，有新版本时显示"更新到 x.y.z"按钮
 */

import { useState, useEffect, useCallback } from "react";
import { Button, Tag, Alert, Spin, message } from "antd";
import {
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import type {
  LocalDependencyItem,
  DependencyStatus,
} from "@shared/types/electron";
import { DEPENDENCY_STATUS_LABELS, ACTION_MESSAGES } from "@shared/constants";
import styles from "../../styles/components/ClientPage.module.css";

// Dev mock 模式：设为 true 可预览骨架屏 loading 效果
const MOCK_LOADING = false;

// Mock 数据用于测试
const MOCK_NODE_RESULT = {
  installed: true,
  version: "24.0.0",
  meetsRequirement: true,
  bundled: true,
};

const MOCK_UV_RESULT = {
  installed: true,
  version: "0.5.0",
  meetsRequirement: true,
  bundled: true,
};

const MOCK_LOCAL_DEPS: LocalDependencyItem[] = [
  {
    name: "@anthropic-ai/sdk",
    displayName: "Anthropic SDK",
    description: "Claude API 客户端",
    type: "npm-local",
    status: "installed",
    version: "0.30.0",
    latestVersion: "0.32.0",
    required: true,
  },
  {
    name: "claude-code-acp-ts",
    displayName: "Claude Code ACP",
    description: "ACP 协议实现",
    type: "npm-local",
    status: "installed",
    version: "1.0.0",
    required: true,
  },
  {
    name: "nuwax-file-server",
    displayName: "文件服务",
    description: "本地文件 HTTP 服务",
    type: "npm-local",
    status: "outdated",
    version: "1.2.0",
    latestVersion: "1.3.0",
    required: true,
  },
  {
    name: "nuwax-mcp-stdio-proxy",
    displayName: "MCP 代理",
    description: "MCP 协议聚合代理",
    type: "npm-local",
    status: "missing",
    required: true,
  },
];

interface NodeCheckResult {
  installed?: boolean;
  version?: string;
  meetsRequirement?: boolean;
  bundled?: boolean;
  binPath?: string;
}

interface UvCheckResult {
  installed?: boolean;
  version?: string;
  meetsRequirement?: boolean;
  bundled?: boolean;
}

/** 应用包内集成的 nuwax-mcp-stdio-proxy 检测结果，与 Node/uv 一起在系统环境中展示 */
interface McpProxyBundledResult {
  available: boolean;
  version?: string;
}

export default function DependenciesPage() {
  const [nodeResult, setNodeResult] = useState<NodeCheckResult | null>(
    MOCK_LOADING ? null : null,
  );
  const [uvResult, setUvResult] = useState<UvCheckResult | null>(null);
  const [mcpProxyBundled, setMcpProxyBundled] =
    useState<McpProxyBundledResult | null>(null);
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>(
    MOCK_LOADING ? [] : [],
  );
  const [depLoading, setDepLoading] = useState(MOCK_LOADING);
  const [depInstalling, setDepInstalling] = useState(false);
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>("");
  /** 当前正在执行的操作类型，用于进度文案 */
  const [currentInstallAction, setCurrentInstallAction] = useState<
    "install" | "upgrade" | "update"
  >("install");

  const loadDependencies = useCallback(async () => {
    // Mock 模式：模拟加载延迟后使用 mock 数据
    if (MOCK_LOADING) {
      setDepLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setNodeResult(MOCK_NODE_RESULT);
      setUvResult(MOCK_UV_RESULT);
      setMcpProxyBundled({ available: true, version: "1.0.0" });
      setLocalDeps(MOCK_LOCAL_DEPS);
      setDepLoading(false);
      return;
    }

    setDepLoading(true);
    try {
      // Node.js: 检测内置 Node.js 24 版本
      const nodeRes = await window.electronAPI?.dependencies.checkNode();
      const nodeData: NodeCheckResult = nodeRes?.success
        ? {
            installed: nodeRes.installed,
            version: nodeRes.version,
            meetsRequirement: nodeRes.meetsRequirement,
            bundled: nodeRes.bundled,
          }
        : { installed: false, meetsRequirement: false, bundled: false };
      setNodeResult(nodeData);

      // Check uv
      const uvRes = await window.electronAPI?.dependencies.checkUv();
      const uvData: UvCheckResult = uvRes?.success
        ? {
            installed: uvRes.installed,
            version: uvRes.version,
            meetsRequirement: uvRes.meetsRequirement,
            bundled: uvRes.bundled,
          }
        : { installed: false, meetsRequirement: false, bundled: false };
      setUvResult(uvData);

      // 应用包内集成的 MCP Proxy (nuwax-mcp-stdio-proxy)，与 Node/uv 一起在系统环境中展示
      const mcpRes =
        await window.electronAPI?.dependencies.checkMcpProxyBundled();
      const mcpData: McpProxyBundledResult =
        mcpRes?.success && mcpRes.available
          ? { available: true, version: mcpRes.version }
          : { available: false };
      setMcpProxyBundled(mcpData);

      // Check all local/installable dependencies
      const depsResult = await window.electronAPI?.dependencies.checkAll({
        checkLatest: true,
      });
      if (depsResult?.success && depsResult.results) {
        const installableDeps = depsResult.results.filter(
          (d) =>
            d.type === "npm-local" ||
            d.type === "npm-global" ||
            d.type === "shell-installer",
        );
        setLocalDeps(installableDeps);
      } else {
        setLocalDeps([]);
      }
    } catch (error) {
      message.error("加载依赖数据失败");
      console.error("[DependenciesPage] loadDependencies error:", error);
    } finally {
      setDepLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  const depSummary = {
    total: localDeps.length,
    installed: localDeps.filter(
      (d) => d.status === "installed" || d.status === "bundled",
    ).length,
    missing: localDeps.filter(
      (d) => d.status === "missing" || d.status === "error",
    ).length,
    outdated: localDeps.filter((d) => d.status === "outdated").length,
  };

  /**
   * 依赖安装/升级后重启所有服务，使新版本二进制生效。
   * restartAll 内部已包含停止逻辑，无需额外调用 stopAll。
   */
  const restartServicesAfterDepChange = useCallback(async () => {
    try {
      message.loading({ content: "正在重启服务…", key: "restart-services" });
      await window.electronAPI?.services.restartAll();
      message.success({ content: "服务已重启", key: "restart-services" });
    } catch (e) {
      console.error("[DependenciesPage] 重启服务失败:", e);
      message.error({
        content: "重启服务失败",
        key: "restart-services",
      });
    }
  }, []);

  // ==========================================
  // Install / upgrade / update-to-latest a single dependency
  // ==========================================
  const handleInstallSingleDep = async (
    dep: LocalDependencyItem,
    mode: "install" | "upgrade" | "update" = dep.status === "outdated"
      ? "upgrade"
      : "install",
  ) => {
    const { name: packageName, displayName } = dep;
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    setCurrentInstallAction(mode);
    setLocalDeps((prev) =>
      prev.map((d) =>
        d.name === packageName ? { ...d, status: "installing" as const } : d,
      ),
    );

    // "update" 模式不传 version → @latest；其余走 installVersion
    const options =
      mode === "update"
        ? undefined
        : dep.installVersion
          ? { version: dep.installVersion }
          : undefined;
    // "update" 失败时回退 installed（不破坏已安装状态）；其余标记 error
    const failStatus =
      mode === "update" ? ("installed" as const) : ("error" as const);

    const actionLabel =
      mode === "update" ? "更新" : mode === "upgrade" ? "升级" : "安装";

    try {
      const result = await window.electronAPI?.dependencies.installPackage(
        packageName,
        options,
      );

      if (result?.success) {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? {
                  ...d,
                  status: "installed" as const,
                  version: result.version,
                  binPath: result.binPath,
                }
              : d,
          ),
        );
        const versionHint =
          mode === "update" && result.version ? ` ${result.version}` : "";
        message.success(`${displayName} ${actionLabel}成功${versionHint}`);
        await restartServicesAfterDepChange();
      } else {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? { ...d, status: failStatus, errorMessage: result?.error }
              : d,
          ),
        );
        message.error(`${displayName} ${actionLabel}失败`);
      }
    } catch (error) {
      setLocalDeps((prev) =>
        prev.map((d) =>
          d.name === packageName
            ? { ...d, status: failStatus, errorMessage: String(error) }
            : d,
        ),
      );
      message.error(`${actionLabel}失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
      setCurrentInstallAction("install");
    }
  };

  // ==========================================
  // Install/upgrade all missing or outdated dependencies
  // ==========================================
  const handleInstallAllDeps = async () => {
    const depsToProcess = localDeps.filter(
      (d) =>
        d.status === "missing" ||
        d.status === "error" ||
        d.status === "outdated",
    );
    if (depsToProcess.length === 0) {
      message.info("没有需要安装或升级的依赖");
      return;
    }

    const hadOutdated = depsToProcess.some((d) => d.status === "outdated");
    const hadMissing = depsToProcess.some(
      (d) => d.status === "missing" || d.status === "error",
    );

    setDepInstalling(true);
    let anySucceeded = false;
    try {
      for (const dep of depsToProcess) {
        setCurrentInstallingDep(dep.displayName);
        setCurrentInstallAction(
          dep.status === "outdated" ? "upgrade" : "install",
        );
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === dep.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        const options = dep.installVersion
          ? { version: dep.installVersion }
          : undefined;
        const result = await window.electronAPI?.dependencies.installPackage(
          dep.name,
          options,
        );

        if (result?.success) {
          anySucceeded = true;
          setLocalDeps((prev) =>
            prev.map((d) =>
              d.name === dep.name
                ? {
                    ...d,
                    status: "installed" as const,
                    version: result.version,
                    binPath: result.binPath,
                  }
                : d,
            ),
          );
        } else {
          setLocalDeps((prev) =>
            prev.map((d) =>
              d.name === dep.name
                ? {
                    ...d,
                    status: "error" as const,
                    errorMessage: result?.error,
                  }
                : d,
            ),
          );
          const action = dep.status === "outdated" ? "升级" : "安装";
          message.error(`${dep.displayName} ${action}失败`);
        }
      }

      const doneMsg =
        hadMissing && hadOutdated
          ? "依赖安装并升级完成"
          : hadOutdated
            ? "依赖升级完成"
            : "依赖安装完成";
      message.success(doneMsg);
      // 若有任意一项安装/升级成功，关闭并重启服务使新依赖生效
      if (anySucceeded) {
        await restartServicesAfterDepChange();
      }
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
      setCurrentInstallAction("install");
    }
  };

  // ==========================================
  // Status helpers
  // ==========================================
  const getStatusIcon = (status: DependencyStatus) => {
    switch (status) {
      case "installed":
      case "bundled":
        return (
          <CheckCircleOutlined
            style={{ color: "var(--color-success)", fontSize: 12 }}
          />
        );
      case "missing":
      case "outdated":
        return (
          <ExclamationCircleOutlined
            style={{ color: "var(--color-warning)", fontSize: 12 }}
          />
        );
      case "installing":
        return (
          <LoadingOutlined
            style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}
          />
        );
      case "error":
        return (
          <CloseCircleOutlined
            style={{ color: "var(--color-error)", fontSize: 12 }}
          />
        );
      default:
        return <LoadingOutlined style={{ fontSize: 12 }} />;
    }
  };

  const getStatusText = (status: DependencyStatus) => {
    return (
      DEPENDENCY_STATUS_LABELS[status] || DEPENDENCY_STATUS_LABELS.checking
    );
  };

  // Node.js and uv must both be ready
  const systemDepsReady =
    (nodeResult?.meetsRequirement ?? false) &&
    (uvResult?.meetsRequirement ?? false);

  // ==========================================
  // Loading state - 骨架屏
  // ==========================================
  if (depLoading && !nodeResult) {
    return (
      <div className={styles.page}>
        {/* 系统环境骨架 */}
        <div className={styles.section}>
          <div className={styles.servicesHeader}>
            <div className={styles.servicesHeaderLeft}>
              <span className={styles.sectionTitle}>系统环境</span>
              <Tag color="default">检测中...</Tag>
            </div>
          </div>
          <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
            {[1, 2].map((i) => (
              <div key={i} className={styles.serviceRow}>
                <div className={styles.serviceInfo}>
                  <Spin size="small" />
                  <div>
                    <span
                      className={styles.serviceLabel}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      {i === 1 ? "Node.js" : "uv"}
                    </span>
                    <span className={styles.serviceDescription}>检测中...</span>
                  </div>
                </div>
              </div>
            ))}
            {/* 应用包内集成 MCP Proxy，与 Node/uv 同区展示 */}
            <div className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                <Spin size="small" />
                <div>
                  <span
                    className={styles.serviceLabel}
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    MCP Proxy
                  </span>
                  <span className={styles.serviceDescription}>检测中...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 依赖包骨架 */}
        <div className={styles.section}>
          <div className={styles.servicesHeader}>
            <div className={styles.servicesHeaderLeft}>
              <span className={styles.sectionTitle}>依赖包</span>
              <span
                style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}
              >
                检测中...
              </span>
            </div>
            <Button size="small" icon={<ReloadOutlined spin />} disabled>
              刷新
            </Button>
          </div>
          <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={styles.serviceRow}>
                <div className={styles.serviceInfo}>
                  <Spin size="small" />
                  <div>
                    <span
                      className={styles.serviceLabel}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      加载中...
                    </span>
                    <div className={styles.serviceDescription}>
                      正在检测依赖状态
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // Main render
  // ==========================================
  return (
    <div className={styles.page}>
      {/* 系统依赖 */}
      <div className={styles.section}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <span className={styles.sectionTitle}>系统环境</span>
            <Tag color={systemDepsReady ? "success" : "warning"}>
              {systemDepsReady
                ? ACTION_MESSAGES.ready
                : ACTION_MESSAGES.needConfig}
            </Tag>
          </div>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          {/* Node.js */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              {nodeResult?.meetsRequirement ? (
                <CheckCircleOutlined
                  style={{ color: "var(--color-success)", fontSize: 12 }}
                />
              ) : (
                <ExclamationCircleOutlined
                  style={{ color: "var(--color-warning)", fontSize: 12 }}
                />
              )}
              <div>
                <span className={styles.serviceLabel}>Node.js</span>
                {nodeResult?.version && (
                  <span className={styles.serviceDescription}>
                    {nodeResult.version}
                  </span>
                )}
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: nodeResult?.meetsRequirement
                  ? "var(--color-success)"
                  : "var(--color-warning)",
              }}
            >
              {!nodeResult?.installed
                ? "未安装"
                : nodeResult.bundled
                  ? DEPENDENCY_STATUS_LABELS.bundled
                  : nodeResult.meetsRequirement
                    ? ACTION_MESSAGES.allInstalled
                    : "需 >= 22.0.0"}
            </span>
          </div>

          {/* uv */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              {uvResult?.meetsRequirement ? (
                <CheckCircleOutlined
                  style={{ color: "var(--color-success)", fontSize: 12 }}
                />
              ) : (
                <ExclamationCircleOutlined
                  style={{ color: "var(--color-warning)", fontSize: 12 }}
                />
              )}
              <div>
                <span className={styles.serviceLabel}>uv</span>
                {uvResult?.installed && (
                  <span className={styles.serviceDescription}>
                    {uvResult.version}
                  </span>
                )}
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: uvResult?.meetsRequirement
                  ? "var(--color-success)"
                  : "var(--color-warning)",
              }}
            >
              {!uvResult?.installed
                ? "未安装"
                : uvResult.bundled
                  ? DEPENDENCY_STATUS_LABELS.bundled
                  : uvResult.meetsRequirement
                    ? ACTION_MESSAGES.allInstalled
                    : "需 >= 0.5.0"}
            </span>
          </div>

          {/* MCP Proxy (nuwax-mcp-stdio-proxy)：应用包内集成，与 Node/uv 一起展示 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              {mcpProxyBundled?.available ? (
                <CheckCircleOutlined
                  style={{ color: "var(--color-success)", fontSize: 12 }}
                />
              ) : (
                <ExclamationCircleOutlined
                  style={{ color: "var(--color-warning)", fontSize: 12 }}
                />
              )}
              <div>
                <span className={styles.serviceLabel}>MCP Proxy</span>
                {mcpProxyBundled?.available && mcpProxyBundled.version && (
                  <span className={styles.serviceDescription}>
                    {" "}
                    {mcpProxyBundled.version}
                  </span>
                )}
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: mcpProxyBundled?.available
                  ? "var(--color-success)"
                  : "var(--color-text-tertiary)",
              }}
            >
              {mcpProxyBundled?.available ? "应用集成" : "未集成"}
            </span>
          </div>
        </div>
      </div>

      {/* 可安装依赖 */}
      <div className={styles.section}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <span className={styles.sectionTitle}>依赖包</span>
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              {depSummary.installed}/{depSummary.total} 已安装
            </span>
          </div>
          <div className={styles.servicesHeaderActions}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadDependencies}
              loading={depLoading}
            >
              刷新
            </Button>
            {(depSummary.missing > 0 || depSummary.outdated > 0) && (
              <Button
                size="small"
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleInstallAllDeps}
                loading={depInstalling}
                disabled={!systemDepsReady}
              >
                {depSummary.missing > 0 && depSummary.outdated > 0
                  ? "安装并升级"
                  : depSummary.outdated > 0
                    ? "全部升级"
                    : "全部安装"}
              </Button>
            )}
          </div>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          {localDeps.length === 0 ? (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-text-tertiary)",
              }}
            >
              {depLoading ? "正在加载..." : "暂无依赖包"}
            </div>
          ) : (
            localDeps.map((item, i) => {
              const canInstall =
                (item.status === "missing" ||
                  item.status === "error" ||
                  item.status === "outdated") &&
                systemDepsReady &&
                !depInstalling;

              return (
                <div key={item.name} className={styles.serviceRow}>
                  {getStatusIcon(item.status)}
                  <div
                    className={styles.serviceInfo}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      minWidth: 0,
                      gap: 3,
                      paddingLeft: 8,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span className={styles.serviceLabel}>
                        {item.displayName}
                      </span>
                      {item.required && (
                        <Tag
                          color="blue"
                          style={{
                            fontSize: 10,
                            lineHeight: "16px",
                            padding: "0 4px",
                          }}
                        >
                          必需
                        </Tag>
                      )}
                      {item.version && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-tertiary)",
                          }}
                        >
                          {item.version}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        marginTop: 2,
                      }}
                    >
                      {item.description}
                      {item.errorMessage && (
                        <span
                          style={{ color: "var(--color-error)", marginLeft: 8 }}
                        >
                          {item.errorMessage}
                        </span>
                      )}
                      {item.status === "installing" &&
                        currentInstallingDep === item.displayName && (
                          <span style={{ marginLeft: 8 }}>
                            <LoadingOutlined style={{ marginRight: 4 }} />
                            {currentInstallAction === "upgrade"
                              ? "升级中..."
                              : currentInstallAction === "update"
                                ? "更新中..."
                                : "安装中..."}
                          </span>
                        )}
                    </div>
                  </div>

                  <div className={styles.serviceActions}>
                    {canInstall && (
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => handleInstallSingleDep(item)}
                      >
                        {item.status === "outdated" ? "升级" : "安装"}
                      </Button>
                    )}
                    {item.status === "bundled" && (
                      <span
                        style={{ fontSize: 12, color: "var(--color-success)" }}
                      >
                        {getStatusText(item.status)}
                      </span>
                    )}
                    {item.status === "installed" && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--color-success)",
                          }}
                        >
                          {getStatusText(item.status)}
                        </span>
                        {item.latestVersion &&
                          item.latestVersion.replace(/^v/, "") !==
                            (item.version ?? "").replace(/^v/, "") &&
                          systemDepsReady &&
                          !depInstalling && (
                            <Button
                              size="small"
                              onClick={() =>
                                handleInstallSingleDep(item, "update")
                              }
                            >
                              更新到 {item.latestVersion}
                            </Button>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {!systemDepsReady && (
        <Alert
          message="请先满足系统环境要求，再安装依赖包"
          type="warning"
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}
