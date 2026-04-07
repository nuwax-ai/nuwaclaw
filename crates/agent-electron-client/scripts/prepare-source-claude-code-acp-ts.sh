#!/bin/bash
# prepare-source-claude-code-acp-ts.sh
# 从 GitHub 克隆并构建 claude-code-acp-ts 源码

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ELECTRON_CLIENT_DIR")"

SOURCE_DIR="$ELECTRON_CLIENT_DIR/sources/claude-code-acp-ts"
GIT_REPO="https://github.com/nuwax-ai/claude-code-acp-ts.git"
BRANCH="feat/claude-code-acp-ts"

echo "[prepare-source-claude-code-acp-ts] 开始准备源码..."

# 1. 克隆或更新源码
if [ -d "$SOURCE_DIR/.git" ]; then
    echo "[prepare-source-claude-code-acp-ts] 更新源码..."
    cd "$SOURCE_DIR" && git checkout "$BRANCH" && git pull
else
    echo "[prepare-source-claude-code-acp-ts] 克隆源码..."
    mkdir -p "$(dirname "$SOURCE_DIR")"
    git clone --branch "$BRANCH" "$GIT_REPO" "$SOURCE_DIR"
fi

# 2. 清理旧的 node_modules
if [ -d "$SOURCE_DIR/node_modules" ]; then
    echo "[prepare-source-claude-code-acp-ts] 清理旧的 node_modules..."
    rm -rf "$SOURCE_DIR/node_modules"
fi

# 3. 安装依赖
echo "[prepare-source-claude-code-acp-ts] 安装依赖..."
cd "$SOURCE_DIR" && npm install --ignore-scripts

# 4. 构建 TypeScript
echo "[prepare-source-claude-code-acp-ts] 构建项目..."
cd "$SOURCE_DIR" && npm run build

echo "[prepare-source-claude-code-acp-ts] ✓ 源码准备完成 (claude-code-acp-ts@$(node -p "require('./package.json').version"))"
