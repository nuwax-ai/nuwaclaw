#!/bin/bash
# prepare-source-nuwax-file-server.sh
#
# 从 GitHub 准备 nuwax-file-server 源码（安装依赖 + 构建 dist）。
#
# 策略：
#   1. 以远程 origin/<branch> 为准（reset --hard + clean），忽略本地脏改动/未跟踪冲突
#   2. 用远程 commit hash 做缓存：hash 未变且 dist/、node_modules/ 齐全则跳过
#
# 缓存文件：sources/nuwax-file-server/.prepare-commit-hash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"

SOURCE_DIR="$ELECTRON_CLIENT_DIR/sources/nuwax-file-server"
GIT_REPO="https://github.com/nuwax-ai/nuwax-file-server.git"
BRANCH="main"
# 缓存：记录上次成功 prepare 所对应的远程 commit
CACHE_FILE="$SOURCE_DIR/.prepare-commit-hash"

echo "[prepare-source-nuwax-file-server] 开始准备源码..."

# ---------------------------------------------------------------------------
# 确保本地是 git 仓库（没有则 clone）
# ---------------------------------------------------------------------------
if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "[prepare-source-nuwax-file-server] 克隆源码..."
  mkdir -p "$(dirname "$SOURCE_DIR")"
  # 若目录残留无 .git 的半成品，先清掉再 clone
  if [ -e "$SOURCE_DIR" ]; then
    rm -rf "$SOURCE_DIR"
  fi
  git clone --branch "$BRANCH" "$GIT_REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"

# ---------------------------------------------------------------------------
# 拉取远程并解析远程 commit（真相来源）
# ---------------------------------------------------------------------------
echo "[prepare-source-nuwax-file-server] 拉取远程 $BRANCH..."
git fetch origin "$BRANCH"

REMOTE_HASH="$(git rev-parse "origin/$BRANCH")"
CACHED_HASH=""
if [ -f "$CACHE_FILE" ]; then
  CACHED_HASH="$(tr -d '[:space:]' < "$CACHE_FILE")"
fi

HAS_DIST=0
HAS_NODE_MODULES=0
[ -d "$SOURCE_DIR/dist" ] && HAS_DIST=1
[ -d "$SOURCE_DIR/node_modules" ] && HAS_NODE_MODULES=1

# 确保缓存文件不污染 git status（ignored 也不会被默认 git clean -fd 删掉）
ensure_cache_excluded() {
  local exclude_file="$SOURCE_DIR/.git/info/exclude"
  if [ -d "$SOURCE_DIR/.git/info" ]; then
    if ! grep -qxF '.prepare-commit-hash' "$exclude_file" 2>/dev/null; then
      printf '\n# nuwaclaw prepare cache\n.prepare-commit-hash\n' >> "$exclude_file"
    fi
  fi
}
ensure_cache_excluded

# ---------------------------------------------------------------------------
# 缓存命中：远程 hash 未变且构建产物齐全 → 跳过
# ---------------------------------------------------------------------------
if [ -n "$CACHED_HASH" ] \
  && [ "$CACHED_HASH" = "$REMOTE_HASH" ] \
  && [ "$HAS_DIST" -eq 1 ] \
  && [ "$HAS_NODE_MODULES" -eq 1 ]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
  echo "[prepare-source-nuwax-file-server] ${VERSION} (${REMOTE_HASH:0:8}) 已是最新，跳过"
  exit 0
fi

if [ -n "$CACHED_HASH" ] && [ "$CACHED_HASH" != "$REMOTE_HASH" ]; then
  echo "[prepare-source-nuwax-file-server] 远程更新: ${CACHED_HASH:0:8} -> ${REMOTE_HASH:0:8}，需要重新构建"
elif [ "$HAS_DIST" -eq 0 ] || [ "$HAS_NODE_MODULES" -eq 0 ]; then
  echo "[prepare-source-nuwax-file-server] 构建产物缺失，需要重新构建"
else
  echo "[prepare-source-nuwax-file-server] 无有效缓存，需要重新构建"
fi

# ---------------------------------------------------------------------------
# 以远程为准：硬重置并清理未跟踪文件（避免 pull 被 untracked 挡住）
# ---------------------------------------------------------------------------
echo "[prepare-source-nuwax-file-server] 对齐远程 origin/$BRANCH (${REMOTE_HASH:0:8})..."
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

# ---------------------------------------------------------------------------
# 安装依赖并构建（commit 变更时必须重建，不复用旧 dist）
# ---------------------------------------------------------------------------
if [ -d "$SOURCE_DIR/node_modules" ]; then
  echo "[prepare-source-nuwax-file-server] 清理旧的 node_modules..."
  rm -rf "$SOURCE_DIR/node_modules"
fi

echo "[prepare-source-nuwax-file-server] 安装依赖..."
npm install --ignore-scripts

echo "[prepare-source-nuwax-file-server] 构建项目..."
npm run build

# 写入远程 commit，供下次缓存比对
printf '%s\n' "$REMOTE_HASH" > "$CACHE_FILE"
ensure_cache_excluded

VERSION="$(node -p "require('./package.json').version")"
echo "[prepare-source-nuwax-file-server] ✓ 源码准备完成 (nuwax-file-server@${VERSION}, ${REMOTE_HASH:0:8})"
