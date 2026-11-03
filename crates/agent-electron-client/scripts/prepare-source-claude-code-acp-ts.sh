#!/bin/bash
# prepare-source-claude-code-acp-ts.sh
# 从 GitHub 按 tag 克隆并构建 claude-code-acp-ts 源码。
#
# tag 写在 package.json 的 bundledSources.claude-code-acp-ts.tag。
# 与 scripts/prepare/prepare-claude-code-acp-ts.js 共用这一处配置，换版本只改 tag。
# tag 不是分支：这里 fetch 该 tag 再 detached checkout，不用 git pull。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"

SOURCE_DIR="$ELECTRON_CLIENT_DIR/sources/claude-code-acp-ts"
GIT_REPO="https://github.com/nuwax-ai/claude-code-acp-ts.git"
# 与 JS prepare 脚本读同一字段，避免两条入口各钉一个 ref。
GIT_TAG="$(node -p "require('${ELECTRON_CLIENT_DIR}/package.json').bundledSources['claude-code-acp-ts'].tag")"

if [ -z "$GIT_TAG" ]; then
    echo "[prepare-source-claude-code-acp-ts] 缺少 bundledSources.claude-code-acp-ts.tag" >&2
    exit 1
fi

echo "[prepare-source-claude-code-acp-ts] 开始准备源码 (tag ${GIT_TAG})..."

# 1. 克隆或把已有仓库对齐到 tag。
#    --force 覆盖本地同名 tag，tag 被移动后下一次还能跟上。
#    checkout --force 丢掉构建缓存目录里的本地改动，避免脏工作区挡住切 tag。
if [ -d "$SOURCE_DIR/.git" ]; then
    echo "[prepare-source-claude-code-acp-ts] 拉取 tag ${GIT_TAG}..."
    cd "$SOURCE_DIR"
    git fetch --force --depth=1 origin tag "$GIT_TAG"
    git checkout --detach --force FETCH_HEAD
else
    echo "[prepare-source-claude-code-acp-ts] 克隆 tag ${GIT_TAG}..."
    mkdir -p "$(dirname "$SOURCE_DIR")"
    # --branch 对 tag 同样有效，只取该 tag 指向的提交。
    git clone --branch "$GIT_TAG" --depth 1 "$GIT_REPO" "$SOURCE_DIR"
fi

# 2. 清理旧的 node_modules
if [ -d "$SOURCE_DIR/node_modules" ]; then
    echo "[prepare-source-claude-code-acp-ts] 清理旧的 node_modules..."
    rm -rf "$SOURCE_DIR/node_modules"
fi

# 3. 安装依赖
echo "[prepare-source-claude-code-acp-ts] 安装依赖..."
cd "$SOURCE_DIR" && npm install --ignore-scripts

# 4. 构建 TypeScript（使用 npx tsc 替代 npm run build，避免 Windows 上 ./node_modules/.bin/tsc 路径不兼容）
echo "[prepare-source-claude-code-acp-ts] 构建项目..."
cd "$SOURCE_DIR" && npx tsc

echo "[prepare-source-claude-code-acp-ts] ✓ 源码准备完成 (claude-code-acp-ts@$(node -p "require('./package.json').version") @ ${GIT_TAG})"
