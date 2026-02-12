#!/usr/bin/env bash
#
# sign-macos-resource-bins.sh — 在 macOS 上对即将被打进 App 的第三方二进制做 codesign
#
# 背景:
#   Tauri 打包时会把 bundle.resources 中的文件拷贝到 .app/Contents/Resources/，
#   但不会对这些可执行文件做签名。Apple 公证要求包内所有可执行文件必须：
#   - 使用有效的 Developer ID 证书签名
#   - 包含安全时间戳 (--timestamp)
#   - 启用硬化运行时 (--options runtime)
#   因此需在 cargo tauri build 之前，对 resources 下的 node 与 uv/uvx
#   预先签名，这样打进包后即可通过公证。（node 与 uv 均不省略，一并签名。）
#
# 用法:
#   在项目根目录执行: ./scripts/sign-macos-resource-bins.sh
#   需设置环境变量 APPLE_SIGNING_IDENTITY（与 Tauri 使用的签名身份一致），例如:
#     export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
#     make tauri-bundle
#
# 仅在 macOS 上执行；非 macOS 或未设置 APPLE_SIGNING_IDENTITY 时直接退出 0。
#

set -euo pipefail

# 仅 macOS 需要此步骤
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

# 明确说明本步骤会对 node 与 uv 资源签名，不隐藏
echo "==> [sign-macos-resource-bins] 将对 node、uv/uvx 资源做 codesign（供 macOS 公证）"

# 未配置签名身份时跳过（例如 CI 未配置或非发布构建）
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "==> [sign-macos-resource-bins] 未设置 APPLE_SIGNING_IDENTITY，跳过对 node/uv 的签名"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_RESOURCES="${PROJECT_ROOT}/crates/agent-tauri-client/src-tauri/resources"

# 使用与 Tauri 一致的 identity 对单个二进制签名：Developer ID + 时间戳 + 硬化运行时
sign_one() {
  local bin_path="$1"
  if [ ! -f "$bin_path" ]; then
    return 0
  fi
  # 若已是同 identity 签名则可能跳过；--force 确保使用当前 identity 重签
  codesign --force --timestamp --options runtime -s "${APPLE_SIGNING_IDENTITY}" -- "$bin_path"
  echo "    signed: $bin_path"
}

echo "==> [sign-macos-resource-bins] 使用 identity: ${APPLE_SIGNING_IDENTITY}"

# 1. 签名 resources/uv/bin 下的 uv、uvx（公证报错即为此二者）
UV_BIN_DIR="${TAURI_RESOURCES}/uv/bin"
if [ -d "${UV_BIN_DIR}" ]; then
  echo "==> [sign-macos-resource-bins] 签名 uv 资源 (uv, uvx)..."
  for name in uv uvx; do
    [ -f "${UV_BIN_DIR}/${name}" ] && sign_one "${UV_BIN_DIR}/${name}"
  done
else
  echo "==> [sign-macos-resource-bins] 未找到 ${UV_BIN_DIR}，跳过 uv 签名"
fi

# 2. 签名 resources/node/bin 下的可执行文件（与 uv 一致，不隐藏，避免公证失败）
NODE_BIN_DIR="${TAURI_RESOURCES}/node/bin"
if [ -d "${NODE_BIN_DIR}" ]; then
  echo "==> [sign-macos-resource-bins] 签名 node 资源..."
  for f in "${NODE_BIN_DIR}"/*; do
    if [ -f "$f" ] && [ -x "$f" ]; then
      # 排除脚本或非 Mach-O（如 .sh）；仅签名可执行二进制
      if file "$f" | grep -q "Mach-O"; then
        sign_one "$f"
      fi
    fi
  done
else
  echo "==> [sign-macos-resource-bins] 未找到 ${NODE_BIN_DIR}，跳过 node 签名"
fi

echo "==> [sign-macos-resource-bins] node / uv 资源签名完成"
