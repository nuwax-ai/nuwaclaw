/**
 * 模型页面
 *
 * 独立 Tab 页面，承载 GUIAgentSettings 配置组件。
 * GUIAgentSettings 本是 Modal，设计为 isOpen/onClose 契约；
 * 此处作为独立页面直接渲染，始终保持 open 状态。
 */

import React, { useState } from "react";
import GUIAgentSettings from "../settings/GUIAgentSettings";

export default function ModelPage() {
  // 作为独立页面直接渲染，isOpen 始终为 true，onClose 不需要实际关闭
  const [isOpen] = useState(true);

  return (
    <GUIAgentSettings
      isOpen={isOpen}
      onClose={() => {
        /* 独立 Tab 模式下不需要关闭 */
      }}
    />
  );
}
