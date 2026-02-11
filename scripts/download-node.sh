#!/usr/bin/env bash
#
# download-node.sh — 下载 Node.js 到 Tauri 资源目录
#
# 用法:
#   ./scripts/download-node.sh                    # 自动检测当前平台
#   ./scripts/download-node.sh darwin arm64       # 指定平台和架构
#   ./scripts/download-node.sh linux x64
#   ./scripts/download-node.sh win x64
#
# 支持平台/架构:
#   darwin  arm64 | x64
#   linux   x64   | arm64
#   win     x64
#

set -euo pipefail

NODE_VERSION="22.14.0"
RESOURCE_DIR="crates/agent-tauri-client/src-tauri/resources/node"

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${PROJECT_ROOT}/${RESOURCE_DIR}"

# === 平台检测 ===

detect_platform() {
  local uname_s
  uname_s="$(uname -s)"
  case "${uname_s}" in
    Darwin) echo "darwin" ;;
    Linux)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *) echo "unsupported"; return 1 ;;
  esac
}

detect_arch() {
  local uname_m
  uname_m="$(uname -m)"
  case "${uname_m}" in
    x86_64|amd64)  echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "unsupported"; return 1 ;;
  esac
}

PLATFORM="${1:-$(detect_platform)}"
ARCH="${2:-$(detect_arch)}"

echo "==> Node.js v${NODE_VERSION} for ${PLATFORM}-${ARCH}"

# === 构建下载 URL ===

if [ "${PLATFORM}" = "win" ]; then
  FILENAME="node-v${NODE_VERSION}-win-${ARCH}.zip"
  URL="https://nodejs.org/dist/v${NODE_VERSION}/${FILENAME}"
else
  FILENAME="node-v${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.xz"
  URL="https://nodejs.org/dist/v${NODE_VERSION}/${FILENAME}"
fi

# === 检查是否已下载 ===

NODE_BIN="${TARGET_DIR}/bin/node"
if [ "${PLATFORM}" = "win" ]; then
  NODE_BIN="${TARGET_DIR}/node.exe"
fi

if [ -f "${NODE_BIN}" ]; then
  EXISTING_VERSION="$("${NODE_BIN}" --version 2>/dev/null || true)"
  if [ "${EXISTING_VERSION}" = "v${NODE_VERSION}" ]; then
    # macOS: 还需验证架构匹配，避免 universal 构建时跳过不同架构的下载
    if [ "${PLATFORM}" = "darwin" ]; then
      case "${ARCH}" in
        arm64) EXPECTED_ARCH="arm64" ;;
        x64)   EXPECTED_ARCH="x86_64" ;;
      esac
      ACTUAL_ARCH="$(file "${NODE_BIN}" | grep -oE 'arm64|x86_64' | head -1 || true)"
      if [ "${ACTUAL_ARCH}" != "${EXPECTED_ARCH}" ]; then
        echo "==> Node.js v${NODE_VERSION} exists but architecture mismatch (have ${ACTUAL_ARCH}, need ${EXPECTED_ARCH}), re-downloading..."
      else
        echo "==> Node.js v${NODE_VERSION} (${ARCH}) already exists at ${TARGET_DIR}, skipping download"
        exit 0
      fi
    else
      echo "==> Node.js v${NODE_VERSION} already exists at ${TARGET_DIR}, skipping download"
      exit 0
    fi
  fi
fi

# === 下载 ===

TMPDIR_DL="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_DL}"' EXIT

echo "==> Downloading ${URL}"
if command -v curl &>/dev/null; then
  curl -fSL --progress-bar -o "${TMPDIR_DL}/${FILENAME}" "${URL}"
elif command -v wget &>/dev/null; then
  wget -q --show-progress -O "${TMPDIR_DL}/${FILENAME}" "${URL}"
else
  echo "Error: curl or wget required" >&2
  exit 1
fi

# === 解压 ===

echo "==> Extracting..."
EXTRACT_DIR="${TMPDIR_DL}/extracted"
mkdir -p "${EXTRACT_DIR}"

