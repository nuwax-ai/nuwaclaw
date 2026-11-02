#!/usr/bin/env bash
# 从 ttyd 官方 GitHub release 下载 Linux/Windows 预编译二进制，按平台目录入库：
#   resources/ttyd/binaries/linux-x64/ttyd      <- ttyd.x86_64
#   resources/ttyd/binaries/linux-arm64/ttyd    <- ttyd.aarch64
#   resources/ttyd/binaries/win32-x64/ttyd.exe  <- ttyd.win32.exe
#
# 目录名对齐 getTtydBinPath()/prepare-ttyd.js 的 <node-platform>-<arch> 约定。
# 注意：ttyd 官方 release 不提供 macOS 二进制（darwin-*），macOS 由
#       scripts/prepare/build-ttyd-mac.sh 源码静态编译产出，本脚本不处理 darwin。
#
# 用法：
#   bash scripts/prepare/download-ttyd-binaries.sh            # 下载默认版本全部平台
#   TTYD_REF=1.7.7 bash scripts/prepare/download-ttyd-binaries.sh
#   GITHUB_MIRROR=https://gh-proxy.org/ bash scripts/prepare/download-ttyd-binaries.sh   # 走镜像加速
#   bash scripts/prepare/download-ttyd-binaries.sh linux-x64  # 仅指定平台

set -euo pipefail

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_BASE="${PKG_ROOT}/resources/ttyd/binaries"
TTYD_REF="${TTYD_REF:-1.7.7}"
# 可选 GitHub 镜像前缀（如 https://gh-proxy.org/），默认空走官方
MIRROR="${GITHUB_MIRROR:-}"
BASE_URL="${MIRROR}https://github.com/tsl0922/ttyd/releases/download/${TTYD_REF}"

log() { echo "[download-ttyd] $*"; }

# 平台目录名 -> 官方 release 资产名
asset_for() {
  case "$1" in
    linux-x64)   echo "ttyd.x86_64" ;;
    linux-arm64) echo "ttyd.aarch64" ;;
    win32-x64)   echo "ttyd.win32.exe" ;;
    *) echo "" ;;
  esac
}

# 平台目录名 -> 目标文件名
dest_name_for() {
  case "$1" in
    win32-x64) echo "ttyd.exe" ;;
    *) echo "ttyd" ;;
  esac
}

download_one() {
  local key="$1"
  local asset dest_name out_dir out_path url
  asset="$(asset_for "$key")"
  if [ -z "$asset" ]; then
    log "未知平台目录: ${key}（支持 linux-x64 / linux-arm64 / win32-x64）"
    return 1
  fi
  dest_name="$(dest_name_for "$key")"
  out_dir="${OUT_BASE}/${key}"
  out_path="${out_dir}/${dest_name}"
  url="${BASE_URL}/${asset}"

  mkdir -p "${out_dir}"
  log "↓ ${key}: ${url}"
  # -f 失败即非零；-S 显示错误；-L 跟随重定向
  if ! curl -fSL --retry 3 --connect-timeout 20 -o "${out_path}.tmp" "${url}"; then
    log "❌ 下载失败: ${url}"
    rm -f "${out_path}.tmp"
    return 1
  fi
  mv -f "${out_path}.tmp" "${out_path}"
  chmod +x "${out_path}" 2>/dev/null || true
  log "✓ ${out_path} ($(du -h "${out_path}" | cut -f1))"
  # 仅打印类型，不执行（Linux/Windows 二进制无法在当前主机运行）
  file "${out_path}" || true
}

main() {
  log "ttyd ${TTYD_REF}（mirror='${MIRROR:-none}'）"
  local targets=("$@")
  if [ ${#targets[@]} -eq 0 ]; then
    targets=(linux-x64 linux-arm64 win32-x64)
  fi
  local rc=0
  for key in "${targets[@]}"; do
    download_one "$key" || rc=1
  done
  [ $rc -eq 0 ] && log "Done." || log "部分平台下载失败，请检查网络或设置 GITHUB_MIRROR。"
  return $rc
}

main "$@"
