/**
 * 开发工具面板
 *
 * 整合所有开发调试工具：
 * - 重置工具（初始化、登录等）
 * - 场景配置管理
 *
 * 注意：此组件仅在开发环境下加载
 */

import React from "react";
import { Space, Tag, Alert, Divider } from "antd";
import { Typography } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import DevResetTools from "./DevResetTools";
import DevSceneManager from "./DevSceneManager";
import DevStoreViewer from "./DevStoreViewer";

const { Title } = Typography;

/**
 * 开发工具面板组件
 */
export default function DevToolsPanel() {
  return (
    <div className="dev-tools-panel">
      {/* 标题区域 */}
      <Divider orientation="left">
        <Space>
          <ToolOutlined style={{ color: "#faad14" }} />
          <span>开发工具</span>
          <Tag color="orange">DEV</Tag>
        </Space>
      </Divider>

      {/* 警告提示 */}
      <Alert
        message="开发模式"
        description="以下工具仅在开发环境可见，生产环境不会加载此模块"
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 工具区域 */}
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {/* 重置工具 */}
        <DevResetTools />

        {/* 场景配置管理 */}
        <DevSceneManager />

        {/* Store 数据查看器 */}
        <DevStoreViewer />
      </Space>

      {/* 样式 */}
      <style>{`
        .dev-tools-panel {
          margin-top: 24px;
          padding-top: 16px;
          border-top: 2px dashed #faad14;
        }
      `}</style>
    </div>
  );
}
