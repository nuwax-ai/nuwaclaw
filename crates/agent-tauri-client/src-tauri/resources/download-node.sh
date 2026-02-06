#!/bin/bash
#
# 跨平台 Node.js 下载脚本
# 用于准备 Tauri 应用打包所需的 Node.js 便携版
#

set -e

NODE_VERSION="22.14.0"
RESOURCES_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
NODE_DIR="${RESOURCES_DIR}/node"

# 检测平台和架构
detect_platform() {
    local os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch=$(uname -m)
    
    case "$os" in
        darwin)
            OS="darwin"
            ;;
        linux)
            OS="linux"
            ;;
        mingw*|msys*|cygwin*|windows*)
            OS="win"
            ;;
        *)
            echo "不支持的操作系统: $os"
            exit 1
            ;;
    esac
    
    case "$arch" in
        x86_64|amd64)
            ARCH="x64"
            ;;
        arm64|aarch64)
            ARCH="arm64"
            ;;
        armv7l)
            ARCH="armv7l"
            ;;
        *)
            echo "不支持的架构: $arch"
            exit 1
            ;;
    esac
    
    echo "检测到平台: ${OS}-${ARCH}"
}

# 构建下载 URL
build_url() {
    local base_url="https://nodejs.org/dist/v${NODE_VERSION}"
    
    if [ "$OS" = "win" ]; then
        DOWNLOAD_URL="${base_url}/node-v${NODE_VERSION}-win-${ARCH}.zip"
        ARCHIVE_TYPE="zip"
    else
        DOWNLOAD_URL="${base_url}/node-v${NODE_VERSION}-${OS}-${ARCH}.tar.gz"
        ARCHIVE_TYPE="tar.gz"
    fi
    
    echo "下载 URL: ${DOWNLOAD_URL}"
}

# 下载并解压
download_and_extract() {
    # 创建目录
    mkdir -p "${NODE_DIR}"
    cd "${NODE_DIR}"
    
    echo "正在下载 Node.js v${NODE_VERSION}..."
    
    if [ "$ARCHIVE_TYPE" = "zip" ]; then
        curl -L -o node.zip "${DOWNLOAD_URL}"
        unzip -q node.zip
        mv node-v${NODE_VERSION}-win-${ARCH}/* .
        rm -rf node-v${NODE_VERSION}-win-${ARCH} node.zip
    else
        curl -L -o node.tar.gz "${DOWNLOAD_URL}"
        tar -xzf node.tar.gz --strip-components=1
        rm node.tar.gz
    fi
    
    echo "Node.js 下载完成!"
}

# 验证安装
verify_installation() {
    echo "验证 Node.js 安装..."
    
    if [ "$OS" = "win" ]; then
        NODE_BIN="${NODE_DIR}/node.exe"
        NPM_BIN="${NODE_DIR}/npm.cmd"
    else
        NODE_BIN="${NODE_DIR}/bin/node"
        NPM_BIN="${NODE_DIR}/bin/npm"
    fi
    
    if [ -f "$NODE_BIN" ]; then
        echo "Node.js: $("$NODE_BIN" --version)"
    else
        echo "错误: Node.js 未正确安装"
        exit 1
    fi
    
    if [ -f "$NPM_BIN" ]; then
        echo "npm: $("$NPM_BIN" --version)"
    else
        echo "错误: npm 未正确安装"
        exit 1
    fi
    
    echo "✅ Node.js v${NODE_VERSION} 安装成功!"
}

# 主函数
main() {
    echo "=========================================="
    echo "  Node.js 便携版下载脚本 (v${NODE_VERSION})"
    echo "=========================================="
    
    detect_platform
    build_url
    download_and_extract
    verify_installation
}

main "$@"
