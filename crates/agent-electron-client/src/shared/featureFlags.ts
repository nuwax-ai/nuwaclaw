/**
 * Feature Flags - 统一管理功能开关
 *
 * 通过 .env.development / .env.production 文件配置环境变量:
 * - 开发模式 (npm run dev): INJECT_GUI_MCP=true, LOG_FULL_SECRETS=true, ENABLE_GUI_AGENT_SERVER=true
 * - 生产构建 (npm run build): INJECT_GUI_MCP=false, LOG_FULL_SECRETS=false, ENABLE_GUI_AGENT_SERVER=false
 *
 * 渲染进程 (Vite 打包): 使用 vite.config.ts define 静态替换 __XXX__ 变量
 * 主进程 (tsc 编译): 直接使用 process.env 读取环境变量
 *
 * @example
 * import { FEATURES } from '@shared/featureFlags';
 * if (FEATURES.INJECT_GUI_MCP) {
 *   // ...
 * }
 */

// 渲染进程：Vite define 只能替换静态标识符，不能替换动态 globalThis["__X__"] 访问。
// 这里使用 typeof + 静态常量名，保证：
// 1) 渲染进程可被 Vite 正确注入；
// 2) 主进程未注入时不会抛 ReferenceError。
function getViteFlagInjectGuiMcp(): boolean {
  return (
    typeof __INJECT_GUI_MCP__ !== "undefined" &&
    (__INJECT_GUI_MCP__ === true || __INJECT_GUI_MCP__ === "true")
  );
}

function getViteFlagLogFullSecrets(): boolean {
  return (
    typeof __LOG_FULL_SECRETS__ !== "undefined" &&
    (__LOG_FULL_SECRETS__ === true || __LOG_FULL_SECRETS__ === "true")
  );
}

function getViteFlagEnableGuiAgentServer(): boolean {
  return (
    typeof __ENABLE_GUI_AGENT_SERVER__ !== "undefined" &&
    (__ENABLE_GUI_AGENT_SERVER__ === true ||
      __ENABLE_GUI_AGENT_SERVER__ === "true")
  );
}

function getProcessFlag(envKey: string): boolean {
  try {
    return process?.env?.[envKey] === "true";
  } catch {
    return false;
  }
}

export const FEATURES = {
  INJECT_GUI_MCP: getViteFlagInjectGuiMcp() || getProcessFlag("INJECT_GUI_MCP"),
  LOG_FULL_SECRETS:
    getViteFlagLogFullSecrets() ||
    getProcessFlag("NUWAX_AGENT_LOG_FULL_SECRETS"),
  ENABLE_GUI_AGENT_SERVER:
    getViteFlagEnableGuiAgentServer() ||
    getProcessFlag("ENABLE_GUI_AGENT_SERVER"),
} as const;

export type FeatureFlag = keyof typeof FEATURES;
