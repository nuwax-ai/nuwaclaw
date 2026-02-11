#!/usr/bin/env bash
#
# download-node-installers.sh — 下载 Node.js 官方安装包（MSI/PKG）
#
# 用法: ./scripts/download-node-installers.sh [version]
#

set -euo pipefail

NODE_VERSION="${1:-22.14.0}"
RESOURCE_DIR="crates/agent-tauri-client/src-tauri/resources/installers"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Downloading Node.js v${NODE_VERSION} installers..."

# Windows MSI (x64 and ARM64)
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

# macOS PKG (Universal PKG，包含 both ARM64 and x64)
mkdir -p "${PROJECT_ROOT}/${RESOURCE_DIR}/macos"
echo "==> Downloading macOS PKG (Universal)..."
wget -c "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg" \
     -O "${PROJECT_ROOT}/${RESOURCE_DIR}/macos/node.pkg" 2>/dev/null || \
curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg" \
     -o "${PROJECT_ROOT}/${RESOURCE_DIR}/macos/node.pkg"

# Linux tar.xz (用于二进制安装到 /usr/local)
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

echo "==> Done! Installers saved to ${RESOURCE_DIR}/"
echo "==> Sizes:"
du -sh "${PROJECT_ROOT}/${RESOURCE_DIR}/windows/"*
du -sh "${PROJECT_ROOT}/${RESOURCE_DIR}/macos/"*
du -sh "${PROJECT_ROOT}/${RESOURCE_DIR}/linux/"*
