#!/bin/bash
# 下载 sidecar 二进制到本地缓存目录（多平台），可按需投放到 src-tauri/binaries
#
# 支持 target:
# - x86_64-pc-windows-msvc
# - aarch64-pc-windows-msvc
# - x86_64-apple-darwin
# - aarch64-apple-darwin
# - x86_64-unknown-linux-gnu
# - aarch64-unknown-linux-gnu
#
# 用法:
#   ./scripts/download-sidecars.sh                          # 自动从 GitHub 获取最新 mcp-proxy 版本
#   ./scripts/download-sidecars.sh --target x86_64-pc-windows-msvc
#   ./scripts/download-sidecars.sh --all-common
#   ./scripts/download-sidecars.sh --all-common --materialize
#   ./scripts/download-sidecars.sh --cache-dir .cache/sidecars
#   ./scripts/download-sidecars.sh --mcp-version 0.1.48     # 指定 mcp-proxy 版本
#   ./scripts/download-sidecars.sh --force                  # 强制重新下载

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/crates/agent-tauri-client/src-tauri/binaries"
CACHE_DIR="$ROOT_DIR/.cache/sidecars"
TMP_DIR="/tmp/nuwax-sidecar-download"

MCP_VERSION="0.1.53"
NODE_VERSION="22.14.0"
FORCE=0
DRY_RUN=0
ALL_COMMON=0
NO_CHECK=0
MATERIALIZE=0
TARGETS=()
LAST_SUCCESS_URL=""
MCP_GITHUB_REPO="nuwax-ai/mcp-proxy"

# 从 GitHub releases 获取最新版本号
get_latest_mcp_version() {
  local api_url="https://api.github.com/repos/${MCP_GITHUB_REPO}/releases/latest"
  local response
  response=$(curl -fsSL "$api_url" 2>/dev/null) || {
    echo "ERROR: 无法从 GitHub 获取最新版本" >&2
    return 1
  }
  local tag_name
  tag_name=$(echo "$response" | grep -m1 '"tag_name"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  if [[ -z "$tag_name" ]]; then
    echo "ERROR: 无法解析 GitHub response 中的 tag_name" >&2
    return 1
  fi
  # 移除前缀 'v' (如 v0.1.48 -> 0.1.48)
  echo "${tag_name#v}"
}

COMMON_TARGETS=(
  "x86_64-pc-windows-msvc"
  "aarch64-pc-windows-msvc"
  "x86_64-apple-darwin"
  "aarch64-apple-darwin"
  "x86_64-unknown-linux-gnu"
  "aarch64-unknown-linux-gnu"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGETS+=("${2:-}")
      shift 2
      ;;
    --all-common)
      ALL_COMMON=1
      shift 1
      ;;
    --cache-dir)
      CACHE_DIR="${2:-}"
      shift 2
      ;;
    --materialize)
      MATERIALIZE=1
      shift 1
      ;;
    --mcp-version)
      MCP_VERSION="${2:-}"
      shift 2
      ;;
    --node-version)
      NODE_VERSION="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift 1
      ;;
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    --no-check)
      NO_CHECK=1
      shift 1
      ;;
    -h|--help)
      sed -n '1,28p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 2
      ;;
  esac
done

if [[ $ALL_COMMON -eq 1 ]]; then
  TARGETS=("${COMMON_TARGETS[@]}")
fi
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("$(rustc -vV | awk '/^host:/ {print $2}')")
fi

# 如果未指定 MCP 版本，从 GitHub 获取最新版本
if [[ -z "$MCP_VERSION" ]]; then
  echo "正在从 GitHub 获取 mcp-stdio-proxy 最新版本..."
  MCP_VERSION=$(get_latest_mcp_version) || exit 1
  echo "检测到最新版本: $MCP_VERSION"
fi

mkdir -p "$CACHE_DIR" "$BIN_DIR" "$TMP_DIR"
MANIFEST_FILE="$CACHE_DIR/sidecar-download-manifest.txt"

