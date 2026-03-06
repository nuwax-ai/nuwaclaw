/**
 * 关于页面 (Electron 版)
 *
 * - 版本号运行时从 Electron 主进程获取
 * - 检查更新 + 下载 + 重启安装 完整流程
 * - 下载完成后弹窗确认是否立即重启安装
 * - Windows MSI 安装用户引导到 Releases 页面
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button, Progress, message, Space, Modal } from "antd";
import { SyncOutlined, DownloadOutlined, LinkOutlined } from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "@shared/constants";
import type { UpdateState } from "@shared/types/updateTypes";

/** 官网地址，用于关于页「官网」链接 */
const OFFICIAL_WEBSITE_URL = "https://nuwax.com";

export default function AboutPage() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [appVersion, setAppVersion] = useState<string>('');
  const hasShownInstallModal = useRef(false);

  // 监听主进程推送的更新状态
  // 注意：preload 的 on() 已剥离 IPC event，callback 直接收到 (...args)
  useEffect(() => {
    const handler = (state: UpdateState) => {
      if (state) setUpdateState(state);
    };
    window.electronAPI?.on('update:status', handler as any);
    // 获取运行时版本号
    window.electronAPI?.app?.getVersion().then((v) => {
      if (v) setAppVersion(v);
    });
    // 初始化时获取一次当前更新状态
    window.electronAPI?.app?.getUpdateState?.()?.then((state) => {
      if (state) setUpdateState(state);
    });
    return () => {
      window.electronAPI?.off('update:status', handler as any);
    };
  }, []);

  // 下载完成后自动弹窗确认安装
  useEffect(() => {
    if (updateState.status === 'downloaded' && !hasShownInstallModal.current) {
      hasShownInstallModal.current = true;
      Modal.confirm({
        title: '更新已下载完成',
        content: `v${updateState.version} 已下载完成，是否立即重启安装？`,
        okText: '立即重启',
        cancelText: '稍后安装',
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
    if (updateState.status !== 'downloaded') {
      hasShownInstallModal.current = false;
    }
  }, [updateState.status, updateState.version]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateState((prev) => ({ ...prev, status: 'checking' }));
    try {
      const result = await window.electronAPI?.app?.checkUpdate();
      if (!result) {
        // IPC 返回空（API 不可用等），恢复 idle
        setUpdateState((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      if (result.error) {
        message.error(`检查更新失败: ${result.error}`);
        setUpdateState((prev) => ({ ...prev, status: 'idle' }));
      } else if (result.hasUpdate) {
        // 主进程 update:status 事件可能已推送 'available'，这里兜底确保状态更新
        setUpdateState((prev) =>
          prev.status === 'checking'
            ? { ...prev, status: 'available', version: result.version }
            : prev,
        );
      } else {
        message.info("当前已是最新版本");
        setUpdateState((prev) => ({ ...prev, status: 'idle' }));
      }
    } catch {
      message.error("检查更新失败");
      setUpdateState((prev) => ({ ...prev, status: 'idle' }));
    }
  }, []);

  const handleDownload = useCallback(async () => {
    // 立即切换到 downloading 状态，避免点击后无反馈
    setUpdateState((prev) => ({ ...prev, status: 'downloading', progress: undefined }));
    try {
      const result = await window.electronAPI?.app?.downloadUpdate?.();
      if (result && !result.success) {
        message.error(result.error || "下载失败");
        setUpdateState((prev) => ({ ...prev, status: 'available' }));
      }
    } catch {
      message.error("下载更新失败");
      setUpdateState((prev) => ({ ...prev, status: 'available' }));
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

  const renderUpdateSection = () => {
    const { status, version, progress, error, canAutoUpdate: autoUpdate } = updateState ?? { status: 'idle' as const };

    switch (status) {
      case 'checking':
        return (
          <Button icon={<SyncOutlined spin />} disabled>
            检查中...
          </Button>
        );

      case 'available':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#52525b' }}>
              发现新版本: v{version}
            </div>
            {autoUpdate === false ? (
              <Button type="primary" icon={<LinkOutlined />} onClick={handleOpenReleases}>
                前往下载页
              </Button>
            ) : (
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
                下载更新
              </Button>
            )}
          </Space>
        );

      case 'downloading':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#52525b' }}>
              {progress ? `正在下载 v${version}... ${Math.round(progress.percent)}%` : `正在下载 v${version}...`}
            </div>
            {progress ? (
              <Progress
                percent={Math.round(progress.percent)}
                size="small"
                status="active"
              />
            ) : (
              /* macOS Squirrel.Mac 不发送 download-progress 事件，显示不确定进度条 */
              <Progress percent={100} size="small" status="active" showInfo={false} />
            )}
          </Space>
        );

      case 'downloaded':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#15803d' }}>
              v{version} 已下载完成
            </div>
            <Button type="primary" onClick={handleInstall}>
              立即重启安装
            </Button>
          </Space>
        );

      case 'error':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#dc2626' }}>
              {error || '更新出错'}
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
          border: "1px solid #e4e4e7",
          borderRadius: 12,
          background: "#fff",
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
            color: "#18181b",
          }}
        >
          {APP_DISPLAY_NAME}
        </div>
        <div style={{ marginTop: 8, fontSize: 16, color: "#71717a", fontWeight: 500 }}>
          v{appVersion || '...'}
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 14,
            color: "#a1a1aa",
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
              color: "#71717a",
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
        <div style={{ marginTop: 24 }}>
          {renderUpdateSection()}
        </div>
      </div>
    </div>
  );
}
