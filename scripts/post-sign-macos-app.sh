#!/usr/bin/env bash
#
# post-sign-macos-app.sh — Tauri 构建后对 .app 中的 node-runtime 补签 JIT entitlement 并公证
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
#   4. 公证 .app → staple → 创建 .app.tar.gz 和 .dmg → 公证 .dmg → staple
#
# 用法:
#   本地或 CI 调用时由调用方传入环境变量；在 GitHub Actions 中由 release-tauri.yml
#   从仓库已配置的 Secrets 注入（APPLE_SIGNING_IDENTITY、APPLE_API_KEY 等），无需在脚本内写死。
#
#   本地示例:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." \
#   APPLE_API_KEY_PATH="/path/to/AuthKey.p8" \
#   APPLE_API_KEY_ID="AB12CD34EF" \
#   APPLE_ISSUER_ID="uuid-xxx" \
#   ./scripts/post-sign-macos-app.sh [--target <triple>]
#
# 仅在 macOS 上执行；非 macOS 或未设置 APPLE_SIGNING_IDENTITY 时直接退出 0。
# 公证是可选的：未设置 APPLE_API_KEY_PATH 时跳过公证步骤（仅重建 dmg/tar.gz）。
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

# ---- DMG 创建函数 ----
# 使用 create-dmg 创建带 Applications 快捷方式的 DMG
create_dmg_with_app_link() {
  local dmg_path="$1"
  local app_path="$2"
  local app_name="$3"

  # 删除旧的 DMG（如果存在）
  rm -f "${dmg_path}"

  # 检查 volicon 是否存在
  local volicon_arg=""
  local volicon_path="${app_path}/Contents/Resources/AppIcon.icns"
  if [ -f "${volicon_path}" ]; then
    volicon_arg="--volicon ${volicon_path}"
  fi

  # 使用 create-dmg 创建 DMG
  # --app-drop-link 0 0: 在 DMG 左下角创建 Applications 快捷方式
  create-dmg \
    --volname "${app_name}" \
    ${volicon_arg} \
    --app-drop-link 0 0 \
    "${dmg_path}" \
    "${app_path}"
}

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

# ---- 1.0 对 mcp-proxy 补签 JIT entitlement ----
# mcp-proxy 会通过 npx 启动 MCP 服务器进程，需要 JIT 权限以便子进程能正常执行 JavaScript
MCP_PROXY="${APP_PATH}/Contents/MacOS/mcp-proxy"
if [ -f "${MCP_PROXY}" ]; then
  echo "==> [post-sign] 对 mcp-proxy 补签 JIT entitlement..."
  codesign --force --timestamp --options runtime \
    --entitlements "${ENTITLEMENTS}" \
    -s "${APPLE_SIGNING_IDENTITY}" -- "${MCP_PROXY}"
  echo "    signed (with JIT): ${MCP_PROXY}"
else
  echo "==> [post-sign] 未找到 ${MCP_PROXY}，跳过 mcp-proxy 签名"
fi

# ---- 1.05 对 nuwax-lanproxy 补签（普通签名，Go 程序不需要 JIT）----
NUWAX_LANPROXY="${APP_PATH}/Contents/MacOS/nuwax-lanproxy"
if [ -f "${NUWAX_LANPROXY}" ]; then
  echo "==> [post-sign] 对 nuwax-lanproxy 补签..."
  codesign --force --timestamp --options runtime \
    -s "${APPLE_SIGNING_IDENTITY}" -- "${NUWAX_LANPROXY}"
  echo "    signed: ${NUWAX_LANPROXY}"
else
  echo "==> [post-sign] 未找到 ${NUWAX_LANPROXY}，跳过 nuwax-lanproxy 签名"
fi

# ---- 1.1 对 Resources 下的 node 二进制补签 JIT entitlement ----
# 注意：Tauri 把 resources 目录放在 Contents/Resources/resources/ 下
NODE_BIN="${APP_PATH}/Contents/Resources/resources/node/bin/node"
if [ -f "${NODE_BIN}" ]; then
  echo "==> [post-sign] 对 Resources/node 补签 JIT entitlement..."
  codesign --force --timestamp --options runtime \
    --entitlements "${ENTITLEMENTS}" \
    -s "${APPLE_SIGNING_IDENTITY}" -- "${NODE_BIN}"
  echo "    signed (with JIT): ${NODE_BIN}"
else
  echo "==> [post-sign] 未找到 ${NODE_BIN}，跳过 node 签名"
fi