download_file() {
  local url="$1"
  local out="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY  curl -fL \"$url\" -o \"$out\""
    return 0
  fi
  curl -fL "$url" -o "$out"
}

download_first_success() {
  local out="$1"
  shift
  local urls=("$@")
  local url
  local i=0
  LAST_SUCCESS_URL=""
  for url in "${urls[@]}"; do
    i=$((i + 1))
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "DRY  candidate[$i] -> $url"
      download_file "$url" "$out"
      LAST_SUCCESS_URL="$url"
      return 0
    fi
    if curl -fL "$url" -o "$out"; then
      LAST_SUCCESS_URL="$url"
      return 0
    fi
    echo "  WARN 下载失败，尝试下一个候选: $url" >&2
  done
  return 1
}

extract_archive() {
  local archive="$1"
  local out_dir="$2"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"
  # 按扩展名选择解压方式；Windows 下 MCP 为 .zip，必须用 unzip（若保存时无扩展名会误走 tar 导致失败）
  if [[ "$archive" == *.zip ]]; then
    unzip -q -o "$archive" -d "$out_dir"
  elif [[ "$archive" == *.tar.xz || "$archive" == *.tar.gz || "$archive" == *.tgz ]]; then
    tar -xf "$archive" -C "$out_dir"
  else
    # 无扩展名或未知格式时用 file 检测
    if command -v file &>/dev/null; then
      case "$(file -b "$archive")" in
        *[Zz]ip*)
          unzip -q -o "$archive" -d "$out_dir"
          ;;
        *)
          tar -xf "$archive" -C "$out_dir"
          ;;
      esac
    else
      tar -xf "$archive" -C "$out_dir"
    fi
  fi
}

if [[ $DRY_RUN -eq 0 ]]; then
  {
    echo "# sidecar download manifest"
    echo "# generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# mcp_version=$MCP_VERSION node_version=$NODE_VERSION"
    echo "# cache_dir=$CACHE_DIR"
    echo "# format: target component filename source"
  } > "$MANIFEST_FILE"
fi

