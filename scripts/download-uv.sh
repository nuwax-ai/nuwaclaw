#!/usr/bin/env bash
#
# download-uv.sh — 下载 uv 到 Tauri 资源目录
#
# 用法:
#   ./scripts/download-uv.sh                    # 自动检测当前平台
#   ./scripts/download-uv.sh darwin arm64       # 指定平台和架构
#   ./scripts/download-uv.sh linux x64
#   ./scripts/download-uv.sh win x64
#
# 支持平台/架构:
#   darwin  arm64 | x64
#   linux   x64   | arm64
#   win     x64
#

set -euo pipefail

UV_VERSION="0.10.0"
RESOURCE_DIR="crates/agent-tauri-client/src-tauri/resources/uv"

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

echo "==> uv v${UV_VERSION} for ${PLATFORM}-${ARCH}"

# === 构建下载 URL ===

# 映射到 uv release target 名称
case "${PLATFORM}-${ARCH}" in
  darwin-arm64)  UV_TARGET="uv-aarch64-apple-darwin" ;;
  darwin-x64)    UV_TARGET="uv-x86_64-apple-darwin" ;;
  linux-x64)     UV_TARGET="uv-x86_64-unknown-linux-gnu" ;;
  linux-arm64)   UV_TARGET="uv-aarch64-unknown-linux-gnu" ;;
  win-x64)       UV_TARGET="uv-x86_64-pc-windows-msvc" ;;
  *) echo "Error: unsupported platform-arch: ${PLATFORM}-${ARCH}" >&2; exit 1 ;;
esac

if [ "${PLATFORM}" = "win" ]; then
  FILENAME="${UV_TARGET}.zip"
else
  FILENAME="${UV_TARGET}.tar.gz"
fi

URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${FILENAME}"

# === 检查是否已下载 ===

UV_BIN="${TARGET_DIR}/bin/uv"
if [ "${PLATFORM}" = "win" ]; then
  UV_BIN="${TARGET_DIR}/bin/uv.exe"
fi

if [ -f "${UV_BIN}" ]; then
  EXISTING_VERSION="$("${UV_BIN}" --version 2>/dev/null | awk '{print $2}' || true)"
  if [ "${EXISTING_VERSION}" = "${UV_VERSION}" ]; then
    if [ "${PLATFORM}" = "darwin" ]; then
      case "${ARCH}" in
        arm64) EXPECTED_ARCH="arm64" ;;
        x64)   EXPECTED_ARCH="x86_64" ;;
      esac
      ACTUAL_ARCH="$(file "${UV_BIN}" | grep -oE 'arm64|x86_64' | head -1 || true)"
      if [ "${ACTUAL_ARCH}" != "${EXPECTED_ARCH}" ]; then
        echo "==> uv v${UV_VERSION} exists but architecture mismatch (have ${ACTUAL_ARCH}, need ${EXPECTED_ARCH}), re-downloading..."
      else
        echo "==> uv v${UV_VERSION} (${ARCH}) already exists at ${TARGET_DIR}, skipping download"
        exit 0
      fi
    else
      echo "==> uv v${UV_VERSION} already exists at ${TARGET_DIR}, skipping download"
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
else
  tar -xzf "${TMPDIR_DL}/${FILENAME}" -C "${EXTRACT_DIR}"
fi

# 定位 uv 二进制所在目录（不同平台/版本的归档结构可能不同：有或无外层子目录）
if [ "${PLATFORM}" = "win" ]; then
  UV_FOUND="$(find "${EXTRACT_DIR}" -name "uv.exe" -type f | head -1)"
else
  UV_FOUND="$(find "${EXTRACT_DIR}" -name "uv" -type f | head -1)"
fi

if [ -z "${UV_FOUND}" ]; then
  echo "Error: uv binary not found after extraction" >&2
  echo "==> Contents of extract dir:" >&2
  find "${EXTRACT_DIR}" -type f >&2
  exit 1
fi

INNER_DIR="$(dirname "${UV_FOUND}")"

# === 复制到资源目录 ===

echo "==> Installing to ${TARGET_DIR}"
rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/bin"

if [ "${PLATFORM}" = "win" ]; then
  cp "${INNER_DIR}/uv.exe" "${TARGET_DIR}/bin/"
  if [ -f "${INNER_DIR}/uvx.exe" ]; then
    cp "${INNER_DIR}/uvx.exe" "${TARGET_DIR}/bin/"
  fi
else
  cp "${INNER_DIR}/uv" "${TARGET_DIR}/bin/"
  if [ -f "${INNER_DIR}/uvx" ]; then
    cp "${INNER_DIR}/uvx" "${TARGET_DIR}/bin/"
  fi
  chmod 755 "${TARGET_DIR}/bin/uv"
  [ -f "${TARGET_DIR}/bin/uvx" ] && chmod 755 "${TARGET_DIR}/bin/uvx"
fi

# === 验证 ===

echo "==> Verifying installation..."
if [ "${PLATFORM}" = "win" ]; then
  echo "    (skipping verification on Windows — cross-platform build)"
else
  INSTALLED_VERSION="$("${TARGET_DIR}/bin/uv" --version | awk '{print $2}')"
  if [ "${INSTALLED_VERSION}" = "${UV_VERSION}" ]; then
    echo "==> OK: uv ${INSTALLED_VERSION}"
  else
    echo "Error: Expected ${UV_VERSION}, got ${INSTALLED_VERSION}" >&2
    exit 1
  fi
fi

# === 输出大小统计 ===

echo "==> Size:"
du -sh "${TARGET_DIR}/bin" 2>/dev/null || true
du -sh "${TARGET_DIR}" | sed 's/\t/ /' | awk '{print "    Total: " $1}'

echo "==> Done"
