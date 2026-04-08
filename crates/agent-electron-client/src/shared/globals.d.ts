/**
 * Vite define 全局常量声明
 * 由 vite.config.ts define 配置在构建时注入
 */

declare const __APP_VERSION__: string;
declare const __INJECT_GUI_MCP__: string | boolean;
declare const __LOG_FULL_SECRETS__: string | boolean;
declare const __ENABLE_GUI_AGENT_SERVER__: string | boolean;
