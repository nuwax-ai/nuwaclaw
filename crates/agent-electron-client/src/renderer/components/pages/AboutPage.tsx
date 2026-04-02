/**
 * 关于页面 (Electron 版)
 *
 * - 版本号运行时从 Electron 主进程获取
 * - 检查更新 + 下载 + 重启安装 完整流程
 * - 下载完成后弹窗确认是否立即重启安装
 * - Windows MSI 安装用户引导到官网下载安装页
 * - macOS/Linux 上 Squirrel 不发送 download-progress，用本地模拟进度保证进度条有变化
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Progress,
  message,
  Space,
  Modal,
  Select,
  Typography,
} from "antd";
import {
  SyncOutlined,
  DownloadOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "@shared/constants";
import type { UpdateState } from "@shared/types/updateTypes";

/** 官网地址，用于关于页「官网」链接 */
const OFFICIAL_WEBSITE_URL = "https://nuwax.com";

/** macOS/Linux 无 download-progress 时，模拟进度从 0 增长到该值（%） */
const SIMULATED_PROGRESS_CAP = 90;
/** 模拟进度更新间隔（ms） */
const SIMULATED_PROGRESS_INTERVAL_MS = 500;
/** 预计下载时长（ms），用于计算每 tick 的增量，约 45s 内从 0 到 SIMULATED_PROGRESS_CAP */
const SIMULATED_DURATION_MS = 45_000;
type UpdateChannel = "stable" | "beta";
const UPDATE_CHANNEL_SETTING_KEY = "update_channel";

