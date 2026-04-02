/**
 * Feature Flags - 统一管理功能开关
 *
 * 通过 .env.development / .env.production 文件配置环境变量:
 * - 开发模式: npm run dev (dotenv 加载 .env.development)
 * - 生产构建: npm run build (dotenv 加载 .env.production)
 *
 * @example
 * import { FEATURES } from '@shared/featureFlags';
 * if (FEATURES.INJECT_GUI_MCP) {
 *   // ...
 * }
 */

import "dotenv/config";

// ========== 开发环境配置 ==========
const DEV_FLAGS = {
  INJECT_GUI_MCP: process.env.INJECT_GUI_MCP === "true",
  LOG_FULL_SECRETS: process.env.NUWAX_AGENT_LOG_FULL_SECRETS === "true",
} as const;

// ========== 生产环境配置 ==========
const PROD_FLAGS = {
  INJECT_GUI_MCP: false, // 生产默认关闭
  LOG_FULL_SECRETS: false, // 生产默认脱敏
} as const;

// ========== 根据环境导出 ==========
export const FEATURES =
  process.env.NODE_ENV === "production" ? PROD_FLAGS : DEV_FLAGS;

export type FeatureFlag = keyof typeof FEATURES;
