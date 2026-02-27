/**
 * 初始化向导 - 依赖检测/安装 (Electron 版)
 *
 * 流程:
 * 1. checking → 检测所有依赖
 * 2. 若 uv 不满足 → system-deps-missing → 提示手动安装 + 刷新
 * 3. 若 npm 包缺失 → installing → 自动安装 + 进度
 * 4. 所有依赖就绪 → completed → 自动进入下一步
 *
 * 与 Tauri 版的差异:
 * - 移除 Node.js 自动安装逻辑（Electron 内嵌 Node.js）
 * - invoke() → window.electronAPI.dependencies.*
 * - openUrl() → window.electronAPI.shell.openExternal()
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
} from "@ant-design/icons";
import type { LocalDependencyItem } from "@shared/types/electron";
import { ACTION_MESSAGES } from "@shared/constants";

interface SetupDependenciesProps {
  onComplete: () => void;
}

type InstallPhase =
  | "checking"
  | "system-deps-missing"
  | "installing"
  | "completed"
  | "error";

interface DisplayDependencyItem {
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
}

export default function SetupDependencies({
  onComplete,
}: SetupDependenciesProps) {
  const [allDependencies, setAllDependencies] = useState<
    DisplayDependencyItem[]
  >([]);
  const [installPhase, setInstallPhase] = useState<InstallPhase>("checking");
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>("");
  const [installError, setInstallError] = useState<string>("");
  const [showAll, setShowAll] = useState(true);
  /** 初始化安装检查时显式确认 uv 的结果，用于在界面展示「浏览器确认有 uv」 */
  const [uvConfirm, setUvConfirm] = useState<{
    installed: boolean;
    bundled?: boolean;
    version?: string;
  } | null>(null);
  const projectInstallTriggered = useRef(false);

  const openUrl = useCallback(async (url: string) => {
    try {
      await window.electronAPI?.shell.openExternal(url);
    } catch (e) {
      console.error("[SetupDeps] openExternal failed:", e);
    }
  }, []);

  const checkAllDeps = useCallback(async () => {
    console.log("[SetupDeps] checkAllDeps 开始");
    setInstallPhase("checking");

    try {
      const result = await window.electronAPI?.dependencies.checkAll();
      if (!result?.success || !result.results) {
        throw new Error(result?.error || "检测依赖失败");
      }

      const deps: LocalDependencyItem[] = result.results;
      console.log("[SetupDeps] 依赖检测完成:", deps.length, "项");

      const unified: DisplayDependencyItem[] = deps.map((d) => ({
        name: d.name,
        displayName: d.displayName,
        type: d.type,
        description: d.description,
        status: d.status,
        version: d.version,
        requiredVersion: d.minVersion ? `>= ${d.minVersion}` : undefined,
        errorMessage: d.errorMessage,
        installUrl:
          d.type === "system" && d.name === "uv"
            ? "https://docs.astral.sh/uv/getting-started/installation/"
            : undefined,
      }));
      setAllDependencies(unified);

      // 初始化安装检查：显式再调一次 checkUv，便于在界面展示「已确认 uv」
      try {
        const uvRes = await window.electronAPI?.dependencies.checkUv();
        if (uvRes?.success && uvRes.installed) {
          setUvConfirm({
            installed: true,
            bundled: uvRes.bundled,
            version: uvRes.version,
          });
        } else {
          setUvConfirm({ installed: false });
        }
      } catch {
        setUvConfirm({ installed: false });
      }

      // 检查系统依赖
      const systemMissing = unified.some(
        (d) =>
          d.type === "system" &&
          d.status !== "installed" &&
          d.status !== "bundled",
      );

      if (systemMissing) {
        setInstallPhase("system-deps-missing");
        return;
      }

      // 检查是否全部就绪
      if (
        unified.every((d) => d.status === "installed" || d.status === "bundled")
      ) {
        console.log("[SetupDeps] 所有依赖已就绪");
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
      } else {
        // 有 npm 包需要安装
        setInstallPhase("installing");
      }
    } catch (error) {
      console.error("[SetupDeps] 检测失败:", error);
      setInstallPhase("error");
      setInstallError(
        error instanceof Error ? error.message : "检测依赖失败",
      );
    }
  }, [onComplete]);

  // 组件挂载后立即检测依赖
  useEffect(() => {
    checkAllDeps();
  }, []);

  // 进入 installing 阶段后自动开始安装
  useEffect(() => {
    if (installPhase === "installing" && !projectInstallTriggered.current) {
      projectInstallTriggered.current = true;
      handleStartInstall();
    }
  }, [installPhase]);

  const handleStartInstall = async () => {
    setInstallProgress(0);
    setInstallError("");

    try {
      const toInstall = allDependencies.filter(
        (d) =>
          (d.type === "npm-local" ||
            d.type === "npm-global" ||
            d.type === "shell-installer") &&
          d.status !== "installed" &&
          d.status !== "bundled",
      );

      const total = toInstall.length;
      if (total === 0) {
        setInstallProgress(100);
        setInstallPhase("completed");
        setTimeout(() => onComplete(), 1500);
        return;
      }

      for (let i = 0; i < toInstall.length; i++) {
        const pkg = toInstall[i];
        setCurrentInstalling(pkg.displayName);
        setInstallProgress(Math.round((i / total) * 100));

        setAllDependencies((prev) =>
          prev.map((d) =>
            d.name === pkg.name ? { ...d, status: "installing" as const } : d,
          ),
        );

        const result =
          await window.electronAPI?.dependencies.installPackage(pkg.name);

        if (result?.success) {
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
                ? {
                    ...d,
                    status: "error" as const,
                    errorMessage: result?.error,
                  }
                : d,
            ),
          );
          setInstallPhase("error");
          setInstallError(result?.error || `安装 ${pkg.displayName} 失败`);
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

  const getStatusIcon = (item: DisplayDependencyItem) => {
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
    <div style={{ marginBottom: 12 }}>
      {/* 初始化安装检查：浏览器确认 uv 已就绪时展示 */}
      {uvConfirm?.installed && (
        <Alert
          type="success"
          showIcon
          message={
            <span>
              uv 已确认（{uvConfirm.bundled ? "应用内" : "系统"}
              {uvConfirm.version ? `，v${uvConfirm.version}` : ""}）
            </span>
          }
          style={{ marginBottom: 12 }}
        />
      )}
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

  const isErrorPhase =
    installPhase === "system-deps-missing" || installPhase === "error";

  // 正常自动流程：只显示 loading + 状态文字
  if (!isErrorPhase) {
    const phaseText: Record<string, string> = {
      checking: "正在检测依赖环境...",
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
            <>
              {uvConfirm?.installed && (
                <div style={{ fontSize: 12, color: "#16a34a" }}>
                  uv 已确认（{uvConfirm.bundled ? "应用内" : "系统"}
                  {uvConfirm.version ? ` v${uvConfirm.version}` : ""}）
                </div>
              )}
              <div style={{ fontSize: 12, color: "#71717a" }}>
                正在进入下一步...
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ========== 错误/需要用户介入的阶段 ==========

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
              setInstallPhase("installing");
            }}
          >
            重试安装
          </Button>
        </div>
      </div>
    );
  }

  // system-deps-missing：系统依赖缺失（如 uv）
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
        依赖安装
      </div>

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
