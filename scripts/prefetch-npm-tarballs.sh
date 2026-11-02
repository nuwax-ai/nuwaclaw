#!/bin/bash
# 预下载 npm 包 tarball 到本地目录，便于后续离线/半离线安装
#
# 用法:
#   ./scripts/prefetch-npm-tarballs.sh
#   ./scripts/prefetch-npm-tarballs.sh --out /tmp/nuwax-npm-tarballs
#   ./scripts/prefetch-npm-tarballs.sh --registry https://registry.npmmirror.com/
#   ./scripts/prefetch-npm-tarballs.sh --package nuwax-file-server --package mcp-stdio-proxy

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_OUT="$ROOT_DIR/.cache/npm-tarballs"
OUT_DIR="$DEFAULT_OUT"
REGISTRY="${NUWAX_NPM_REGISTRY:-https://registry.npmmirror.com/}"
DRY_RUN=0
PACKAGES=()

DEFAULT_PACKAGES=(
  "mcp-stdio-proxy"
  "nuwax-file-server"
  "nuwaxcode"
  "claude-code-acp-ts"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --registry)
      REGISTRY="${2:-}"
      shift 2
      ;;
    --package)
      PACKAGES+=("${2:-}")
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  PACKAGES=("${DEFAULT_PACKAGES[@]}")
fi

mkdir -p "$OUT_DIR"

echo "npm tarball 预下载目录: $OUT_DIR"
echo "registry: $REGISTRY"
echo "packages: ${PACKAGES[*]}"
echo ""

for pkg in "${PACKAGES[@]}"; do
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY  npm pack \"$pkg\" --pack-destination \"$OUT_DIR\" --registry \"$REGISTRY\""
    continue
  fi

  echo ">>> downloading $pkg"
  npm pack "$pkg" --pack-destination "$OUT_DIR" --registry "$REGISTRY"
done

echo ""
echo "完成，已下载到: $OUT_DIR"
ls -1 "$OUT_DIR" | sed 's/^/  - /'
