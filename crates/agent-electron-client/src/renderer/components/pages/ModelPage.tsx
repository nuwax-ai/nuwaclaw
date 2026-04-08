/**
 * 模型页面
 *
 * 独立 Tab 页面，承载 GUIAgentSettings 配置组件。
 * GUIAgentSettings 本是 Modal，设计为 isOpen/onClose 契约；
 * 此处作为独立页面直接渲染，始终保持 open 状态。
 *
 * 当 ENABLE_GUI_AGENT_SERVER=false 时，不渲染 GUI Agent 设置。
 */

import React, { useState } from "react";
import { Result } from "antd";
import GUIAgentSettings from "../settings/GUIAgentSettings";
import { FEATURES } from "@shared/featureFlags";

export default function ModelPage() {
  // 作为独立页面直接渲染，isOpen 始终为 true，onClose 不需要实际关闭
  const [isOpen] = useState(true);

  if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
    return (
      <Result
        status="403"
        title="GUI Agent Server is disabled"
        subTitle="This feature is not available in the current configuration."
      />
    );
  }

  return (
    <GUIAgentSettings
      isOpen={isOpen}
      onClose={() => {
        /* 独立 Tab 模式下不需要关闭 */
      }}
    />
  );
}
