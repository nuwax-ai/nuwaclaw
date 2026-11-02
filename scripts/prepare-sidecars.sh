#!/bin/bash
# prepare-sidecars.sh — 此脚本已弃用
#
# Electron 使用 npm 脚本准备 sidecar 二进制：
#   cd crates/agent-electron-client
#   npm run prepare           # 准备所有
#   npm run prepare:node      # 仅 Node.js
#   npm run prepare:uv        # 仅 uv
#   npm run prepare:mcp-proxy # 仅 mcp-proxy
#   npm run prepare:lanproxy  # 仅 lanproxy
#   npm run prepare:nuwaxcode # 仅 nuwaxcode

echo "警告: 此脚本已弃用"
echo ""
echo "请使用 Electron 的 npm prepare 脚本："
echo "  cd crates/agent-electron-client"
echo "  npm run prepare"
echo ""
