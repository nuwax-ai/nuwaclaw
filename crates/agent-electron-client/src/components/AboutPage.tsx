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
        maxWidth: 360,
        margin: "48px auto",
        textAlign: "center",
      }}
    >
      <div
        style={{
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          background: "#fff",
          padding: "32px 24px",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: "#f4f4f5",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <RobotOutlined style={{ fontSize: 22, color: "#52525b" }} />
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 15,
            fontWeight: 600,
            color: "#18181b",
          }}
        >
          Nuwax Agent
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#a1a1aa" }}>
          v{__APP_VERSION__}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 13,
            color: "#71717a",
            lineHeight: 1.6,
          }}
        >
          跨平台 Agent 客户端
        </div>
        <div style={{ marginTop: 16 }}>
          <Button
            icon={<SyncOutlined />}
            onClick={handleCheckUpdate}
            loading={checking}
            size="small"
          >
            检查更新
          </Button>
        </div>
      </div>
    </div>
  );
}
