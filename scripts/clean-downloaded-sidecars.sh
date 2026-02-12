#!/bin/bash
# 清理本地下载的 sidecar（二进制缓存），保留仓库内置的 nuwax-lanproxy
#
# 用法:
#   ./scripts/clean-downloaded-sidecars.sh
#   ./scripts/clean-downloaded-sidecars.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/crates/agent-tauri-client/src-tauri/binaries"
CACHE_DIR="$ROOT_DIR/.cache/sidecars"

DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 2
      ;;
  esac
done

targets=()
if [[ -d "$BIN_DIR" ]]; then
  targets+=(
    "$BIN_DIR"/mcp-proxy-*
    "$BIN_DIR"/node-runtime-*
    "$BIN_DIR"/sidecar-download-manifest.txt
  )
fi
if [[ -d "$CACHE_DIR" ]]; then
  targets+=(
    "$CACHE_DIR"/mcp-proxy-*
    "$CACHE_DIR"/node-runtime-*
    "$CACHE_DIR"/sidecar-download-manifest.txt
  )
fi

echo "清理目录: $BIN_DIR"
echo "清理目录: $CACHE_DIR"
removed=0
for f in "${targets[@]}"; do
  if [[ -e "$f" ]]; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "DRY  rm -f $f"
    else
      rm -f "$f"
      echo "REMOVED $f"
    fi
    removed=$((removed + 1))
  fi
done

if [[ $removed -eq 0 ]]; then
  echo "没有可清理的下载产物"
else
  echo "完成，处理文件数: $removed"
fi
