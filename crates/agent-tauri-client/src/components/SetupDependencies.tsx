/**
 * 初始化向导 - 依赖安装
 *
 * 流程:
 * 1. checking → 检测所有依赖
 * 2. 若 Node 不满足 → node-installing → 自动安装 Node
 * 3. Node 安装成功 → 重新检测
 * 4. Node 安装失败 → node-install-failed → 手动安装提示 + 刷新
 * 5. 若 uv 不满足 → uv-installing → 自动安装 uv
 * 6. uv 安装成功 → 重新检测
 * 7. uv 安装失败 → uv-install-failed → 手动安装提示 + 刷新
 * 8. Node 和 uv 已就绪但其他依赖未安装 → ready → 用户点击安装
 * 9. 所有依赖就绪 → completed → 进入下一步
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Progress, Alert, Spin } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  LinkOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkAllSetupDependencies,
  autoInstallNode,
  autoInstallUv,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  checkShellInstallerPackage,
  installShellInstallerPackage,
  type LocalDependencyItem,
} from "../services/dependencies";
import { getDepsShowAll, setDepsShowAll } from "../services/setup";
import { ACTION_MESSAGES, DEPENDENCY_STATUS_LABELS } from "../constants";

interface SetupDependenciesProps {
  onComplete: () => void;
  onBack?: () => void;
}

type InstallPhase =
  | "checking"
  | "node-installing"
  | "node-install-failed"
  | "uv-installing"
  | "uv-install-failed"
  | "system-deps-missing"
  | "ready"
  | "installing"
  | "completed"
  | "error";

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
    | "bundled"
    | "error";
  version?: string;
  requiredVersion?: string;
  errorMessage?: string;
  installUrl?: string;
  installCommand?: string;
  binName?: string;
  installerUrl?: string;
}

type NetworkStatus = "checking" | "connected" | "disconnected";

export default function SetupDependencies({
  onComplete,
}: SetupDependenciesProps) {
  const [allDependencies, setAllDependencies] = useState<
    UnifiedDependencyItem[]
  >([]);
  const [installableDependencies, setInstallableDependencies] = useState<
    LocalDependencyItem[]
  >([]);
  const [installPhase, setInstallPhase] = useState<InstallPhase>("checking");
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>("");
  const [installError, setInstallError] = useState<string>("");
  const [nodeInstallError, setNodeInstallError] = useState<string>("");
  const [uvInstallError, setUvInstallError] = useState<string>("");
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("checking");
  const [showAll, setShowAll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 防止自动安装重复触发
  const nodeAutoInstallTriggered = useRef(false);
  const uvAutoInstallTriggered = useRef(false);
  const projectInstallTriggered = useRef(false);

  const checkNetwork = useCallback(async () => {
    setNetworkStatus("checking");
    try {
      // 5秒超时
      const connected = await Promise.race([
        invoke<boolean>("check_network_cn"),
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            console.warn("[SetupDeps] 网络检测超时，假设已连接");
            resolve(true);
          }, 5000),
        ),
      ]);
      setNetworkStatus(connected ? "connected" : "disconnected");
      return connected;
    } catch {
      setNetworkStatus("disconnected");
      return false;
    }
  }, []);

  const buildUnifiedDeps = useCallback(
    (deps: LocalDependencyItem[]): UnifiedDependencyItem[] =>
      deps.map((d) => ({
        name: d.name,
        displayName: d.displayName,
        type: d.type as UnifiedDependencyItem["type"],
        description: d.description,
        status: d.status as UnifiedDependencyItem["status"],
        version: d.version,
        requiredVersion: d.minVersion ? `>= ${d.minVersion}` : undefined,
        errorMessage: d.errorMessage,
        installUrl: d.installUrl,
        binName: d.binName,
        installerUrl: d.installerUrl,
      })),
    [],
  );

  /**
   * 自动安装 Node.js 并重新检测
   */
  const handleAutoInstallNode = useCallback(async () => {
    setInstallPhase("node-installing");
    setNodeInstallError("");

    try {
      const result = await autoInstallNode();

      if (result.success) {
        console.log("[SetupDeps] Node.js 自动安装成功，重新检测依赖...");
        // 安装成功，重新检测全部依赖
        // 注意：不重置 nodeAutoInstallTriggered，防止检测仍失败时再次触发安装循环
        setInstallPhase("checking");
      } else {
        console.error("[SetupDeps] Node.js 自动安装失败:", result.error);
        setNodeInstallError(
          result.error || "Node.js 自动安装失败，请手动安装。",
        );
        setInstallPhase("node-install-failed");
      }
    } catch (error) {
      console.error("[SetupDeps] Node.js 自动安装异常:", error);
      setNodeInstallError(
        error instanceof Error ? error.message : "Node.js 自动安装异常",
      );
      setInstallPhase("node-install-failed");
    }
  }, []);

  /**
   * 自动安装 uv 并重新检测
   */
  const handleAutoInstallUv = useCallback(async () => {
    setInstallPhase("uv-installing");
    setUvInstallError("");

    try {
      const result = await autoInstallUv();

      if (result.success) {
        console.log("[SetupDeps] uv 自动安装成功，重新检测依赖...");
        setInstallPhase("checking");
      } else {
        console.error("[SetupDeps] uv 自动安装失败:", result.error);
        setUvInstallError(result.error || "uv 自动安装失败，请手动安装。");
        setInstallPhase("uv-install-failed");
      }
    } catch (error) {
      console.error("[SetupDeps] uv 自动安装异常:", error);
      setUvInstallError(
        error instanceof Error ? error.message : "uv 自动安装异常",
      );
      setInstallPhase("uv-install-failed");
    }
  }, []);

  const checkAllDeps = useCallback(async () => {
    console.log("[SetupDeps] checkAllDeps 开始");
    setInstallPhase("checking");
    try {
      console.log("[SetupDeps] 开始检测依赖...");
      // 只检测依赖，不阻塞等待网络检测（本地安装不需要网络）
      const deps = await checkAllSetupDependencies();
      console.log("[SetupDeps] 依赖检测完成:", deps?.length, "项");
      const unified = buildUnifiedDeps(deps);
      setAllDependencies(unified);
      console.log(
        "[SetupDeps] 状态检查，unified:",
        unified.map((d) => `${d.name}:${d.status}`),
      );

      const nodeDep = deps.find((d) => d.name === "nodejs");
      const nodeReady = nodeDep?.status === "installed";

      setInstallableDependencies(
        deps.filter(
          (d) =>
            d.type === "npm-local" ||
            d.type === "npm-global" ||
            d.type === "shell-installer",
        ),
      );

      if (!nodeReady) {
        // Node 不满足要求 → 自动安装（本地资源，无需网络）
        if (!nodeAutoInstallTriggered.current) {
          nodeAutoInstallTriggered.current = true;
          handleAutoInstallNode();
        } else {
          // 自动安装已尝试过，显示手动安装提示
          setInstallPhase("system-deps-missing");
        }
        return;
      }

      // 检查 uv 是否满足要求 → 自动安装（本地资源，无需网络）
      const uvDep = deps.find((d) => d.name === "uv");
      const uvReady = uvDep?.status === "installed";

      if (!uvReady) {
        if (!uvAutoInstallTriggered.current) {
          uvAutoInstallTriggered.current = true;
          handleAutoInstallUv();
        } else {
          // 自动安装已尝试过，显示系统依赖缺失提示
          setInstallPhase("system-deps-missing");
        }
        return;
      }

      // 检查是否还有其他系统依赖未满足
      const otherSystemMissing = unified.some(
        (d) =>
          d.type === "system" &&
          d.name !== "nodejs" &&
          d.name !== "uv" &&
          d.status !== "installed" &&
          d.status !== "bundled",
      );
      if (otherSystemMissing) {
        setInstallPhase("system-deps-missing");
        return;
      }

      if (
        unified.every((d) => d.status === "installed" || d.status === "bundled")
      ) {
        console.log("[SetupDeps] 所有依赖已就绪，设置 completed");
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
      } else {
        console.log("[SetupDeps] 依赖未全部就绪，设置 ready");
        // 系统依赖就绪，自动安装项目依赖（应用内）
        setInstallPhase("ready");
      }
    } catch (error) {
      console.error("[SetupDeps] 检测失败:", error);
      setInstallPhase("error");
      setInstallError("检测依赖失败");
    }
  }, [
    buildUnifiedDeps,
    onComplete,
    handleAutoInstallNode,
    handleAutoInstallUv,
  ]);

  // 组件挂载后立即检测依赖
  useEffect(() => {
    checkAllDeps();
  }, []);

  useEffect(() => {
    const load = async () => {
      const savedShowAll = await getDepsShowAll();
      if (typeof savedShowAll === "boolean") setShowAll(savedShowAll);
    };
    load();
  }, []);

  useEffect(() => {
    setDepsShowAll(showAll);
  }, [showAll]);

  /**
   * 手动刷新 Node.js 检测（用于 node-install-failed 状态）
   */
  const handleRefreshNodeCheck = useCallback(async () => {
    nodeAutoInstallTriggered.current = false;
    setInstallPhase("checking");
  }, []);

  /**
   * 手动刷新 uv 检测（用于 uv-install-failed 状态）
   */
  const handleRefreshUvCheck = useCallback(async () => {
    uvAutoInstallTriggered.current = false;
    setInstallPhase("checking");
  }, []);

  const handleStartInstall = async () => {
    setInstallPhase("installing");
    setInstallProgress(0);
    setInstallError("");

    try {
      const toInstall = installableDependencies.filter(
        (d) => d.status !== "installed" && d.status !== "bundled",
      );
      const total = toInstall.length;
      if (total === 0) {
        setInstallProgress(100);
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
        return;
      }

      const hasNpm = toInstall.some(
        (d) => d.type === "npm-local" || d.type === "npm-global",
      );
      if (hasNpm) await initLocalNpmEnv();

      for (let i = 0; i < toInstall.length; i++) {
        const pkg = toInstall[i];
        setCurrentInstalling(pkg.displayName);
        setInstallProgress(Math.round((i / total) * 100));

        setAllDependencies((prev) =>
          prev.map((d) =>
            d.name === pkg.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        let isInstalled = false;
        let ver: string | undefined;
        if (pkg.type === "shell-installer") {
          const r = await checkShellInstallerPackage(pkg.binName || pkg.name);
          isInstalled = r.installed;
          ver = r.version;
        } else {
          const r = await checkLocalNpmPackage(pkg.name);
          isInstalled = r.installed;
          ver = r.version;
        }

        if (isInstalled) {
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? { ...d, status: "installed" as const, version: ver }
                : d,
            ),
          );
          continue;
        }

        let result;
        if (pkg.type === "shell-installer") {
          if (!pkg.installerUrl)
            throw new Error(`${pkg.displayName} 缺少 installerUrl`);
          result = await installShellInstallerPackage(
            pkg.installerUrl,
            pkg.binName || pkg.name,
          );
        } else {
          result = await installLocalNpmPackage(pkg.name);
        }

        if (result.success) {
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? {
                    ...d,
                    status: "installed" as const,
                    version: result.version,
                  }
                : d,
            ),
          );
        } else {
          setAllDependencies((prev) =>
            prev.map((d) =>
              d.name === pkg.name
                ? { ...d, status: "error" as const, errorMessage: result.error }
                : d,
            ),
          );
          setInstallPhase("error");
          setInstallError(result.error || `安装 ${pkg.displayName} 失败`);
          return;
        }
      }

      setInstallProgress(100);
      setInstallPhase("completed");
      setTimeout(() => onComplete(), 1500);
    } catch (error) {
      setInstallPhase("error");
      setInstallError(error instanceof Error ? error.message : "安装失败");
    }
  };

  // 系统依赖就绪后，自动触发项目依赖安装
  useEffect(() => {
    if (installPhase === "ready" && !projectInstallTriggered.current) {
      // 本地 npm 安装不需要网络连接，直接触发安装
      projectInstallTriggered.current = true;
      handleStartInstall();
    }
  }, [installPhase, networkStatus]);

  const getStatusIcon = (item: UnifiedDependencyItem) => {
    switch (item.status) {
      case "installed":
      case "bundled":
        return (
          <CheckCircleOutlined style={{ color: "#16a34a", fontSize: 12 }} />
        );
      case "missing":
      case "outdated":
        return (
          <ExclamationCircleOutlined
            style={{ color: "#ca8a04", fontSize: 12 }}
          />
        );
      case "installing":
        return <LoadingOutlined style={{ color: "#71717a", fontSize: 12 }} />;
      case "error":
        return (
          <CloseCircleOutlined style={{ color: "#dc2626", fontSize: 12 }} />
        );
      default:
        return <LoadingOutlined style={{ fontSize: 12 }} />;
    }
  };

  const stats = {
    total: allDependencies.length,
    ready: allDependencies.filter(
      (d) => d.status === "installed" || d.status === "bundled",
    ).length,
  };

  const displayDeps = showAll
    ? allDependencies
    : allDependencies.filter(
        (d) => d.status !== "installed" && d.status !== "bundled",
      );

  const renderDependencyList = () => (
    <div ref={listRef} style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>依赖清单</span>
          <span style={{ fontSize: 11, color: "#a1a1aa" }}>
            {stats.ready}/{stats.total}
          </span>
        </div>
        <Button
          type="link"
          size="small"
          onClick={() => setShowAll((p) => !p)}
          style={{ padding: 0, height: "auto", fontSize: 11 }}
        >
          {showAll ? "仅显示问题" : "展开全部"}
        </Button>
      </div>

      <div
        style={{
          border: "1px solid #e4e4e7",
          borderRadius: 6,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {displayDeps.length === 0 ? (
          <div
            style={{
              padding: 12,
              textAlign: "center",
              fontSize: 12,
              color: "#a1a1aa",
            }}
          >
            暂无问题项
          </div>
        ) : (
          displayDeps.map((item, i) => {
            const isProblem =
              item.status !== "installed" && item.status !== "bundled";
            const isSystem = item.type === "system";
            const needsAction =
              item.status === "missing" || item.status === "outdated";

            return (
              <div
                key={item.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderBottom:
                    i < displayDeps.length - 1 ? "1px solid #f4f4f5" : "none",
                  background:
                    item.status === "installed" || item.status === "bundled"
                      ? "#f0fdf4"
                      : item.status === "error"
                        ? "#fef2f2"
                        : "#fffbeb",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {getStatusIcon(item)}
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {item.displayName}
                    </span>
                    {item.version && (
                      <span style={{ fontSize: 11, color: "#a1a1aa" }}>
                        v{item.version}
                      </span>
                    )}
                  </div>
                  {isProblem && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#71717a",
                        marginTop: 2,
                        marginLeft: 18,
                      }}
                    >
                      {item.description}
                      {item.requiredVersion && (
                        <span> ({item.requiredVersion})</span>
                      )}
                      {item.errorMessage && (
                        <span style={{ color: "#dc2626", marginLeft: 4 }}>
                          {item.errorMessage}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {isSystem && needsAction && item.installUrl && (
                  <Button
                    type="link"
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() => openUrl(item.installUrl!)}
                    style={{ padding: 0, fontSize: 12 }}
                  >
                    安装
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ========== 渲染 ==========

  // 判断是否为错误/需要用户介入的阶段
  const isErrorPhase =
    installPhase === "node-install-failed" ||
    installPhase === "uv-install-failed" ||
    installPhase === "system-deps-missing" ||
    installPhase === "error";

  // 正常自动流程：只显示 loading + 状态文字
  if (!isErrorPhase) {
    const phaseText: Record<string, string> = {
      checking: "正在检测依赖环境...",
      "node-installing": "正在自动安装 Node.js...",
      "uv-installing": "正在自动安装 uv...",
      ready: "正在准备安装项目依赖...",
      installing: currentInstalling
        ? `正在安装 ${currentInstalling}...`
        : "正在安装依赖...",
      completed: ACTION_MESSAGES.allReady,
    };

    return (
      <div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "40px 16px",
          }}
        >
          {installPhase === "completed" ? (
            <CheckCircleOutlined style={{ fontSize: 40, color: "#16a34a" }} />
          ) : (
            <Spin size="large" />
          )}
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {phaseText[installPhase] || ACTION_MESSAGES.starting}
          </div>
          {installPhase === "installing" && (
            <div style={{ width: "100%", maxWidth: 300 }}>
              <Progress
                size="small"
                percent={installProgress}
                status="active"
              />
            </div>
          )}
          {installPhase === "completed" && (
            <div style={{ fontSize: 12, color: "#71717a" }}>
              正在进入下一步...
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========== 错误/需要用户介入的阶段：展示完整依赖列表 ==========

  // Node 安装失败
  if (installPhase === "node-install-failed") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          依赖安装
        </div>
        {allDependencies.length > 0 && renderDependencyList()}
        <Alert
          message="Node.js 自动安装失败"
          description={
            <div>
              <div>{nodeInstallError}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#71717a" }}>
                请手动安装 Node.js (版本 &gt;= 22)，安装完成后点击「刷新检测」。
              </div>
              <div style={{ marginTop: 4 }}>
                <Button
                  type="link"
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() => openUrl("https://nodejs.org")}
                  style={{ padding: 0, fontSize: 12 }}
                >
                  前往 Node.js 官网下载
                </Button>
              </div>
            </div>
          }
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button icon={<ReloadOutlined />} onClick={handleRefreshNodeCheck}>
            刷新检测
          </Button>
          <Button type="primary" onClick={handleAutoInstallNode}>
            重试自动安装
          </Button>
        </div>
      </div>
    );
  }

  // uv 安装失败
  if (installPhase === "uv-install-failed") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          依赖安装
        </div>
        {allDependencies.length > 0 && renderDependencyList()}
        <Alert
          message="uv 自动安装失败"
          description={
            <div>
              <div>{uvInstallError}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#71717a" }}>
                请手动安装 uv (版本 &gt;= 0.5.0)，安装完成后点击「刷新检测」。
              </div>
              <div style={{ marginTop: 4 }}>
                <Button
                  type="link"
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() =>
                    openUrl(
                      "https://docs.astral.sh/uv/getting-started/installation/",
                    )
                  }
                  style={{ padding: 0, fontSize: 12 }}
                >
                  前往 uv 官网查看安装方式
                </Button>
              </div>
            </div>
          }
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button icon={<ReloadOutlined />} onClick={handleRefreshUvCheck}>
            刷新检测
          </Button>
          <Button type="primary" onClick={handleAutoInstallUv}>
            重试自动安装
          </Button>
        </div>
      </div>
    );
  }

  // 通用错误（npm 安装失败等）
  if (installPhase === "error") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          依赖安装
        </div>
        {renderDependencyList()}
        <Alert
          message="安装失败"
          description={installError}
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button
            onClick={() => {
              projectInstallTriggered.current = false;
              setInstallPhase("checking");
            }}
          >
            重新检测
          </Button>
          <Button
            type="primary"
            onClick={() => {
              projectInstallTriggered.current = false;
              handleStartInstall();
            }}
          >
            重试安装
          </Button>
        </div>
      </div>
    );
  }

  // system-deps-missing：系统依赖缺失
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
        依赖安装
      </div>

      {networkStatus === "disconnected" && (
        <Alert
          message="网络不可用"
          description={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12 }}>
                安装依赖需要网络连接，请检查网络后重试
              </span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={checkNetwork}
              >
                重新检测
              </Button>
            </div>
          }
          type="error"
          showIcon
          icon={<DisconnectOutlined />}
          style={{ marginBottom: 12 }}
        />
      )}

      <Alert
        message="请安装所需系统依赖，然后点击「重新检测」"
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
      />

      {renderDependencyList()}

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          paddingTop: 8,
          borderTop: "1px solid #f4f4f5",
        }}
      >
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            nodeAutoInstallTriggered.current = false;
            uvAutoInstallTriggered.current = false;
            projectInstallTriggered.current = false;
            setInstallPhase("checking");
          }}
        >
          重新检测
        </Button>
      </div>
    </div>
  );
}
