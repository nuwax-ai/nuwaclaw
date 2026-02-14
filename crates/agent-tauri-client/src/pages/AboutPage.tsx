/**
 * 关于页面
 */

import React, { useState } from "react";
import { Button } from "antd";
import { RobotOutlined, SyncOutlined } from "@ant-design/icons";
import { checkForAppUpdate } from "../services/updater";
import { useAppInfo } from "../hooks/useAppInfo";

export default function AboutPage() {
  const { appName, appVersion } = useAppInfo();
  const [checking, setChecking] = useState(false);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await checkForAppUpdate(true);
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
          {appName}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#a1a1aa" }}>
          {appVersion ? `v${appVersion}` : ""}
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
        <Button
          type="default"
          size="small"
          icon={<SyncOutlined />}
          loading={checking}
          onClick={handleCheckUpdate}
          style={{ marginTop: 16 }}
        >
          检查更新
        </Button>
      </div>
    </div>
  );
}
