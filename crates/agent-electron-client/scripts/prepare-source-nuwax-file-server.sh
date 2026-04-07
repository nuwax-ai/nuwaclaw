#!/bin/bash
# prepare-source-nuwax-file-server.sh
# 从 GitHub 克隆并构建 nuwax-file-server 源码

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ELECTRON_CLIENT_DIR")"

SOURCE_DIR="$ELECTRON_CLIENT_DIR/sources/nuwax-file-server"
GIT_REPO="https://github.com/nuwax-ai/nuwax-file-server.git"
BRANCH="main"

echo "[prepare-source-nuwax-file-server] 开始准备源码..."

# 1. 克隆或更新源码
if [ -d "$SOURCE_DIR/.git" ]; then
    echo "[prepare-source-nuwax-file-server] 更新源码..."
    cd "$SOURCE_DIR" && git checkout "$BRANCH" && git pull
else
    echo "[prepare-source-nuwax-file-server] 克隆源码..."
    mkdir -p "$(dirname "$SOURCE_DIR")"
    git clone --branch "$BRANCH" "$GIT_REPO" "$SOURCE_DIR"
fi

# 2. 清理旧的 node_modules
if [ -d "$SOURCE_DIR/node_modules" ]; then
    echo "[prepare-source-nuwax-file-server] 清理旧的 node_modules..."
    rm -rf "$SOURCE_DIR/node_modules"
fi

# 3. 安装依赖
echo "[prepare-source-nuwax-file-server] 安装依赖..."
cd "$SOURCE_DIR" && npm install --ignore-scripts

# 4. 构建
echo "[prepare-source-nuwax-file-server] 构建项目..."
cd "$SOURCE_DIR" && npm run build

echo "[prepare-source-nuwax-file-server] ✓ 源码准备完成 (nuwax-file-server@$(node -p "require('./package.json').version"))"