export default function AboutPage() {
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: "idle",
  });
  const [appVersion, setAppVersion] = useState<string>("");
  const hasShownInstallModal = useRef(false);
  /** macOS/Linux 无真实进度时的模拟进度（0..SIMULATED_PROGRESS_CAP），有 progress 时不用 */
  const [simulatedPercent, setSimulatedPercent] = useState(0);
  const simulatedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  /** 调试模式：显示升级检测详细信息 */
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [channelLoading, setChannelLoading] = useState(false);

  // 监听主进程推送的更新状态
  // 注意：preload 的 on() 已剥离 IPC event，callback 直接收到 (...args)
  useEffect(() => {
    const handler = (state: UpdateState) => {
      if (state) setUpdateState(state);
    };
    window.electronAPI?.on("update:status", handler as any);
    // 获取运行时版本号
    window.electronAPI?.app?.getVersion().then((v) => {
      if (v) setAppVersion(v);
    });
    // 初始化时获取一次当前更新状态
    window.electronAPI?.app?.getUpdateState?.()?.then((state) => {
      if (state) setUpdateState(state);
    });
    // 读取更新通道；旧版本默认按 stable 处理，避免影响已安装用户行为
    window.electronAPI?.settings
      .get(UPDATE_CHANNEL_SETTING_KEY)
      .then((saved) => {
        setUpdateChannel(saved === "beta" ? "beta" : "stable");
      })
      .catch(() => {
        setUpdateChannel("stable");
      });
    return () => {
      window.electronAPI?.off("update:status", handler as any);
    };
  }, []);

  const handleChangeUpdateChannel = useCallback(
    async (nextChannel: UpdateChannel) => {
      if (nextChannel === updateChannel) return;
      setChannelLoading(true);
      try {
        await window.electronAPI?.settings.set(
          UPDATE_CHANNEL_SETTING_KEY,
          nextChannel,
        );
        setUpdateChannel(nextChannel);
        message.success(
          `已切换到${nextChannel === "beta" ? "预发测试版" : "稳定正式版"}通道`,
        );
      } catch {
        message.error("更新通道切换失败，请稍后重试");
      } finally {
        setChannelLoading(false);
      }
    },
    [updateChannel],
  );

  // macOS/Linux：Squirrel 不发送 download-progress，用定时器模拟进度使进度条有变化
  useEffect(() => {
    const isDownloading = updateState.status === "downloading";
    const hasRealProgress = updateState.progress != null;

    if (isDownloading && !hasRealProgress) {
      setSimulatedPercent(0);
      const increment =
        (SIMULATED_PROGRESS_CAP / SIMULATED_DURATION_MS) *
        SIMULATED_PROGRESS_INTERVAL_MS;
      const id = setInterval(() => {
        setSimulatedPercent((prev) => {
          const next = prev + increment;
          return next >= SIMULATED_PROGRESS_CAP ? SIMULATED_PROGRESS_CAP : next;
        });
      }, SIMULATED_PROGRESS_INTERVAL_MS);
      simulatedIntervalRef.current = id;
      return () => {
        clearInterval(id);
        simulatedIntervalRef.current = null;
      };
    }

    if (!isDownloading || hasRealProgress) {
      if (simulatedIntervalRef.current) {
        clearInterval(simulatedIntervalRef.current);
        simulatedIntervalRef.current = null;
      }
      setSimulatedPercent(0);
    }
  }, [updateState.status, updateState.progress]);

  // 下载完成后自动弹窗确认安装
  useEffect(() => {
    if (updateState.status === "downloaded" && !hasShownInstallModal.current) {
      hasShownInstallModal.current = true;
      Modal.confirm({
        title: "更新已下载完成",
        content: `v${updateState.version} 已下载完成，是否立即重启安装？`,
        okText: "立即重启",
        cancelText: "稍后安装",
        onOk: async () => {
          try {
            await window.electronAPI?.app?.installUpdate?.();
          } catch {
            message.error("安装更新失败");
          }
        },
      });
    }
    // 状态回到非 downloaded 时重置标记
    if (updateState.status !== "downloaded") {
      hasShownInstallModal.current = false;
    }
  }, [updateState.status, updateState.version]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateState((prev) => ({ ...prev, status: "checking" }));
    try {
      const result = await window.electronAPI?.app?.checkUpdate();

      // IPC 不可用（API 层返回空），直接恢复 idle
      if (!result) {
        setUpdateState({ status: "idle" });
        return;
      }

      // 上一次检查仍在进行中，本次被跳过；不显示 toast，等待 update:status 事件。
      // 但启动检查可能在 IPC 往返途中恰好已完成且不再发事件，
      // 调一次 getUpdateState() 防止 'checking' 状态永久卡住。
      if (result.alreadyChecking) {
        const s = await window.electronAPI?.app?.getUpdateState?.();
        if (s) setUpdateState(s);
        return;
      }

      // 根据检查结果显示 toast（仅负责消息提示，不在这里推算状态）
      if (result.error) {
        message.error(`检查更新失败: ${result.error}`);
      } else if (!result.hasUpdate) {
        message.info("当前已是最新版本");
      }

      // 从主进程获取权威状态（含 canAutoUpdate），避免 IPC 事件与 invoke 响应
      // 竞争条件导致 Windows MSI 用户看到错误按钮或状态卡住
      const authoritative = await window.electronAPI?.app?.getUpdateState?.();
      if (authoritative) {
        setUpdateState(authoritative);
      } else if (result.error || !result.hasUpdate) {
        // getUpdateState 不可用时的兜底
        setUpdateState({ status: "idle" });
      }
    } catch {
      message.error("检查更新失败");
      setUpdateState({ status: "idle" });
    }
  }, []);

  const handleDownload = useCallback(async () => {
    // 立即切换到 downloading 状态，避免点击后无反馈
    setUpdateState((prev) => ({
      ...prev,
      status: "downloading",
      progress: undefined,
    }));
    try {
      const result = await window.electronAPI?.app?.downloadUpdate?.();
      if (result && !result.success) {
        message.error(result.error || "下载失败");
        setUpdateState((prev) => ({ ...prev, status: "available" }));
      }
    } catch {
      message.error("下载更新失败");
      setUpdateState((prev) => ({ ...prev, status: "available" }));
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      await window.electronAPI?.app?.installUpdate?.();
    } catch {
      message.error("安装更新失败");
    }
  }, []);

  const handleOpenReleases = useCallback(() => {
    window.electronAPI?.app?.openReleasesPage?.();
  }, []);

  /** 在系统默认浏览器中打开官网 */
  const handleOpenOfficialWebsite = useCallback(async () => {
    try {
      await window.electronAPI?.shell?.openExternal(OFFICIAL_WEBSITE_URL);
    } catch (e) {
      console.error("[AboutPage] openExternal failed:", e);
    }
  }, []);

  /** 获取调试信息 */
  const handleGetDebugInfo = useCallback(async () => {
    try {
      const info = await window.electronAPI?.app?.getUpdateDebugInfo?.();
      if (info && info.success) {
        setDebugInfo(info);
        setShowDebugInfo(true);
      } else {
        message.error("获取调试信息失败");
      }
    } catch (e) {
      console.error("[AboutPage] getUpdateDebugInfo failed:", e);
      message.error("获取调试信息失败");
    }
  }, []);

  const renderUpdateSection = () => {
    const {
      status,
      version,
      progress,
      error,
      canAutoUpdate: autoUpdate,
      isReadOnlyVolumeError: readOnlyVolume,
    } = updateState ?? { status: "idle" as const };

    switch (status) {
      case "checking":
        return (
          <Button icon={<SyncOutlined spin />} disabled>
            检查中...
          </Button>
        );

      case "available":
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              发现新版本: v{version}
            </div>
            {autoUpdate === false ? (
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={handleOpenReleases}
              >
                前往下载页
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
              >
                下载更新
              </Button>
            )}
          </Space>
        );

      case "downloading": {
        // 有真实进度（如 Windows）用主进程推送的 progress；无则用本地模拟进度（macOS/Linux）
        const displayPercent =
          progress != null
            ? Math.round(progress.percent)
            : Math.round(simulatedPercent);
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              正在下载 v{version}... {displayPercent}%
            </div>
            <Progress
              percent={displayPercent}
              size="small"
              status="active"
              showInfo={progress == null}
            />
          </Space>
        );
      }

      case "downloaded":
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-success)" }}>
              v{version} 已下载完成
            </div>
            <Button type="primary" onClick={handleInstall}>
              立即重启安装
            </Button>
          </Space>
        );

      case "error":
        // 只读卷错误（如从「下载」直接打开）：无法就地更新，引导用户前往下载页或移动应用后重试
        if (readOnlyVolume) {
          return (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                当前应用在只读位置运行（如从「下载」直接打开），无法就地更新。请将应用移到「应用程序」文件夹后重试，或通过下方按钮前往下载页手动下载新版本。
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<LinkOutlined />}
                  onClick={handleOpenReleases}
                >
                  前往下载页
                </Button>
                <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
                  重试
                </Button>
              </Space>
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-error)" }}>
              {error || "更新出错"}
            </div>
            <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
              重试
            </Button>
          </Space>
        );

      default:
        return (
          <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
            检查更新
          </Button>
        );
    }
  };

  return (
    <div
      style={{
        width: 400,
        margin: "48px auto",
        textAlign: "center",
      }}
    >
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          background: "var(--color-bg-section)",
          padding: "40px 32px",
        }}
      >
        <img
          src="./icon.png"
          alt={APP_DISPLAY_NAME}
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
          }}
        />
        <div
          style={{
            marginTop: 20,
            fontSize: 20,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {APP_DISPLAY_NAME}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 16,
            color: "var(--color-text-secondary)",
            fontWeight: 500,
          }}
        >
          v{appVersion || "..."}
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 14,
            color: "var(--color-text-tertiary)",
            lineHeight: 1.6,
          }}
        >
          跨平台 AI 智能体桌面客户端
        </div>
        {/* 官网链接：点击在系统浏览器打开 nuwax.com */}
        <div style={{ marginTop: 12 }}>
          <span
            role="button"
            tabIndex={0}
            onClick={handleOpenOfficialWebsite}
            onKeyDown={(e) => e.key === "Enter" && handleOpenOfficialWebsite()}
            style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <LinkOutlined />
            官网 {OFFICIAL_WEBSITE_URL}
          </span>
        </div>
        <div style={{ marginTop: 24 }}>{renderUpdateSection()}</div>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Typography.Text
            style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            更新通道
          </Typography.Text>
          <Select<UpdateChannel>
            size="small"
            value={updateChannel}
            loading={channelLoading}
            style={{ width: 180, textAlign: "left" }}
            onChange={handleChangeUpdateChannel}
            options={[
              { value: "stable", label: "稳定正式版（默认）" },
              { value: "beta", label: "预发测试版（内测）" },
            ]}
          />
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          预发测试版可能包含未验证改动。未设置时默认
          stable，不影响已安装旧版本客户端的默认更新行为。
        </div>
      </div>

      {/* 调试面板 */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Button
          type="link"
          size="small"
          onClick={
            showDebugInfo ? () => setShowDebugInfo(false) : handleGetDebugInfo
          }
          style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}
        >
          {showDebugInfo ? "隐藏" : "显示"}调试信息
        </Button>
      </div>

      {showDebugInfo && debugInfo && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px dashed var(--color-border)",
            borderRadius: 8,
            background: "var(--color-bg-elevated)",
            fontSize: 12,
            fontFamily: "monospace",
            textAlign: "left",
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            升级检测调试信息
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "8px 16px",
            }}
          >
            <span style={{ color: "var(--color-text-secondary)" }}>平台:</span>
            <span>{debugInfo.platform}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>架构:</span>
            <span>{debugInfo.arch}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              打包状态:
            </span>
            <span>{debugInfo.isPackaged ? "是" : "否 (开发模式)"}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              应用版本:
            </span>
            <span>{debugInfo.appVersion}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              应用名称:
            </span>
            <span>{debugInfo.appName}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              安装类型:
            </span>
            <span
              style={{
                color:
                  debugInfo.installerType === "nsis"
                    ? "var(--color-success)"
                    : debugInfo.installerType === "msi"
                      ? "var(--color-warning)"
                      : "inherit",
                fontWeight: 500,
              }}
            >
              {debugInfo.installerType?.toUpperCase()}
              {debugInfo.installerType === "nsis" && " ✅ 支持应用内升级"}
              {debugInfo.installerType === "msi" && " ⚠️ 需手动下载"}
            </span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              可自动更新:
            </span>
            <span
              style={{
                color: debugInfo.canAutoUpdate
                  ? "var(--color-success)"
                  : "var(--color-error)",
                fontWeight: 500,
              }}
            >
              {debugInfo.canAutoUpdate ? "是" : "否"}
            </span>

            {!debugInfo.isPackaged && (
              <>
                <span style={{ color: "var(--color-text-secondary)" }}>
                  应用目录:
                </span>
                <span style={{ wordBreak: "break-all" }}>
                  {debugInfo.appDir}
                </span>

                <span style={{ color: "var(--color-text-secondary)" }}>
                  可执行文件:
                </span>
                <span style={{ wordBreak: "break-all" }}>
                  {debugInfo.exePath}
                </span>
              </>
            )}

            {debugInfo.uninstallerFiles &&
              debugInfo.uninstallerFiles.length > 0 && (
                <>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    卸载程序:
                  </span>
                  <span>{debugInfo.uninstallerFiles.join(", ")}</span>
                </>
              )}

            <span style={{ color: "var(--color-text-secondary)" }}>
              目录文件数:
            </span>
            <span>{debugInfo.totalAppFiles}</span>
          </div>
        </div>
      )}
    </div>
  );
}
