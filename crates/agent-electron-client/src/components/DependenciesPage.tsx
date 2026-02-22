/**
 * 依赖管理页面 (Electron 版)
 *
 * 从 Tauri 版 DependenciesPage 适配而来:
 * - invoke() → window.electronAPI.dependencies.*
 * - 移除 checkLatestNpmVersion / isNewerVersion（Electron 暂无此功能）
 * - 移除 restartAllServices（Electron 暂无此功能）
 * - 类型来自 ../types/electron.d.ts
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
import type { LocalDependencyItem, DependencyStatus } from "../types/electron";

interface NodeCheckResult {
  installed?: boolean;
  version?: string;
  meetsRequirement?: boolean;
}

interface UvCheckResult {
  installed?: boolean;
  version?: string;
  meetsRequirement?: boolean;
}

const STATUS_LABELS: Record<DependencyStatus, string> = {
  checking: "检测中",
  installed: "已安装",
  missing: "未安装",
  outdated: "需更新",
  installing: "安装中",
  bundled: "已集成",
  error: "异常",
};

export default function DependenciesPage() {
  const [nodeResult, setNodeResult] = useState<NodeCheckResult | null>(null);
  const [uvResult, setUvResult] = useState<UvCheckResult | null>(null);
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>([]);
  const [depLoading, setDepLoading] = useState(false);
  const [depInstalling, setDepInstalling] = useState(false);
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>("");

  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      // Check system dependencies in parallel
      const [nodeRes, uvRes] = await Promise.all([
        window.electronAPI?.dependencies.checkNode(),
        window.electronAPI?.dependencies.checkUv(),
      ]);

      const nodeData: NodeCheckResult = nodeRes?.success
        ? {
            installed: nodeRes.installed,
            version: nodeRes.version,
            meetsRequirement: nodeRes.meetsRequirement,
          }
        : { installed: false, meetsRequirement: false };
      setNodeResult(nodeData);

      const uvData: UvCheckResult = uvRes?.success
        ? {
            installed: uvRes.installed,
            version: uvRes.version,
            meetsRequirement: uvRes.meetsRequirement,
          }
        : { installed: false, meetsRequirement: false };
      setUvResult(uvData);

      // Check all local/installable dependencies
      const depsResult = await window.electronAPI?.dependencies.checkAll();
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
  };

  // ==========================================
  // Install a single dependency
  // ==========================================
  const handleInstallSingleDep = async (dep: LocalDependencyItem) => {
    const { name: packageName, displayName } = dep;
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    setLocalDeps((prev) =>
      prev.map((d) =>
        d.name === packageName ? { ...d, status: "installing" as const } : d,
      ),
    );

    try {
      const result =
        await window.electronAPI?.dependencies.installPackage(packageName);

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
        message.success(`${displayName} 安装成功`);
      } else {
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === packageName
              ? { ...d, status: "error" as const, errorMessage: result?.error }
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

  // ==========================================
  // Install all missing dependencies
  // ==========================================
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
      for (const dep of missingDeps) {
        setCurrentInstallingDep(dep.displayName);
        setLocalDeps((prev) =>
          prev.map((d) =>
            d.name === dep.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        const result =
          await window.electronAPI?.dependencies.installPackage(dep.name);

        if (result?.success) {
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
          message.error(`${dep.displayName} 安装失败`);
        }
      }

      message.success("依赖安装完成");
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep("");
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
    return STATUS_LABELS[status] || STATUS_LABELS.checking;
  };

  const systemDepsReady =
    nodeResult?.meetsRequirement && uvResult?.meetsRequirement;

  // ==========================================
  // Loading state
  // ==========================================
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

  // ==========================================
  // Main render
  // ==========================================
  return (
    <div>
      {/* 系统依赖 */}
      <div style={{ marginBottom: 20 }}>
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
              {systemDepsReady ? "就绪" : "需配置"}
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
              <span style={{ fontSize: 12, color: "#16a34a" }}>已就绪</span>
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
              <span style={{ fontSize: 12, color: "#16a34a" }}>已就绪</span>
            ) : (
              <span style={{ fontSize: 12, color: "#ca8a04" }}>
                需 &gt;= 0.5.0
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 可安装依赖 */}
      <div style={{ marginBottom: 20 }}>
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
          {localDeps.length === 0 ? (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                fontSize: 12,
                color: "#a1a1aa",
              }}
            >
              {depLoading ? "正在加载..." : "暂无依赖包"}
            </div>
          ) : (
            localDeps.map((item, i) => {
              const canInstall =
                (item.status === "missing" || item.status === "error") &&
                systemDepsReady &&
                !depInstalling;

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
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
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
                    {item.status === "bundled" && (
                      <span style={{ fontSize: 12, color: "#16a34a" }}>
                        {getStatusText(item.status)}
                      </span>
                    )}
                    {item.status === "installed" && (
                      <span style={{ fontSize: 12, color: "#16a34a" }}>
                        {getStatusText(item.status)}
                      </span>
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