# ---- 1.2 对 Resources 下的 uv/uvx 二进制签名 ----
UV_BIN="${APP_PATH}/Contents/Resources/resources/uv/bin"
if [ -d "${UV_BIN}" ]; then
  echo "==> [post-sign] 对 Resources/uv 补签..."
  for bin in "${UV_BIN}"/uv "${UV_BIN}"/uvx; do
    if [ -f "$bin" ]; then
      codesign --force --timestamp --options runtime \
        -s "${APPLE_SIGNING_IDENTITY}" -- "$bin"
      echo "    signed: $bin"
    fi
  done
else
  echo "==> [post-sign] 未找到 ${UV_BIN}，跳过 uv 签名"
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

# ---- 3. 记录 .app.tar.gz 路径（稍后在公证后重建） ----
# 文件名需要包含架构后缀，与 Tauri 生成的格式一致（如 Nuwax.Agent_aarch64.app.tar.gz）
# 否则不同架构的构建会上传同名文件，互相覆盖
ARCH_SUFFIX=""
if [ -n "${TARGET}" ]; then
  # TARGET 格式: aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin
  if [[ "${TARGET}" == *"aarch64"* ]]; then
    ARCH_SUFFIX="_aarch64"
  elif [[ "${TARGET}" == *"x86_64"* ]]; then
    ARCH_SUFFIX="_x64"
  elif [[ "${TARGET}" == *"universal"* ]]; then
    ARCH_SUFFIX="_universal"
  fi
fi
# 将 APP_NAME 中的空格替换为点（Nuwax Agent -> Nuwax.Agent）
APP_NAME_NO_SPACE="${APP_NAME// /.}"
TAR_GZ="${MACOS_BUNDLE_DIR}/${APP_NAME_NO_SPACE}${ARCH_SUFFIX}.app.tar.gz"

# ---- 4. 公证（Notarization） ----
# 公证需要 App Store Connect API Key，未配置时跳过
# 所需环境变量：
#   - APPLE_API_KEY_PATH: AuthKey_<KeyID>.p8 文件路径
#   - APPLE_API_KEY_ID: API Key ID (如 AB12CD34EF)
#   - APPLE_ISSUER_ID: Issuer ID (UUID 格式)

