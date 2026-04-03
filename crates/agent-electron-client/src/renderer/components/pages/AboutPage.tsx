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
  Switch,
  Typography,
} from "antd";
import {
  SyncOutlined,
  DownloadOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "@shared/constants";
import { t } from "../../services/core/i18n";
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
        message.error(
          t("Claw.About.checkFailedWithDetail", { error: result.error }),
        );
      } else if (!result.hasUpdate) {
        message.info(t("Claw.About.alreadyLatest"));
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
      message.error(t("Claw.About.checkFailed"));
      setUpdateState({ status: "idle" });
    }
  }, []);

  const handleChangeUpdateChannel = useCallback(
    async (checked: boolean) => {
      const nextChannel: UpdateChannel = checked ? "beta" : "stable";
      if (nextChannel === updateChannel) return;

      // 切换到 beta 时：弹出二次确认
      if (nextChannel === "beta") {
        Modal.confirm({
          title: t("Claw.About.channelSwitching"),
          content: (
            <div>
              <p>{t("Claw.About.betaWarning")}</p>
              <p>{t("Claw.About.confirmSwitch")}</p>
            </div>
          ),
          okText: t("Claw.About.confirmSwitchBtn"),
          cancelText: t("Claw.Common.cancel"),
          onOk: async () => {
            setChannelLoading(true);
            try {
              await window.electronAPI?.settings.set(
                UPDATE_CHANNEL_SETTING_KEY,
                "beta",
              );
              setUpdateChannel("beta");
              message.success(t("Claw.About.switchedToBeta"));
              // 确认后自动触发一次 beta 通道的升级检查
              await handleCheckUpdate();
            } catch {
              message.error(t("Claw.About.channelSwitchFailed"));
            } finally {
              setChannelLoading(false);
            }
          },
        });
        return;
      }

      // 切换回 stable：直接切换，无确认弹框，重新检查 stable 通道
      setChannelLoading(true);
      try {
        await window.electronAPI?.settings.set(
          UPDATE_CHANNEL_SETTING_KEY,
          "stable",
        );
        setUpdateChannel("stable");
        message.success(t("Claw.About.switchedToStable"));
        await handleCheckUpdate();
      } catch {
        message.error(t("Claw.About.channelSwitchFailed"));
      } finally {
        setChannelLoading(false);
      }
    },
    [updateChannel, handleCheckUpdate],
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
        title: t("Claw.About.updateDownloaded"),
        content: t("Claw.About.updateDownloadedConfirm", {
          version: updateState.version,
        }),
        okText: t("Claw.About.restartNow"),
        cancelText: t("Claw.About.later"),
        onOk: async () => {
          try {
            await window.electronAPI?.app?.installUpdate?.();
          } catch {
            message.error(t("Claw.About.installFailed"));
          }
        },
      });
    }
    // 状态回到非 downloaded 时重置标记
    if (updateState.status !== "downloaded") {
      hasShownInstallModal.current = false;
    }
  }, [updateState.status, updateState.version]);

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
        message.error(result.error || t("Claw.About.downloadFailed"));
        setUpdateState((prev) => ({ ...prev, status: "available" }));
      }
    } catch {
      message.error(t("Claw.About.downloadFailed"));
      setUpdateState((prev) => ({ ...prev, status: "available" }));
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      await window.electronAPI?.app?.installUpdate?.();
    } catch {
      message.error(t("Claw.About.installFailed"));
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
        message.error(t("Claw.About.getDebugInfoFailed"));
      }
    } catch (e) {
      console.error("[AboutPage] getUpdateDebugInfo failed:", e);
      message.error(t("Claw.About.getDebugInfoFailed"));
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
            {t("Claw.About.checking")}
          </Button>
        );

      case "available":
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {t("Claw.About.versionFound", { version })}
            </div>
            {autoUpdate === false ? (
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={handleOpenReleases}
              >
                {t("Claw.About.goToDownloadPage")}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
              >
                {t("Claw.About.downloadUpdate")}
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
              {t("Claw.About.downloading", {
                version,
                percent: displayPercent,
              })}
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
              {t("Claw.About.versionDownloaded", { version })}
            </div>
            <Button type="primary" onClick={handleInstall}>
              {t("Claw.About.installUpdate")}
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
                {t("Claw.About.readOnlyVolumeError")}
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<LinkOutlined />}
                  onClick={handleOpenReleases}
                >
                  {t("Claw.About.goToDownloadPage")}
                </Button>
                <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
                  {t("Claw.Common.retry")}
                </Button>
              </Space>
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <div style={{ fontSize: 12, color: "var(--color-error)" }}>
              {error || t("Claw.About.updateError")}
            </div>
            <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
              {t("Claw.Common.retry")}
            </Button>
          </Space>
        );

      default:
        return (
          <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>
            {t("Claw.About.checkUpdate")}
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
          {t("Claw.About.crossPlatformDescription")}
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
            {t("Claw.About.website")} {OFFICIAL_WEBSITE_URL}
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
            {t("Claw.About.betaChannel")}
          </Typography.Text>
          <Switch
            size="small"
            checked={updateChannel === "beta"}
            loading={channelLoading}
            onChange={handleChangeUpdateChannel}
            checkedChildren={t("Claw.About.switchOn")}
            unCheckedChildren={t("Claw.About.switchOff")}
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
          {t("Claw.About.betaDisclaimer")}
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
          {showDebugInfo
            ? t("Claw.About.hideDebugInfo")
            : t("Claw.About.showDebugInfo")}
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
            {t("Claw.About.debugInfoTitle")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "8px 16px",
            }}
          >
            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.platform")}:
            </span>
            <span>{debugInfo.platform}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.arch")}:
            </span>
            <span>{debugInfo.arch}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.packaged")}:
            </span>
            <span>
              {debugInfo.isPackaged
                ? t("Claw.Common.yes")
                : t("Claw.About.devMode")}
            </span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.appVersion")}:
            </span>
            <span>{debugInfo.appVersion}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.appName")}:
            </span>
            <span>{debugInfo.appName}</span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.installerType")}:
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
              {debugInfo.installerType === "nsis" &&
                " " + t("Claw.About.upgradeSupported")}
              {debugInfo.installerType === "msi" &&
                " " + t("Claw.About.manualDownload")}
            </span>

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.canAutoUpdate")}:
            </span>
            <span
              style={{
                color: debugInfo.canAutoUpdate
                  ? "var(--color-success)"
                  : "var(--color-error)",
                fontWeight: 500,
              }}
            >
              {debugInfo.canAutoUpdate
                ? t("Claw.Common.yes")
                : t("Claw.Common.no")}
            </span>

            {!debugInfo.isPackaged && (
              <>
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {t("Claw.About.appDir")}:
                </span>
                <span style={{ wordBreak: "break-all" }}>
                  {debugInfo.appDir}
                </span>

                <span style={{ color: "var(--color-text-secondary)" }}>
                  {t("Claw.About.exePath")}:
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
                    {t("Claw.About.uninstaller")}:
                  </span>
                  <span>{debugInfo.uninstallerFiles.join(", ")}</span>
                </>
              )}

            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.About.totalAppFiles")}:
            </span>
            <span>{debugInfo.totalAppFiles}</span>
          </div>
        </div>
      )}
    </div>
  );
}
