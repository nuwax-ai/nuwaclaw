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

// Vite define 替换后的值类型（'true' 或 'false'）
type ViteFlag = "true" | "false";

function getFeatureFlag(
  viteFlag: ViteFlag | string | undefined,
  envKey: string,
): boolean {
  // 渲染进程：Vite define 替换 __XXX__ 为 'true' 或 'false'
  if (typeof viteFlag !== "undefined") {
    return viteFlag === "true";
  }
  // 主进程：使用 process.env
  if (typeof process !== "undefined" && process?.env?.[envKey]) {
    return process.env[envKey] === "true";
  }
  // 默认值
  return false;
}

export const FEATURES = {
  INJECT_GUI_MCP: getFeatureFlag(
    typeof __INJECT_GUI_MCP__ !== "undefined" ? __INJECT_GUI_MCP__ : undefined,
    "INJECT_GUI_MCP",
  ),
  LOG_FULL_SECRETS: getFeatureFlag(
    typeof __LOG_FULL_SECRETS__ !== "undefined"
      ? __LOG_FULL_SECRETS__
      : undefined,
    "NUWAX_AGENT_LOG_FULL_SECRETS",
  ),
  ENABLE_GUI_AGENT_SERVER: getFeatureFlag(
    typeof __ENABLE_GUI_AGENT_SERVER__ !== "undefined"
      ? __ENABLE_GUI_AGENT_SERVER__
      : undefined,
    "ENABLE_GUI_AGENT_SERVER",
  ),
} as const;

export type FeatureFlag = keyof typeof FEATURES;