for TARGET in "${TARGETS[@]}"; do
  MCP_ARTIFACT_CANDIDATES=()
  case "$TARGET" in
    x86_64-pc-windows-msvc)
      MCP_ARTIFACT_CANDIDATES=("mcp-stdio-proxy-x86_64-pc-windows-msvc.zip")
      MCP_BIN_NAME="mcp-proxy.exe"
      NODE_ARTIFACT="node-v${NODE_VERSION}-win-x64.zip"
      NODE_BIN_NAME="node.exe"
      DEST_EXT=".exe"
      ;;
    aarch64-pc-windows-msvc)
      MCP_ARTIFACT_CANDIDATES=(
        "mcp-stdio-proxy-aarch64-pc-windows-msvc.zip"
        "mcp-stdio-proxy-x86_64-pc-windows-msvc.zip"
      )
      MCP_BIN_NAME="mcp-proxy.exe"
      NODE_ARTIFACT="node-v${NODE_VERSION}-win-arm64.zip"
      NODE_BIN_NAME="node.exe"
      DEST_EXT=".exe"
      ;;
    x86_64-apple-darwin)
      MCP_ARTIFACT_CANDIDATES=("mcp-stdio-proxy-x86_64-apple-darwin.tar.xz")
      MCP_BIN_NAME="mcp-proxy"
      NODE_ARTIFACT="node-v${NODE_VERSION}-darwin-x64.tar.gz"
      NODE_BIN_NAME="node"
      DEST_EXT=""
      ;;
    aarch64-apple-darwin)
      MCP_ARTIFACT_CANDIDATES=("mcp-stdio-proxy-aarch64-apple-darwin.tar.xz")
      MCP_BIN_NAME="mcp-proxy"
      NODE_ARTIFACT="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
      NODE_BIN_NAME="node"
      DEST_EXT=""
      ;;
    x86_64-unknown-linux-gnu)
      MCP_ARTIFACT_CANDIDATES=("mcp-stdio-proxy-x86_64-unknown-linux-gnu.tar.xz")
      MCP_BIN_NAME="mcp-proxy"
      NODE_ARTIFACT="node-v${NODE_VERSION}-linux-x64.tar.xz"
      NODE_BIN_NAME="node"
      DEST_EXT=""
      ;;
    aarch64-unknown-linux-gnu)
      MCP_ARTIFACT_CANDIDATES=("mcp-stdio-proxy-aarch64-unknown-linux-gnu.tar.xz")
      MCP_BIN_NAME="mcp-proxy"
      NODE_ARTIFACT="node-v${NODE_VERSION}-linux-arm64.tar.xz"
      NODE_BIN_NAME="node"
      DEST_EXT=""
      ;;
    *)
      echo "不支持的 target: $TARGET" >&2
      exit 2
      ;;
  esac

  MCP_CACHE="$CACHE_DIR/mcp-proxy-${TARGET}${DEST_EXT}"
  NODE_CACHE="$CACHE_DIR/node-runtime-${TARGET}${DEST_EXT}"
  MCP_DST="$BIN_DIR/mcp-proxy-${TARGET}${DEST_EXT}"
  NODE_DST="$BIN_DIR/node-runtime-${TARGET}${DEST_EXT}"

  # 从第一个候选 artifact 得到压缩包后缀（.zip 或 .tar.xz），保证 extract_archive 能正确选择 unzip/tar
  MCP_ARCHIVE_SUFFIX="${MCP_ARTIFACT_CANDIDATES[0]#*${TARGET}}"
  MCP_PKG="$TMP_DIR/mcp-stdio-proxy-${TARGET}${MCP_ARCHIVE_SUFFIX}"

  # 缓存版本记录文件
  MCP_VERSION_FILE="$CACHE_DIR/mcp-proxy-${TARGET}.version"

  echo "target: $TARGET"
  echo "  cache dir   : $CACHE_DIR"
  echo "  mcp version : $MCP_VERSION"
  echo "  node version: $NODE_VERSION"

  # 检查是否需要重新下载：force标志、缓存文件不存在、或版本不一致
  NEED_DOWNLOAD=0
  if [[ $FORCE -eq 1 ]]; then
    NEED_DOWNLOAD=1
    rm -f "$MCP_VERSION_FILE"
    echo "  FORCE 强制重新下载"
  elif [[ ! -f "$MCP_CACHE" || ! -f "$NODE_CACHE" ]]; then
    NEED_DOWNLOAD=1
    echo "  缓存文件不存在，需要下载"
  elif [[ -f "$MCP_VERSION_FILE" ]]; then
    CACHED_VERSION=$(cat "$MCP_VERSION_FILE" 2>/dev/null || echo "")
    if [[ "$CACHED_VERSION" != "$MCP_VERSION" ]]; then
      NEED_DOWNLOAD=1
      echo "  版本不一致 (缓存: $CACHED_VERSION, 最新: $MCP_VERSION)，需要更新"
    fi
  else
    # 缓存文件存在但没有版本记录，尝试从二进制获取版本
    CACHED_VERSION=$("$MCP_CACHE" -V 2>/dev/null | awk '{print $2}' || echo "")
    if [[ -z "$CACHED_VERSION" ]]; then
      # 无法获取版本，保守起见重新下载
      NEED_DOWNLOAD=1
      echo "  无法获取缓存版本，需要重新下载"
    elif [[ "$CACHED_VERSION" != "$MCP_VERSION" ]]; then
      NEED_DOWNLOAD=1
      echo "  版本不一致 (缓存: $CACHED_VERSION, 最新: $MCP_VERSION)，需要更新"
    else
      # 版本一致，补写版本记录文件
      echo "$MCP_VERSION" > "$MCP_VERSION_FILE"
    fi
  fi

  if [[ $NEED_DOWNLOAD -eq 0 ]]; then
    echo "  SKIP 已存在缓存: $(basename "$MCP_CACHE"), $(basename "$NODE_CACHE")"
  else
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARTIFACT}"
    NODE_PKG="$TMP_DIR/${NODE_ARTIFACT}"

    MCP_URLS=()
    for artifact in "${MCP_ARTIFACT_CANDIDATES[@]}"; do
      MCP_URLS+=("https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/mcp-stdio-proxy/v${MCP_VERSION}/${artifact}")
    done

    if ! download_first_success "$MCP_PKG" "${MCP_URLS[@]}"; then
      echo "下载 mcp-proxy 失败 (target=$TARGET, version=$MCP_VERSION)" >&2
      exit 1
    fi
    MCP_SELECTED_URL="$LAST_SUCCESS_URL"
    download_file "$NODE_URL" "$NODE_PKG"

    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  DRY  copy -> $MCP_CACHE"
      echo "  DRY  copy -> $NODE_CACHE"
      echo ""
      continue
    fi

    MCP_EXTRACT_DIR="$TMP_DIR/extract-mcp-${TARGET}"
    NODE_EXTRACT_DIR="$TMP_DIR/extract-node-${TARGET}"
    extract_archive "$MCP_PKG" "$MCP_EXTRACT_DIR"
    extract_archive "$NODE_PKG" "$NODE_EXTRACT_DIR"

    MCP_SRC="$(find "$MCP_EXTRACT_DIR" -type f -name "$MCP_BIN_NAME" | head -n 1)"
    NODE_SRC="$(find "$NODE_EXTRACT_DIR" -type f -name "$NODE_BIN_NAME" | head -n 1)"
    if [[ -z "$MCP_SRC" || -z "$NODE_SRC" ]]; then
      echo "解压后未找到目标二进制 (target=$TARGET)" >&2
      exit 1
    fi

    cp -f "$MCP_SRC" "$MCP_CACHE"
    cp -f "$NODE_SRC" "$NODE_CACHE"
    chmod +x "$MCP_CACHE" "$NODE_CACHE" || true
    # 保存版本号到版本文件
    echo "$MCP_VERSION" > "$MCP_VERSION_FILE"
    echo "  DONE cache $(basename "$MCP_CACHE")"
    echo "  DONE cache $(basename "$NODE_CACHE")"
    echo "$TARGET mcp-proxy $(basename "$MCP_CACHE") $MCP_SELECTED_URL" >> "$MANIFEST_FILE"
    echo "$TARGET node-runtime $(basename "$NODE_CACHE") $NODE_URL" >> "$MANIFEST_FILE"
  fi

  if [[ $MATERIALIZE -eq 1 ]]; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  DRY  materialize -> $MCP_DST"
      echo "  DRY  materialize -> $NODE_DST"
    else
      cp -f "$MCP_CACHE" "$MCP_DST"
      cp -f "$NODE_CACHE" "$NODE_DST"
      chmod +x "$MCP_DST" "$NODE_DST" || true
      echo "  MAT  $(basename "$MCP_DST")"
      echo "  MAT  $(basename "$NODE_DST")"
    fi
  fi
  echo ""
done

echo "完成。"
echo "  cache: $CACHE_DIR"
if [[ $MATERIALIZE -eq 1 ]]; then
  echo "  materialized binaries: $BIN_DIR"
fi

if [[ $NO_CHECK -eq 0 && $DRY_RUN -eq 0 ]]; then
  echo ""
  echo "开始自动校验下载项 sidecar..."
  for t in "${TARGETS[@]}"; do
    if [[ $MATERIALIZE -eq 1 ]]; then
      "$SCRIPT_DIR/check-sidecars.sh" --downloaded-only --target "$t" --dir "$BIN_DIR"
    else
      "$SCRIPT_DIR/check-sidecars.sh" --downloaded-only --target "$t" --dir "$CACHE_DIR"
    fi
  done
fi