if [ "${PLATFORM}" = "win" ]; then
  # Windows: 尝试多种解压方式
  if command -v unzip &>/dev/null; then
    unzip -q "${TMPDIR_DL}/${FILENAME}" -d "${EXTRACT_DIR}"
  elif command -v pwsh &>/dev/null || command -v powershell &>/dev/null; then
    # PowerShell 7+ 支持 tar 格式
    pwsh -Command "Expand-Archive -Path '${TMPDIR_DL}/${FILENAME}' -DestinationPath '${EXTRACT_DIR}' -Force" 2>/dev/null || \
    powershell -Command "Expand-Archive -Path '${TMPDIR_DL}/${FILENAME}' -DestinationPath '${EXTRACT_DIR}' -Force"
  elif command -v tar &>/dev/null; then
    # 某些 Windows 环境下的 tar 也可以处理 zip
    tar -xf "${TMPDIR_DL}/${FILENAME}" -C "${EXTRACT_DIR}"
  else
    echo "Error: No extraction tool available (unzip, powershell, or tar)" >&2
    exit 1
  fi
  INNER_DIR="${EXTRACT_DIR}/node-v${NODE_VERSION}-win-${ARCH}"
else
  tar -xf "${TMPDIR_DL}/${FILENAME}" -C "${EXTRACT_DIR}"
  INNER_DIR="${EXTRACT_DIR}/node-v${NODE_VERSION}-${PLATFORM}-${ARCH}"
fi

if [ ! -d "${INNER_DIR}" ]; then
  echo "Error: Expected directory ${INNER_DIR} not found after extraction" >&2
  exit 1
fi

# === 复制到资源目录（仅 bin/ 和 lib/） ===

echo "==> Installing to ${TARGET_DIR}"
rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

if [ "${PLATFORM}" = "win" ]; then
  # Windows: Node.js 发行包没有 bin/ 子目录，需要手动创建以匹配 tauri.conf.json 的 resources 路径
  mkdir -p "${TARGET_DIR}/bin"
  # 复制可执行文件到 bin/ 目录
  cp "${INNER_DIR}/node.exe" "${TARGET_DIR}/bin/"
  for exe in npm npm.cmd npx npx.cmd corepack corepack.cmd; do
    if [ -f "${INNER_DIR}/${exe}" ]; then
      cp "${INNER_DIR}/${exe}" "${TARGET_DIR}/bin/"
    fi
  done
  # 复制 node_modules（npm 等工具需要）
  if [ -d "${INNER_DIR}/node_modules" ]; then
    mkdir -p "${TARGET_DIR}/lib"
    cp -r "${INNER_DIR}/node_modules" "${TARGET_DIR}/lib/node_modules"
  fi
else
  # Unix: 只保留 bin/ 和 lib/（使用 cp -a 保留符号链接）
  cp -a "${INNER_DIR}/bin" "${TARGET_DIR}/bin"
  if [ -d "${INNER_DIR}/lib" ]; then
    cp -a "${INNER_DIR}/lib" "${TARGET_DIR}/lib"
  fi

  # 确保可执行权限
  chmod 755 "${TARGET_DIR}/bin/node"
  for bin in npm npx corepack; do
    if [ -f "${TARGET_DIR}/bin/${bin}" ]; then
      chmod 755 "${TARGET_DIR}/bin/${bin}"
    fi
  done
fi

# === 验证 ===

echo "==> Verifying installation..."
if [ "${PLATFORM}" = "win" ]; then
  echo "    (skipping verification on Windows — cross-platform build)"
else
  INSTALLED_VERSION="$("${TARGET_DIR}/bin/node" --version)"
  if [ "${INSTALLED_VERSION}" = "v${NODE_VERSION}" ]; then
    echo "==> OK: Node.js ${INSTALLED_VERSION}"
  else
    echo "Error: Expected v${NODE_VERSION}, got ${INSTALLED_VERSION}" >&2
    exit 1
  fi
fi

# === 输出大小统计 ===

echo "==> Size:"
du -sh "${TARGET_DIR}/bin" 2>/dev/null || true
du -sh "${TARGET_DIR}/lib" 2>/dev/null || true
du -sh "${TARGET_DIR}" | sed 's/\t/ /' | awk '{print "    Total: " $1}'

echo "==> Done"
