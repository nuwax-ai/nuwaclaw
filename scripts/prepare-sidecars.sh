#!/bin/bash
# 为当前 host triple 准备 sidecar 二进制（mcp-proxy / node-runtime）
#
# 仅处理当前主机平台，不做跨平台下载。
# 目标目录: crates/agent-tauri-client/src-tauri/binaries
#
# 用法:
#   ./scripts/prepare-sidecars.sh
#   ./scripts/prepare-sidecars.sh --force

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/crates/agent-tauri-client/src-tauri/binaries"
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
OS="$(uname -s)"

mkdir -p "$BIN_DIR"

has_file() {
  [[ -f "$1" ]]
}

copy_if_needed() {
  local src="$1"
  local dst="$2"
  if [[ $FORCE -eq 0 && -f "$dst" ]]; then
    echo "SKIP $dst (已存在)"
    return 0
  fi
  cp -f "$src" "$dst"
  chmod +x "$dst" || true
  echo "COPY $src -> $dst"
}

pick_first_existing() {
  for p in "$@"; do
    if [[ -f "$p" ]]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

node_ext=""
mcp_ext=""
if [[ "$TARGET" == *windows* ]]; then
  node_ext=".exe"
  mcp_ext=".exe"
fi

NODE_DST="$BIN_DIR/node-runtime-${TARGET}${node_ext}"
MCP_DST="$BIN_DIR/mcp-proxy-${TARGET}${mcp_ext}"

echo "target: $TARGET"
echo "bin dir: $BIN_DIR"
echo ""

# 1) node-runtime
NODE_SRC=""
if [[ "$OS" == "Darwin" || "$OS" == "Linux" ]]; then
  NODE_SRC="$(pick_first_existing \
    "$ROOT_DIR/crates/agent-tauri-client/src-tauri/resources/node/bin/node" \
    "$HOME/Library/Application Support/com.nuwax.agent-tauri-client/runtime/node/bin/node" \
    "$HOME/.local/bin/node" \
    "$(command -v node 2>/dev/null || true)" \
  )" || true
else
  NODE_SRC="$(pick_first_existing \
    "$ROOT_DIR/crates/agent-tauri-client/src-tauri/resources/node/bin/node.exe" \
    "$APPDATA/com.nuwax.agent-tauri-client/runtime/node/bin/node.exe" \
    "$(command -v node.exe 2>/dev/null || true)" \
  )" || true
fi

if [[ -n "$NODE_SRC" && -f "$NODE_SRC" ]]; then
  copy_if_needed "$NODE_SRC" "$NODE_DST"
else
  echo "WARN 未找到 node-runtime 源文件，跳过"
fi

# 2) mcp-proxy
MCP_SRC=""
if [[ "$OS" == "Darwin" || "$OS" == "Linux" ]]; then
  MCP_SRC="$(pick_first_existing \
    "$HOME/Library/Application Support/com.nuwax.agent-tauri-client/node_modules/mcp-stdio-proxy/node_modules/.bin_real/mcp-proxy" \
    "$HOME/.local/lib/node_modules/mcp-stdio-proxy/node_modules/.bin_real/mcp-proxy" \
    "$HOME/.local/lib/node_modules/mcp-stdio-proxy/node_modules/.bin_real/mcp-proxy.exe" \
    "$HOME/.local/bin/mcp-proxy" \
    "$(command -v mcp-proxy 2>/dev/null || true)" \
  )" || true
else
  MCP_SRC="$(pick_first_existing \
    "$APPDATA/com.nuwax.agent-tauri-client/node_modules/mcp-stdio-proxy/node_modules/.bin_real/mcp-proxy.exe" \
    "$APPDATA/npm/node_modules/mcp-stdio-proxy/node_modules/.bin_real/mcp-proxy.exe" \
    "$(command -v mcp-proxy.exe 2>/dev/null || true)" \
  )" || true
fi

if [[ -n "$MCP_SRC" && -f "$MCP_SRC" ]]; then
  copy_if_needed "$MCP_SRC" "$MCP_DST"
else
  echo "WARN 未找到 mcp-proxy 源文件，跳过"
fi

echo ""
echo "完成。建议执行: ./scripts/check-sidecars.sh"
