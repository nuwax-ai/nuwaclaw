#!/usr/bin/env bash
# 源码编译 macOS 版 ttyd（vcpkg 静态链接，自包含单文件二进制）
#
# ttyd 官方 release 不提供 macOS 二进制（只有 Linux + Windows），本脚本用 vcpkg
# 静态编译出 arm64 与 x86_64 版本，产物放入：
#   resources/ttyd/binaries/darwin-arm64/ttyd
#   resources/ttyd/binaries/darwin-x64/ttyd
# 供 electron-builder extraResources 打包，运行时由 getTtydBinPath() 定位。
#
# 依赖配方对齐 ttyd 官方 CI（.github/workflows/backend.yml）：
#   vcpkg install --triplet <triplet> libwebsockets libuv json-c zlib openssl
# （macOS 不需要 Windows 专用的 getopt-win32；macOS 默认 vcpkg 三元组为静态链接）
#
# 用法：
#   bash scripts/prepare/build-ttyd-mac.sh arm64     # 仅 Apple Silicon
#   bash scripts/prepare/build-ttyd-mac.sh x86_64    # 仅 Intel（arm64 机器上交叉编译）
#   bash scripts/prepare/build-ttyd-mac.sh all       # 两者都编
#
# 可选环境变量：
#   TTYD_SRC    ttyd 源码目录（默认克隆 .ttyd-build/ttyd 到 TTYD_REF）
#   TTYD_REF    ttyd git tag/commit（默认 1.7.7）
#   VCPKG_ROOT  vcpkg 目录（默认 .ttyd-build/vcpkg，缺失则自动克隆 + bootstrap）

set -euo pipefail

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_CACHE="${PKG_ROOT}/.ttyd-build"
OUT_BASE="${PKG_ROOT}/resources/ttyd/binaries"
TTYD_REF="${TTYD_REF:-1.7.7}"

log() { echo "[build-ttyd-mac] $*"; }

ensure_vcpkg() {
  VCPKG_ROOT="${VCPKG_ROOT:-${BUILD_CACHE}/vcpkg}"
  if [ ! -x "${VCPKG_ROOT}/vcpkg" ]; then
    log "Bootstrapping vcpkg at ${VCPKG_ROOT}"
    mkdir -p "$(dirname "${VCPKG_ROOT}")"
    if [ ! -d "${VCPKG_ROOT}/.git" ]; then
      git clone https://github.com/microsoft/vcpkg "${VCPKG_ROOT}"
    fi
    "${VCPKG_ROOT}/bootstrap-vcpkg.sh" -disableMetrics
  fi
  export VCPKG_ROOT
  log "vcpkg: ${VCPKG_ROOT}"
}

ensure_ttyd_src() {
  if [ -n "${TTYD_SRC:-}" ] && [ -d "${TTYD_SRC}" ]; then
    log "Using TTYD_SRC=${TTYD_SRC}"
    export TTYD_SRC
    return
  fi
  TTYD_SRC="${BUILD_CACHE}/ttyd"
  if [ ! -d "${TTYD_SRC}/.git" ]; then
    log "Cloning ttyd ${TTYD_REF}"
    git clone https://github.com/tsl0922/ttyd "${TTYD_SRC}"
    git -C "${TTYD_SRC}" checkout "${TTYD_REF}"
  fi
  export TTYD_SRC
  log "ttyd src: ${TTYD_SRC}"
}

build_one() {
  local arch="$1" # arm64 | x86_64
  local triplet osx_arch outkey
  case "$arch" in
    arm64)  triplet="arm64-osx"; osx_arch="arm64";  outkey="darwin-arm64" ;;
    x86_64) triplet="x64-osx";   osx_arch="x86_64"; outkey="darwin-x64" ;;
    *) log "Unknown arch: $arch"; exit 1 ;;
  esac

  log "=== Building ttyd for ${arch} (triplet=${triplet}) ==="
  "${VCPKG_ROOT}/vcpkg" install --triplet "${triplet}" \
    libwebsockets libuv json-c zlib openssl

  # 修正 vcpkg 静态 libwebsockets 的 config bug：
  # libwebsockets-config.cmake 把 LIBWEBSOCKETS_LIBRARIES 设为 "websockets websockets_shared"，
  # 但静态三元组只导出 websockets（STATIC IMPORTED）目标，websockets_shared 不存在，
  # 导致 ttyd 链接阶段报 `ld: library 'websockets_shared' not found`。
  # 此处去掉 websockets_shared，保证静态链接成功（幂等）。
  local lws_cfg="${VCPKG_ROOT}/installed/${triplet}/share/libwebsockets/libwebsockets-config.cmake"
  if [ -f "${lws_cfg}" ]; then
    sed -i '' \
      's/set(LIBWEBSOCKETS_LIBRARIES websockets websockets_shared)/set(LIBWEBSOCKETS_LIBRARIES websockets)/' \
      "${lws_cfg}" || true
    log "Patched libwebsockets-config.cmake (drop websockets_shared target)"
  fi

  local build_dir="${BUILD_CACHE}/build-${arch}"
  rm -rf "${build_dir}"
  cmake -S "${TTYD_SRC}" -B "${build_dir}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" \
    -DVCPKG_TARGET_TRIPLET="${triplet}" \
    -DCMAKE_OSX_ARCHITECTURES="${osx_arch}"
  cmake --build "${build_dir}" --config Release --parallel

  local out_dir="${OUT_BASE}/${outkey}"
  mkdir -p "${out_dir}"
  cp "${build_dir}/ttyd" "${out_dir}/ttyd"
  chmod +x "${out_dir}/ttyd"
  # 本地 ad-hoc 签名，保证开发期可直接运行；正式 Developer ID 签名/公证由 electron-builder 打包时处理
  codesign --force --sign - "${out_dir}/ttyd" || log "WARN: ad-hoc codesign failed, continuing"

  log "Output: ${out_dir}/ttyd"
  file "${out_dir}/ttyd"
  lipo -archs "${out_dir}/ttyd" || true
  log "Linked dylibs (should be system-only, vcpkg 静态):"
  otool -L "${out_dir}/ttyd" | sed -n '2,30p' || true
  if [ "$arch" = "arm64" ]; then
    "${out_dir}/ttyd" --version && log "arm64 ttyd OK" || log "WARN: arm64 ttyd --version failed"
  else
    arch -x86_64 "${out_dir}/ttyd" --version && log "x86_64 ttyd OK" || log "WARN: x86_64 ttyd --version failed (需 Rosetta)"
  fi
}

main() {
  mkdir -p "${BUILD_CACHE}" "${OUT_BASE}"
  ensure_vcpkg
  ensure_ttyd_src
  case "${1:-all}" in
    arm64)  build_one arm64 ;;
    x86_64) build_one x86_64 ;;
    all)    build_one arm64; build_one x86_64 ;;
    *) log "Usage: $0 {arm64|x86_64|all}"; exit 1 ;;
  esac
  log "Done."
}

main "$@"