if [ -n "${APPLE_API_KEY_PATH:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_ISSUER_ID:-}" ]; then
  echo "==> [notarize] 开始公证流程..."

  # 4.1 提交 .app 进行公证（直接提交 .app，而非 .tar.gz）
  # 公证成功后 staple .app，然后打包 .tar.gz 和创建 .dmg
  echo "==> [notarize] 创建临时 zip 用于提交公证..."
  TEMP_ZIP="${RUNNER_TEMP:-/tmp}/${APP_NAME}.zip"
  ditto -c -k --keepParent "${APP_PATH}" "${TEMP_ZIP}"

  echo "==> [notarize] 提交 ${APP_NAME}.app 公证..."
  SUBMIT_LOG=$(mktemp)

  xcrun notarytool submit "${TEMP_ZIP}" \
    --key "${APPLE_API_KEY_PATH}" \
    --key-id "${APPLE_API_KEY_ID}" \
    --issuer "${APPLE_ISSUER_ID}" \
    --wait \
    --timeout 600 \
    2>&1 | tee "${SUBMIT_LOG}"

  rm -f "${TEMP_ZIP}"

  # 检查公证结果
  if grep -q "status: Accepted" "${SUBMIT_LOG}"; then
    echo "    公证成功: ${APP_PATH}"
    rm -f "${SUBMIT_LOG}"

    # Staple 公证票据到 .app
    echo "==> [notarize] Staple 公证票据到 .app..."
    xcrun stapler staple "${APP_PATH}"
    echo "    stapled: ${APP_PATH}"
  else
    echo "::error::公证失败，查看日志:"
    cat "${SUBMIT_LOG}"
    rm -f "${SUBMIT_LOG}"
    exit 1
  fi

  # 4.2 重建 .app.tar.gz（包含 stapled 的票据）
  # 使用包含架构后缀的文件名（如 Nuwax.Agent_aarch64.app.tar.gz）
  if [ -n "${TAR_GZ}" ]; then
    TAR_GZ_BASENAME="$(basename "${TAR_GZ}")"
    echo "==> [notarize] 创建已 stapled 的 ${TAR_GZ_BASENAME}..."
    (cd "${MACOS_BUNDLE_DIR}" && tar -czf "${TAR_GZ_BASENAME}" "${APP_NAME}.app")
    echo "    created: ${TAR_GZ}"

    # 删除原始的无架构后缀的 tar.gz 文件（Tauri bundler 生成的）
    # 这些文件名格式为 "Nuwax Agent.app.tar.gz"（带空格）或 "Nuwax.Agent.app.tar.gz"（带点）
    if [ -n "${ARCH_SUFFIX}" ]; then
      ORIGINAL_TAR_GZ_NO_SPACE="${MACOS_BUNDLE_DIR}/${APP_NAME_NO_SPACE}.app.tar.gz"
      ORIGINAL_TAR_GZ_WITH_SPACE="${MACOS_BUNDLE_DIR}/${APP_NAME}.app.tar.gz"
      for old_file in "$ORIGINAL_TAR_GZ_NO_SPACE" "$ORIGINAL_TAR_GZ_WITH_SPACE"; do
        if [ -f "$old_file" ] && [ "$old_file" != "${TAR_GZ}" ]; then
          rm -f "$old_file"
          echo "    removed old tar.gz: $(basename "$old_file")"
        fi
      done
    fi
  fi

  # 4.3 重建 .dmg（包含 stapled 的 .app）
  DMG_PATH=""
  for dmg in "${DMG_DIR}"/*.dmg; do
    if [ -f "$dmg" ]; then
      DMG_PATH="$dmg"
      break
    fi
  done

  if [ -n "${DMG_PATH}" ]; then
    echo "==> [notarize] 创建 .dmg（包含 stapled 的 .app）..."
    DMG_NAME="$(basename "${DMG_PATH}")"

    create_dmg_with_app_link "${DMG_PATH}" "${APP_PATH}" "${APP_NAME}"
    echo "    created: ${DMG_PATH}"

    # 4.4 公证 .dmg 并 staple
    echo "==> [notarize] 提交 ${DMG_NAME} 公证..."
    SUBMIT_LOG=$(mktemp)

    xcrun notarytool submit "${DMG_PATH}" \
      --key "${APPLE_API_KEY_PATH}" \
      --key-id "${APPLE_API_KEY_ID}" \
      --issuer "${APPLE_ISSUER_ID}" \
      --wait \
      --timeout 600 \
      2>&1 | tee "${SUBMIT_LOG}"

    if grep -q "status: Accepted" "${SUBMIT_LOG}"; then
      echo "    公证成功: ${DMG_PATH}"
      rm -f "${SUBMIT_LOG}"

      echo "==> [notarize] Staple 公证票据到 .dmg..."
      xcrun stapler staple "${DMG_PATH}"
      echo "    stapled: ${DMG_PATH}"
    else
      echo "::error::.dmg 公证失败，查看日志:"
      cat "${SUBMIT_LOG}"
      rm -f "${SUBMIT_LOG}"
      exit 1
    fi
  fi

  echo "==> [notarize] 公证流程完成"
else
  echo "==> [notarize] 未配置 APPLE_API_KEY_PATH / APPLE_API_KEY_ID / APPLE_ISSUER_ID，跳过公证"
  echo "    提示: 未公证的应用在 macOS 上可能会被 Gatekeeper 阻止"

  # ---- 未配置公证时，仍然需要重建 .app.tar.gz 和 .dmg ----
  if [ -n "${TAR_GZ}" ]; then
    TAR_GZ_BASENAME="$(basename "${TAR_GZ}")"
    echo "==> [post-sign] 重建 ${TAR_GZ_BASENAME}..."
    (cd "${MACOS_BUNDLE_DIR}" && tar -czf "${TAR_GZ_BASENAME}" "${APP_NAME}.app")
    echo "    rebuilt: ${TAR_GZ}"

    # 删除原始的无架构后缀的 tar.gz 文件（Tauri bundler 生成的）
    if [ -n "${ARCH_SUFFIX}" ]; then
      ORIGINAL_TAR_GZ_NO_SPACE="${MACOS_BUNDLE_DIR}/${APP_NAME_NO_SPACE}.app.tar.gz"
      ORIGINAL_TAR_GZ_WITH_SPACE="${MACOS_BUNDLE_DIR}/${APP_NAME}.app.tar.gz"
      for old_file in "$ORIGINAL_TAR_GZ_NO_SPACE" "$ORIGINAL_TAR_GZ_WITH_SPACE"; do
        if [ -f "$old_file" ] && [ "$old_file" != "${TAR_GZ}" ]; then
          rm -f "$old_file"
          echo "    removed old tar.gz: $(basename "$old_file")"
        fi
      done
    fi

    if [ -f "${TAR_GZ}.sig" ]; then
      rm -f "${TAR_GZ}.sig"
      echo "    removed stale .sig (will be regenerated)"
    fi
  fi

  DMG_PATH=""
  for dmg in "${DMG_DIR}"/*.dmg; do
    if [ -f "$dmg" ]; then
      DMG_PATH="$dmg"
      break
    fi
  done

  if [ -n "${DMG_PATH}" ]; then
    echo "==> [post-sign] 重建 .dmg..."

    create_dmg_with_app_link "${DMG_PATH}" "${APP_PATH}" "${APP_NAME}"
    echo "    rebuilt: ${DMG_PATH}"
  fi
fi

echo "==> [post-sign] 完成"
