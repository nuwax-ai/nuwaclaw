/**
 * Feature Flags - 统一管理功能开关
 *
 * 通过 .env.development / .env.production 文件配置环境变量:
 * - 开发模式 (npm run dev): INJECT_GUI_MCP=true, LOG_FULL_SECRETS=true, ENABLE_GUI_AGENT_SERVER=true
 * - 生产构建 (npm run build): INJECT_GUI_MCP=false, LOG_FULL_SECRETS=false, ENABLE_GUI_AGENT_SERVER=false
 *
 * 注意: featureFlags.ts 属于主进程代码 (tsc 编译)，不受 Vite define 影响，
 *       直接使用 process.env 读取环境变量。
 *
 * @example
 * import { FEATURES } from '@shared/featureFlags';
 * if (FEATURES.INJECT_GUI_MCP) {
 *   // ...
 * }
 */

export const FEATURES = {
  INJECT_GUI_MCP: process.env.INJECT_GUI_MCP === "true",
  LOG_FULL_SECRETS: process.env.NUWAX_AGENT_LOG_FULL_SECRETS === "true",
  ENABLE_GUI_AGENT_SERVER: process.env.ENABLE_GUI_AGENT_SERVER === "true",
} as const;

export type FeatureFlag = keyof typeof FEATURES;
