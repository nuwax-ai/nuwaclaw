/**
 * 关于页面 (Electron 版)
 *
 * - 版本号运行时从 Electron 主进程获取
 * - 检查更新 + 下载 + 安装 完整流程
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Progress, message, Space } from "antd";
import { RobotOutlined, SyncOutlined, DownloadOutlined, PoweroffOutlined } from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "@shared/constants";
import type { UpdateState } from "@shared/types/updateTypes";

export default function AboutPage() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [appVersion, setAppVersion] = useState<string>('');

  // 监听主进程推送的更新状态
  useEffect(() => {
    const handler = (_event: unknown, state: UpdateState) => {
      setUpdateState(state);
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

  const handleCheckUpdate = useCallback(async () => {
    try {
      const result = await window.electronAPI?.app?.checkUpdate();
      if (result && !result.hasUpdate && !result.error) {
        message.info("当前已是最新版本");
      } else if (result?.error) {
        message.error(`检查更新失败: ${result.error}`);
      }
    } catch {
      message.error("检查更新失败");
    }
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      const result = await window.electronAPI?.app?.downloadUpdate?.();
      if (result && !result.success) {
        message.error(result.error || "下载失败");
      }
    } catch {
      message.error("下载更新失败");
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      await window.electronAPI?.app?.installUpdate?.();
    } catch {
      message.error("安装更新失败");
    }
  }, []);

  const renderUpdateSection = () => {
    const { status, version, progress, error } = updateState;

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
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
              下载更新
            </Button>
          </Space>
        );

      case 'downloading':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#52525b' }}>
              正在下载 v{version}...
            </div>
            <Progress
              percent={Math.round(progress?.percent ?? 0)}
              size="small"
              status="active"
            />
          </Space>
        );

      case 'downloaded':
        return (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#15803d' }}>
              v{version} 已下载完成
            </div>
            <Button type="primary" icon={<PoweroffOutlined />} onClick={handleInstall}>
              重启安装
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
        maxWidth: 400,
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
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <RobotOutlined style={{ fontSize: 32, color: "#fff" }} />
        </div>
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
        <div style={{ marginTop: 24 }}>
          {renderUpdateSection()}
        </div>
      </div>
    </div>
  );
}
