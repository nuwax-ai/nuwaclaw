/**
 * 关于页面
 */

import React from "react";
import { RobotOutlined } from "@ant-design/icons";

export default function AboutPage() {
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
          NuWax Agent
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#a1a1aa" }}>
          v0.1.0
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
          <br />
          远程桌面控制 · AI 编程助手集成
        </div>
      </div>
    </div>
  );
}
