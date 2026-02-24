/**
 * 关于页面 (Electron 版)
 *
 * 从 Tauri 版 AboutPage 适配而来:
 * - 版本号通过 Vite define 注入
 * - 检查更新按钮
 */

import React, { useState } from "react";
import { Button, message } from "antd";
import { RobotOutlined, SyncOutlined } from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "../commons/constants";

declare const __APP_VERSION__: string;

export default function AboutPage() {
  const [checking, setChecking] = useState(false);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const result = await window.electronAPI?.app?.checkUpdate();
      if (result?.hasUpdate) {
        message.success(`发现新版本: v${result.version}`);
      } else {
        message.info("当前已是最新版本");
      }
    } catch {
      message.info("当前已是最新版本");
    } finally {
      setChecking(false);
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
          v{__APP_VERSION__}
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
          <Button
            icon={<SyncOutlined />}
            onClick={handleCheckUpdate}
            loading={checking}
          >
            检查更新
          </Button>
        </div>
      </div>
    </div>
  );
}
