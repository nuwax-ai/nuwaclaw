/**
 * 依赖管理页面
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Tag, Alert, Spin, message } from "antd";
import {
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";
import {
  DependencyStatus,
  checkNodeVersion,
  checkUvVersion,
  checkAllSetupDependencies,
  initLocalNpmEnv,
  installLocalNpmPackage,
  checkShellInstallerPackage,
  installShellInstallerPackage,
  restartAllServices,
  checkLatestNpmVersion,
  isNewerVersion,
  type LocalDependencyItem,
  type NodeVersionResult,
  type UvVersionResult,
} from "../services/dependencies";
import { DEPENDENCY_STATUS_LABELS, ACTION_MESSAGES } from "../constants";

const { Text } = Typography;

export default function DependenciesPage() {
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  const [uvResult, setUvResult] = useState<UvVersionResult | null>(null);
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>([]);
  const [depLoading, setDepLoading] = useState(false);
  const [depInstalling, setDepInstalling] = useState(false);
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>("");

  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      const [nodeRes, uvRes] = await Promise.all([
        checkNodeVersion(),
        checkUvVersion(),
      ]);
      setNodeResult(nodeRes);
      setUvResult(uvRes);

      const deps = await checkAllSetupDependencies();
      const installableDeps = deps.filter(
        (d) =>
          d.type === "npm-local" ||
          d.type === "npm-global" ||
          d.type === "shell-installer",
      );
      setLocalDeps(installableDeps);

      // bundled（应用集成）的包不查 npm latest，它们的版本由应用更新管理
      const npmDepsToCheck = installableDeps.filter(
        (d) =>
          d.status === "installed" &&
          (d.type === "npm-local" || d.type === "npm-global"),
      );
      if (npmDepsToCheck.length > 0) {
        const latestResults = await Promise.all(
          npmDepsToCheck.map(async (d) => ({
            name: d.name,
            latest: await checkLatestNpmVersion(d.name),
          })),
        );
        setLocalDeps((prev) =>
          prev.map((d) => {
            const found = latestResults.find((r) => r.name === d.name);
            if (found?.latest) {
              return { ...d, latestVersion: found.latest };
            }
            return d;
          }),
        );
      }
    } catch (error) {
      message.error("加载依赖数据失败");
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
    missing: localDeps.filter((d) => d.status === "missing").length,
  };

  const handleInstallSingleDep = async (dep: LocalDependencyItem) => {
    const { name: packageName, displayName, type, installerUrl, binName } = dep;
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    setLocalDeps((prev) =>
      prev.map((d) =>
        d.name === packageName ? { ...d, status: "installing" as const } : d,
      ),
    );

    try {
      let result;
      if (type === "shell-installer") {
        if (!installerUrl) throw new Error("缺少 installerUrl");
        result = await installShellInstallerPackage(
          installerUrl,
          binName || packageName,
        );
      } else {
        await initLocalNpmEnv();
        result = await installLocalNpmPackage(packageName);
      }

      if (result.success) {
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
        message.success(`${displayName} 安装成功`);
        try {
          await restartAllServices();
        } catch {
          message.warning("依赖安装成功，但服务重启失败");
        }
      } else {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? { ...d, status: "error" as const, errorMessage: result.error }
              : d,
          ),
        );
        message.error(`${displayName} 安装失败`);
      }
    } catch (error) {
      setLocalDeps((prev) =>
        prev.map((d) =>
          d.name === packageName
            ? { ...d, status: "error" as const, errorMessage: String(error) }
            : d,
        ),
      );
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
    }
  };

  const handleUpdateDep = async (dep: LocalDependencyItem) => {
    const { name: packageName, displayName, type } = dep;
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    setLocalDeps((prev) =>
      prev.map((d) =>
        d.name === packageName ? { ...d, status: "installing" as const } : d,
      ),
    );

    try {
      await initLocalNpmEnv();
      const result = await installLocalNpmPackage(packageName);

      if (result.success) {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? {
                  ...d,
                  status: "installed" as const,
                  version: result.version,
                  binPath: result.binPath,
                  latestVersion: undefined,
                }
              : d,
          ),
        );
        message.success(`${displayName} 更新成功`);
        try {
          await restartAllServices();
        } catch {
          message.warning("更新成功，但服务重启失败");
        }
      } else {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? {
                  ...d,
                  status: "installed" as const,
                  errorMessage: result.error,
                }
              : d,
          ),
        );
        message.error(`${displayName} 更新失败`);
      }
    } catch (error) {
      setLocalDeps((prev) =>
        prev.map((d) =>
          d.name === packageName
            ? {
                ...d,
                status: "installed" as const,
                errorMessage: String(error),
              }
            : d,
        ),
      );
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
    }
  };

  const handleInstallAllDeps = async () => {
    const missingDeps = localDeps.filter(
      (d) => d.status === "missing" || d.status === "error",
    );
    if (missingDeps.length === 0) {
      message.info("没有需要安装的依赖");
      return;
    }

    setDepInstalling(true);
    try {
      const hasNpmDeps = missingDeps.some(
        (d) => d.type === "npm-local" || d.type === "npm-global",
      );
      if (hasNpmDeps) await initLocalNpmEnv();

      for (const dep of missingDeps) {
        setCurrentInstallingDep(dep.displayName);
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === dep.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        let isInstalled = false;
        let checkVersion: string | undefined;
        let checkBinPath: string | undefined;

        if (dep.type === "shell-installer") {
          const r = await checkShellInstallerPackage(dep.binName || dep.name);
          isInstalled = r.installed;
          checkVersion = r.version;
          checkBinPath = r.binPath;
        } else {
          const { checkLocalNpmPackage } =
            await import("../services/dependencies");
          const r = await checkLocalNpmPackage(dep.name);
          isInstalled = r.installed;
          checkVersion = r.version;
          checkBinPath = r.binPath;
        }

        if (isInstalled) {
          setLocalDeps((prev) =>
            prev.map((d) =>
              d.name === dep.name
                ? {
                    ...d,
                    status: "installed" as const,
                    version: checkVersion,
                    binPath: checkBinPath,
                  }
                : d,
            ),
          );
          continue;
        }

        let result;
        if (dep.type === "shell-installer") {
          if (!dep.installerUrl)
            throw new Error(`${dep.displayName} 缺少 installerUrl`);
          result = await installShellInstallerPackage(
            dep.installerUrl,
            dep.binName || dep.name,
          );
        } else {
          result = await installLocalNpmPackage(dep.name);
        }

        if (result.success) {
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
                ? { ...d, status: "error" as const, errorMessage: result.error }
                : d,
            ),
          );
          message.error(`${dep.displayName} 安装失败`);
        }
      }

      message.success("依赖安装完成");
      try {
        await restartAllServices();
      } catch {
        message.warning("依赖安装成功，但服务重启失败");
      }
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
    }
  };

  const getStatusIcon = (status: DependencyStatus) => {
    switch (status) {
      case "installed":
      case "bundled":
        return (
          <CheckCircleOutlined style={{ color: "#16a34a", fontSize: 12 }} />
        );
      case "missing":
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

  const getStatusText = (status: DependencyStatus) => {
    return (
      DEPENDENCY_STATUS_LABELS[status] || DEPENDENCY_STATUS_LABELS.checking
    );
  };

  const systemDepsReady =
    nodeResult?.meetsRequirement && uvResult?.meetsRequirement;

  if (depLoading && !nodeResult) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="small" />
        <div style={{ marginTop: 8, fontSize: 12, color: "#a1a1aa" }}>
          正在检测依赖...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 系统依赖 */}
      <div className="section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
              系统环境
            </span>
            <Tag color={systemDepsReady ? "success" : "warning"}>
              {systemDepsReady
                ? ACTION_MESSAGES.ready
                : ACTION_MESSAGES.needConfig}
            </Tag>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {/* Node.js */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid #f4f4f5",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {nodeResult?.meetsRequirement ? (
                <CheckCircleOutlined
                  style={{ color: "#16a34a", fontSize: 12 }}
                />
              ) : (
                <ExclamationCircleOutlined
                  style={{ color: "#ca8a04", fontSize: 12 }}
                />
              )}
              <span style={{ fontSize: 13, fontWeight: 500 }}>Node.js</span>
              {nodeResult?.installed && (
                <span style={{ fontSize: 12, color: "#71717a" }}>
                  v{nodeResult.version}
                </span>
              )}
            </div>
            {!nodeResult?.installed ? (
              <a
                href="https://nodejs.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#52525b" }}
              >
                安装
              </a>
            ) : nodeResult.meetsRequirement ? (
              <span style={{ fontSize: 12, color: "#16a34a" }}>
                {ACTION_MESSAGES.allInstalled}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "#ca8a04" }}>
                需 &gt;= 22.0.0
              </span>
            )}
          </div>

          {/* uv */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {uvResult?.meetsRequirement ? (
                <CheckCircleOutlined
                  style={{ color: "#16a34a", fontSize: 12 }}
                />
              ) : (
                <ExclamationCircleOutlined
                  style={{ color: "#ca8a04", fontSize: 12 }}
                />
              )}
              <span style={{ fontSize: 13, fontWeight: 500 }}>uv</span>
              {uvResult?.installed && (
                <span style={{ fontSize: 12, color: "#71717a" }}>
                  v{uvResult.version}
                </span>
              )}
            </div>
            {!uvResult?.installed ? (
              <span style={{ fontSize: 12, color: "#ca8a04" }}>未安装</span>
            ) : uvResult.meetsRequirement ? (
              <span style={{ fontSize: 12, color: "#16a34a" }}>
                {ACTION_MESSAGES.allInstalled}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "#ca8a04" }}>
                需 &gt;= 0.5.0
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 可安装依赖 */}
      <div className="section" style={{ marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
              依赖包
            </span>
            <span style={{ fontSize: 12, color: "#a1a1aa" }}>
              {depSummary.installed}/{depSummary.total} 已安装
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadDependencies}
              loading={depLoading}
            >
              刷新
            </Button>
            {depSummary.missing > 0 && (
              <Button
                size="small"
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleInstallAllDeps}
                loading={depInstalling}
                disabled={!systemDepsReady}
              >
                全部安装
              </Button>
            )}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {localDeps.map((item, i) => {
            const hasUpdate =
              item.status === "installed" &&
              item.version &&
              item.latestVersion &&
              isNewerVersion(item.version, item.latestVersion);
            const canInstall =
              (item.status === "missing" || item.status === "error") &&
              systemDepsReady &&
              !depInstalling;
            const canUpdate = hasUpdate && !depInstalling;

            return (
              <div
                key={item.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom:
                    i < localDeps.length - 1 ? "1px solid #f4f4f5" : "none",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {getStatusIcon(item.status)}
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
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
                      <span style={{ fontSize: 11, color: "#a1a1aa" }}>
                        {item.version}
                      </span>
                    )}
                    {hasUpdate && (
                      <span style={{ fontSize: 11, color: "#ca8a04" }}>
                        → {item.latestVersion}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#a1a1aa",
                      marginTop: 1,
                      marginLeft: 20,
                    }}
                  >
                    {item.description}
                    {item.errorMessage && (
                      <span style={{ color: "#dc2626", marginLeft: 8 }}>
                        {item.errorMessage}
                      </span>
                    )}
                    {item.status === "installing" &&
                      currentInstallingDep === item.displayName && (
                        <span style={{ marginLeft: 8 }}>
                          <LoadingOutlined style={{ marginRight: 4 }} />
                          安装中...
                        </span>
                      )}
                  </div>
                </div>

                <div style={{ flexShrink: 0, marginLeft: 12 }}>
                  {canInstall && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => handleInstallSingleDep(item)}
                    >
                      安装
                    </Button>
                  )}
                  {canUpdate && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => handleUpdateDep(item)}
                    >
                      更新
                    </Button>
                  )}
                  {item.status === "bundled" && (
                    <span style={{ fontSize: 12, color: "#16a34a" }}>
                      {getStatusText(item.status)}
                    </span>
                  )}
                  {item.status === "installed" && !hasUpdate && (
                    <span style={{ fontSize: 12, color: "#16a34a" }}>
                      {getStatusText(item.status)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
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
