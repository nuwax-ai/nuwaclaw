#!/usr/bin/env node
/**
 * 根据环境变量生成 src/main/buildFlags.ts
 *
 * 用法：
 *   node scripts/build/generate-build-flags.js          → INJECT_GUI_MCP=false（默认）
 *   NUWAX_INJECT_GUI_MCP=1 node scripts/build/generate-build-flags.js → INJECT_GUI_MCP=true
 */
const fs = require('fs');
const path = require('path');

const injectGuiMcp = process.env.NUWAX_INJECT_GUI_MCP === '1';
const guiMcpUrl = process.env.NUWAX_GUI_MCP_URL || 'http://127.0.0.1:60008/mcp';

const content = `/**
 * 编译时特性开关（由 scripts/build/generate-build-flags.js 生成）
 *
 * 不要手动编辑此文件，修改 generate-build-flags.js 中的逻辑
 */
export const BUILD_FLAGS = {
  /** 是否注入 GUI Agent MCP（临时测试用，正式发布设为 false） */
  INJECT_GUI_MCP: ${injectGuiMcp},
  /** GUI Agent MCP 默认 URL */
  GUI_MCP_URL: "${guiMcpUrl}",
} as const;
`;

const outPath = path.join(__dirname, '..', '..', 'src', 'main', 'buildFlags.ts');
fs.writeFileSync(outPath, content);
console.log(`[build-flags] INJECT_GUI_MCP=${injectGuiMcp}, GUI_MCP_URL=${guiMcpUrl}`);
