/**
 * 模型页面
 *
 * 独立 Tab 页面，承载 GUIAgentSettings 配置组件。
 * GUIAgentSettings 本是 Modal，设计为 isOpen/onClose 契约；
 * 此处作为独立页面直接渲染，始终保持 open 状态。
 *
 * 当 ENABLE_GUI_AGENT_SERVER=false 时，不渲染 GUI Agent 设置。
 */

import React, { useState, useEffect } from "react";
import { Result } from "antd";
import GUIAgentSettings from "../settings/GUIAgentSettings";
import { FEATURES } from "@shared/featureFlags";

export default function ModelPage() {
  // 作为独立页面直接渲染，isOpen 始终为 true，onClose 不需要实际关闭
  const [isOpen] = useState(true);

  // DEBUG: 打印 FEATURES 值到控制台
  useEffect(() => {
    console.log(
      "[DEBUG ModelPage] FEATURES.ENABLE_GUI_AGENT_SERVER =",
      FEATURES.ENABLE_GUI_AGENT_SERVER,
    );
    console.log(
      "[DEBUG ModelPage] FEATURES.INJECT_GUI_MCP =",
      FEATURES.INJECT_GUI_MCP,
    );
    console.log(
      "[DEBUG ModelPage] FEATURES.LOG_FULL_SECRETS =",
      FEATURES.LOG_FULL_SECRETS,
    );
  }, []);

  if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
    return (
      <Result
        status="403"
        title="GUI Agent Server is disabled"
        subTitle={
          <div>
            <p>This feature is not available in the current configuration.</p>
            <p style={{ color: "red", marginTop: 16, fontWeight: "bold" }}>
              [DEBUG] FEATURES.ENABLE_GUI_AGENT_SERVER ={" "}
              {String(FEATURES.ENABLE_GUI_AGENT_SERVER)}
            </p>
          </div>
        }
      />
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          color: "green",
          fontWeight: "bold",
          marginBottom: 16,
          padding: 8,
          background: "#e8f5e9",
          borderRadius: 4,
        }}
      >
        [DEBUG] FEATURES.ENABLE_GUI_AGENT_SERVER ={" "}
        {String(FEATURES.ENABLE_GUI_AGENT_SERVER)} ✓
      </div>
      <GUIAgentSettings
        isOpen={isOpen}
        onClose={() => {
          /* 独立 Tab 模式下不需要关闭 */
        }}
      />
    </div>
  );
}
