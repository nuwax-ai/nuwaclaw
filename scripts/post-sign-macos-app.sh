#!/usr/bin/env bash
#
# post-sign-macos-app.sh — Tauri 构建后对 .app 中的 node-runtime 补签 JIT entitlement
#
# 背景:
#   Tauri bundler 会对 .app/Contents/MacOS/ 下所有二进制执行 codesign，
#   但不会为 sidecar 附加 entitlements。node-runtime（V8/Node.js）需要
#   com.apple.security.cs.allow-jit 权限，否则 macOS Hardened Runtime 会
#   触发 SIGTRAP。
#
#   本脚本在 tauri-action 构建完成后执行：
#   1. 找到构建产物 .app
#   2. 对 node-runtime 重新签名（附带 JIT entitlement）
#   3. 重新签名 .app bundle（使 bundle 签名包含更新后的 node-runtime）
#   4. 重建 .dmg 和 .app.tar.gz（覆盖 Tauri 生成的旧版本）
#
# 用法:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." ./scripts/post-sign-macos-app.sh [--target <triple>]
#   例如: ./scripts/post-sign-macos-app.sh --target universal-apple-darwin
#
# 仅在 macOS 上执行；非 macOS 或未设置 APPLE_SIGNING_IDENTITY 时直接退出 0。
#

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "==> [post-sign] 未设置 APPLE_SIGNING_IDENTITY，跳过"
  exit 0
fi

# ---- 解析参数 ----
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_DIR="${PROJECT_ROOT}/crates/agent-tauri-client/src-tauri"
ENTITLEMENTS="${TAURI_DIR}/node-runtime.entitlements"

if [ ! -f "${ENTITLEMENTS}" ]; then
  echo "==> [post-sign] 未找到 ${ENTITLEMENTS}，跳过"
  exit 0
fi

# ---- 定位构建产物 ----
# Tauri 输出路径:
#   target/<triple>/release/bundle/macos/<ProductName>.app
#   target/<triple>/release/bundle/dmg/<ProductName>_<version>_<arch>.dmg
# 无 --target 时直接在 target/release/bundle/ 下
if [ -n "${TARGET}" ]; then
  BUNDLE_BASE="${PROJECT_ROOT}/target/${TARGET}/release/bundle"
else
  BUNDLE_BASE="${PROJECT_ROOT}/target/release/bundle"
fi

MACOS_BUNDLE_DIR="${BUNDLE_BASE}/macos"
DMG_DIR="${BUNDLE_BASE}/dmg"

# 查找 .app
APP_PATH=""
for app in "${MACOS_BUNDLE_DIR}"/*.app; do
  if [ -d "$app" ]; then
    APP_PATH="$app"
    break
  fi
done

if [ -z "${APP_PATH}" ]; then
  echo "==> [post-sign] 未找到 .app (路径: ${MACOS_BUNDLE_DIR})，跳过"
  exit 0
fi

APP_NAME="$(basename "${APP_PATH}" .app)"
echo "==> [post-sign] 找到: ${APP_PATH}"

# ---- 1. 对 node-runtime 补签 JIT entitlement ----
NODE_RUNTIME="${APP_PATH}/Contents/MacOS/node-runtime"
if [ -f "${NODE_RUNTIME}" ]; then
  echo "==> [post-sign] 对 node-runtime 补签 JIT entitlement..."
  codesign --force --timestamp --options runtime \
    --entitlements "${ENTITLEMENTS}" \
    -s "${APPLE_SIGNING_IDENTITY}" -- "${NODE_RUNTIME}"
  echo "    signed (with JIT): ${NODE_RUNTIME}"
else
  echo "==> [post-sign] 未找到 ${NODE_RUNTIME}，跳过 node-runtime 签名"
fi

# ---- 2. 重新签名 .app bundle ----
# node-runtime 的签名变更后，需要更新 .app 的 bundle 签名
echo "==> [post-sign] 重新签名 .app bundle..."
codesign --force --timestamp --options runtime \
  -s "${APPLE_SIGNING_IDENTITY}" -- "${APP_PATH}"
echo "    signed: ${APP_PATH}"

# 验证签名
echo "==> [post-sign] 验证签名..."
codesign --verify --deep --strict "${APP_PATH}" 2>&1 && echo "    签名验证通过" || echo "    ⚠️ 签名验证失败"

# ---- 3. 重建 .app.tar.gz（供 Tauri updater 使用） ----
TAR_GZ="${MACOS_BUNDLE_DIR}/${APP_NAME}.app.tar.gz"
if [ -f "${TAR_GZ}" ]; then
  echo "==> [post-sign] 重建 ${APP_NAME}.app.tar.gz..."
  # 进入 bundle 目录，以正确的相对路径打包
  (cd "${MACOS_BUNDLE_DIR}" && tar -czf "${APP_NAME}.app.tar.gz" "${APP_NAME}.app")
  echo "    rebuilt: ${TAR_GZ}"

  # 如果有 .sig 文件，需要重新生成（由 tauri-action 的 updater 签名处理，这里删除旧的让 tauri-action 重新生成）
  if [ -f "${TAR_GZ}.sig" ]; then
    rm -f "${TAR_GZ}.sig"
    echo "    removed stale .sig (will be regenerated)"
  fi
fi

# ---- 4. 重建 .dmg ----
DMG_PATH=""
for dmg in "${DMG_DIR}"/*.dmg; do
  if [ -f "$dmg" ]; then
    DMG_PATH="$dmg"
    break
  fi
done

if [ -n "${DMG_PATH}" ]; then
  echo "==> [post-sign] 重建 .dmg..."
  DMG_NAME="$(basename "${DMG_PATH}")"
  DMG_TEMP="${DMG_DIR}/${DMG_NAME}.tmp"

  # 创建临时 DMG
  hdiutil create -volname "${APP_NAME}" \
    -srcfolder "${APP_PATH}" \
    -ov -format UDZO \
    "${DMG_TEMP}" 2>/dev/null

  # 替换原 DMG（hdiutil create 会自动追加 .dmg 扩展名）
  mv -f "${DMG_TEMP}.dmg" "${DMG_PATH}"
  echo "    rebuilt: ${DMG_PATH}"
fi

echo "==> [post-sign] 完成"
