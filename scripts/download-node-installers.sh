#!/usr/bin/env bash
#
# download-node-installers.sh — 下载 Node.js 官方安装包（MSI/PKG）
#
# 用法: ./scripts/download-node-installers.sh [version] [platform]
#   platform: all | macos | windows | linux (默认: all)
#
# 示例:
#   ./scripts/download-node-installers.sh              # 下载所有平台
#   ./scripts/download-node-installers.sh 22.14.0 macos  # 只下载 macOS
#

set -euo pipefail

NODE_VERSION="${1:-22.14.0}"
PLATFORM="${2:-all}"
RESOURCE_DIR="crates/agent-tauri-client/src-tauri/resources/installers"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Downloading Node.js v${NODE_VERSION} installers for platform: ${PLATFORM}..."

# Windows MSI (x64 and ARM64)
download_windows() {
  mkdir -p "${PROJECT_ROOT}/${RESOURCE_DIR}/windows"
  echo "==> Downloading Windows MSI (x64)..."
  wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-x64.msi" \
       -O "${PROJECT_ROOT}/${RESOURCE_DIR}/windows/node-x64.msi" 2>/dev/null || \
  curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-x64.msi" \
       -o "${PROJECT_ROOT}/${RESOURCE_DIR}/windows/node-x64.msi"

  echo "==> Downloading Windows MSI (ARM64)..."
  wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-arm64.msi" \
       -O "${PROJECT_ROOT}/${RESOURCE_DIR}/windows/node-arm64.msi" 2>/dev/null || \
  curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-arm64.msi" \
       -o "${PROJECT_ROOT}/${RESOURCE_DIR}/windows/node-arm64.msi"
}

# macOS PKG (Universal PKG)
download_macos() {
  mkdir -p "${PROJECT_ROOT}/${RESOURCE_DIR}/macos"
  echo "==> Downloading macOS PKG (Universal)..."
  wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg" \
       -O "${PROJECT_ROOT}/${RESOURCE_DIR}/macos/node.pkg" 2>/dev/null || \
  curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg" \
       -o "${PROJECT_ROOT}/${RESOURCE_DIR}/macos/node.pkg"
}

# Linux tar.xz
download_linux() {
  mkdir -p "${PROJECT_ROOT}/${RESOURCE_DIR}/linux"
  echo "==> Downloading Linux tar.xz (x64)..."
  wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
       -O "${PROJECT_ROOT}/${RESOURCE_DIR}/linux/node-x64.tar.xz" 2>/dev/null || \
  curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
       -o "${PROJECT_ROOT}/${RESOURCE_DIR}/linux/node-x64.tar.xz"

  echo "==> Downloading Linux tar.xz (ARM64)..."
  wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" \
       -O "${PROJECT_ROOT}/${RESOURCE_DIR}/linux/node-arm64.tar.xz" 2>/dev/null || \
  curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" \
       -o "${PROJECT_ROOT}/${RESOURCE_DIR}/linux/node-arm64.tar.xz"
}

# 根据平台参数下载
case "${PLATFORM}" in
  macos|darwin)
    download_macos
    ;;
  windows|win)
    download_windows
    ;;
  linux)
    download_linux
    ;;
  all|"")
    download_windows
    download_macos
    download_linux
    ;;
  *)
    echo "Error: Unknown platform '${PLATFORM}'. Use: all, macos, windows, linux" >&2
    exit 1
    ;;
esac

echo "==> Done! Installers saved to ${RESOURCE_DIR}/"
