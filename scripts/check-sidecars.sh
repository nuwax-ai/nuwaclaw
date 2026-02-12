#!/bin/bash
# 检查 Tauri sidecar 二进制是否齐全
#
# 用法:
#   ./scripts/check-sidecars.sh
#   ./scripts/check-sidecars.sh --target x86_64-pc-windows-msvc
#   ./scripts/check-sidecars.sh --all-common
#   ./scripts/check-sidecars.sh --component mcp-proxy --component node-runtime
#   ./scripts/check-sidecars.sh --downloaded-only
#   ./scripts/check-sidecars.sh --dir .cache/sidecars --downloaded-only --all-common

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/crates/agent-tauri-client/src-tauri/binaries"
CHECK_DIR="$BIN_DIR"

TARGET=""
TARGETS=()
COMPONENTS=()
DOWNLOADED_ONLY=0
ALL_COMMON=0

COMMON_TARGETS=(
  "x86_64-pc-windows-msvc"
  "aarch64-pc-windows-msvc"
  "x86_64-apple-darwin"
  "aarch64-apple-darwin"
  "x86_64-unknown-linux-gnu"
  "aarch64-unknown-linux-gnu"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGETS+=("${2:-}")
      shift 2
      ;;
    --all-common)
      ALL_COMMON=1
      shift 1
      ;;
    --component)
      COMPONENTS+=("${2:-}")
      shift 2
      ;;
    --downloaded-only)
      DOWNLOADED_ONLY=1
      shift 1
      ;;
    --dir)
      CHECK_DIR="${2:-}"
      shift 2
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

if [[ $ALL_COMMON -eq 1 ]]; then
  TARGETS=("${COMMON_TARGETS[@]}")
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("$(rustc -vV | awk '/^host:/ {print $2}')")
fi

if [[ ${#COMPONENTS[@]} -eq 0 && $DOWNLOADED_ONLY -eq 1 ]]; then
  COMPONENTS=("mcp-proxy" "node-runtime")
fi

if [[ ${#COMPONENTS[@]} -eq 0 ]]; then
  COMPONENTS=("nuwax-lanproxy" "mcp-proxy" "node-runtime")
fi

if [[ ! -d "$CHECK_DIR" ]]; then
  echo "目录不存在: $CHECK_DIR" >&2
  exit 1
fi

expected_filename() {
  local component="$1"
  local target="$2"
  local ext=""
  if [[ "$target" == *windows* ]]; then
    ext=".exe"
  fi
  echo "${component}-${target}${ext}"
}

total_missing=0
for TARGET in "${TARGETS[@]}"; do
  echo "检查目标: $TARGET"
  echo "检查目录: $CHECK_DIR"
  echo "组件: ${COMPONENTS[*]}"
  echo ""

  missing=0
  for component in "${COMPONENTS[@]}"; do
    fname="$(expected_filename "$component" "$TARGET")"
    fpath="$CHECK_DIR/$fname"
    if [[ -f "$fpath" ]]; then
      echo "OK   $fname"
    else
      echo "MISS $fname"
      missing=$((missing + 1))
      total_missing=$((total_missing + 1))
    fi
  done

  echo ""
  if [[ $missing -gt 0 ]]; then
    echo "目标 $TARGET 缺失 sidecar 文件数量: $missing"
  else
    echo "目标 $TARGET sidecar 文件检查通过"
  fi
  echo ""
done

if [[ $total_missing -gt 0 ]]; then
  echo "总缺失 sidecar 文件数量: $total_missing"
  exit 1
fi

echo "所有目标 sidecar 文件检查通过"
