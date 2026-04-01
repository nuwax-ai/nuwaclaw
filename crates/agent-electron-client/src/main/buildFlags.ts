/**
 * 编译时特性开关（由 scripts/build/generate-build-flags.js 生成）
 *
 * 不要手动编辑此文件，修改 generate-build-flags.js 中的逻辑
 */
export const BUILD_FLAGS = {
  /** 是否注入 GUI Agent MCP（临时测试用，正式发布设为 false） */
  INJECT_GUI_MCP: true,
  /** GUI Agent MCP 默认 URL */
  GUI_MCP_URL: "http://127.0.0.1:60008/mcp",
} as const;
