/**
 * 初始化向导 - 步骤3: 依赖安装
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Typography,
  Button,
  Progress,
  Tag,
  Alert,
  Spin,
  Result,
  message,
} from "antd";
import {
  CloudDownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  LinkOutlined,
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

const { Text } = Typography;

interface SetupStep3Props {
  onComplete: () => void;
  onBack?: () => void;
}

type InstallPhase =
  | "checking"
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
    | "error";
  version?: string;
  requiredVersion?: string;
  errorMessage?: string;
  installUrl?: string;
  installCommand?: string;
  binName?: string;
  installerUrl?: string;
}

export default function SetupStep3({ onComplete, onBack }: SetupStep3Props) {
  const [allDependencies, setAllDependencies] = useState<
    UnifiedDependencyItem[]
  >([]);
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  const [installableDependencies, setInstallableDependencies] = useState<
    LocalDependencyItem[]
  >([]);
  const [installPhase, setInstallPhase] = useState<InstallPhase>("checking");
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>("");
  const [installError, setInstallError] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

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

  const checkAllDeps = useCallback(async () => {
    setInstallPhase("checking");
    try {
      const deps = await checkAllSetupDependencies();
      const unified = buildUnifiedDeps(deps);
      setAllDependencies(unified);

      const nodeDep = deps.find((d) => d.name === "nodejs");
      const nodeReady = nodeDep?.status === "installed";
      if (nodeDep) {
        setNodeResult({
          installed: nodeDep.status !== "missing",
          version: nodeDep.version,
          meetsRequirement: nodeDep.status === "installed",
        });
      }

      setInstallableDependencies(
        deps.filter(
          (d) =>
            d.type === "npm-local" ||
            d.type === "npm-global" ||
            d.type === "shell-installer",
        ),
      );

      if (!nodeReady) {
        setInstallPhase("system-deps-missing");
        return;
      }

      if (unified.every((d) => d.status === "installed")) {
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
      } else {
        setInstallPhase("ready");
      }
    } catch (error) {
      setInstallPhase("error");
      setInstallError("检测依赖失败");
    }
  }, [buildUnifiedDeps, onComplete]);

  useEffect(() => {
    checkAllDeps();
  }, [checkAllDeps]);

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

  const handleStartInstall = async () => {
    setInstallPhase("installing");
    setInstallProgress(0);
    setInstallError("");

    try {
      const toInstall = installableDependencies.filter(
        (d) => d.status !== "installed",
      );
      const total = toInstall.length;
      if (total === 0) {
        setInstallProgress(100);
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
        return;
      }

      const hasNpm = toInstall.some((d) => d.type === "npm-local");
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
        } else if (pkg.type === "npm-global") {
          const r = await checkGlobalNpmPackage(pkg.binName || pkg.name);
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
        } else if (pkg.type === "npm-global") {
          result = await installGlobalNpmPackage(
            pkg.name,
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

  const getStatusIcon = (item: UnifiedDependencyItem) => {
    switch (item.status) {
      case "installed":
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
    ready: allDependencies.filter((d) => d.status === "installed").length,
    systemReady: allDependencies.filter(
      (d) => d.type === "system" && d.status === "installed",
    ).length,
    systemTotal: allDependencies.filter((d) => d.type === "system").length,
  };
  const systemAllReady =
    stats.systemTotal > 0 && stats.systemTotal === stats.systemReady;
  const allReady = stats.total > 0 && stats.total === stats.ready;
  const pendingCount = allDependencies.filter(
    (d) => d.status !== "installed",
  ).length;

  const displayDeps = showAll
    ? allDependencies
    : allDependencies.filter((d) => d.status !== "installed");

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
            const isProblem = item.status !== "installed";
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
                    item.status === "installed"
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

  // Checking
  if (installPhase === "checking") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          依赖安装
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#f4f4f5",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <Spin size="small" />
          <span>正在检测依赖环境...</span>
        </div>
      </div>
    );
  }

  // Completed
  if (installPhase === "completed") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          依赖安装
        </div>
        {renderDependencyList()}
        <Result
          icon={<CheckCircleOutlined style={{ color: "#16a34a" }} />}
          title="所有依赖已就绪"
          subTitle="正在进入主界面..."
          extra={<Spin size="small" />}
        />
      </div>
    );
  }

  // Error
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
          <Button onClick={checkAllDeps}>重新检测</Button>
          <Button type="primary" onClick={handleStartInstall}>
            重试安装
          </Button>
        </div>
      </div>
    );
  }

  // Ready or system-deps-missing
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
          <div style={{ fontSize: 14, fontWeight: 500 }}>依赖安装</div>
          <div style={{ fontSize: 12, color: "#a1a1aa" }}>
            检测并安装运行所需的依赖
          </div>
        </div>
      </div>

      <Alert
        message={
          !systemAllReady
            ? "请先安装 Node.js，然后点击「重新检测」"
            : allReady
              ? "所有依赖已就绪"
              : "系统依赖已就绪，点击「开始安装」"
        }
        type={systemAllReady ? (allReady ? "success" : "info") : "warning"}
        showIcon
        style={{ marginBottom: 12 }}
      />

      {renderDependencyList()}

      {installPhase === "installing" && (
        <div
          style={{
            padding: "8px 10px",
            background: "#f4f4f5",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            {currentInstalling ? `正在安装 ${currentInstalling}` : "准备安装"}
          </div>
          <Progress size="small" percent={installProgress} status="active" />
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          paddingTop: 8,
          borderTop: "1px solid #f4f4f5",
        }}
      >
        <Button size="small" icon={<ReloadOutlined />} onClick={checkAllDeps}>
          重新检测
        </Button>
        {systemAllReady && !allReady && installPhase !== "installing" && (
          <Button
            type="primary"
            size="small"
            icon={<CloudDownloadOutlined />}
            onClick={handleStartInstall}
          >
            开始安装 ({pendingCount})
          </Button>
        )}
      </div>
    </div>
  );
}
