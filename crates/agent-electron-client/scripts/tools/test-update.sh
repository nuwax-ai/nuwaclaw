#!/usr/bin/env bash
#
# 本地测试自动更新流程
#
# 步骤:
#   1. 打包当前版本作为「旧版」客户端
#   2. 临时 bump 到高版本，打包作为「新版」更新源
#   3. 用 HTTP 服务托管新版产物
#   4. 启动旧版客户端，指向本地更新源
#
# 用法:
#   bash scripts/tools/test-update.sh
#
# 前置条件:
#   - npm install 已完成
#   - npx serve 可用（或全局安装 serve）
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

# ---------- 配置 ----------
OLD_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION="99.0.0"  # 足够高，保证触发更新
SERVE_PORT=8080

echo "========================================="
echo " 本地更新测试"
echo "========================================="
echo " 当前版本 (旧版): $OLD_VERSION"
echo " 模拟版本 (新版): $NEW_VERSION"
echo " 更新源端口:       $SERVE_PORT"
echo "========================================="
echo ""

# ---------- Step 1: 打包旧版 ----------
echo "[1/4] 打包旧版 v${OLD_VERSION} ..."
OLD_RELEASE_DIR="$PROJECT_DIR/release/$OLD_VERSION"
if [ -d "$OLD_RELEASE_DIR" ] && ls "$OLD_RELEASE_DIR"/*.dmg "$OLD_RELEASE_DIR"/*.exe "$OLD_RELEASE_DIR"/*.AppImage 2>/dev/null | head -1 > /dev/null; then
  echo "  -> 已存在 $OLD_RELEASE_DIR，跳过打包"
else
  npm run dist:unsigned:local
fi
echo ""

# ---------- Step 2: 临时 bump 版本，打包新版 ----------
echo "[2/4] 打包新版 v${NEW_VERSION} ..."
NEW_RELEASE_DIR="$PROJECT_DIR/release/$NEW_VERSION"
if [ -d "$NEW_RELEASE_DIR" ] && ls "$NEW_RELEASE_DIR"/latest*.yml 2>/dev/null | head -1 > /dev/null; then
  echo "  -> 已存在 $NEW_RELEASE_DIR，跳过打包"
else
  # 临时修改版本号
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  -> package.json version 临时改为 $NEW_VERSION"

  npm run dist:unsigned:local || true

  # 恢复版本号
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$OLD_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  -> package.json version 已恢复为 $OLD_VERSION"
fi
echo ""

# ---------- Step 3: 启动本地更新服务器 ----------
echo "[3/4] 启动本地更新服务器 ..."
echo "  -> 托管目录: $NEW_RELEASE_DIR"
echo "  -> 地址: http://localhost:$SERVE_PORT"
echo ""

# 检查 latest*.yml 是否存在
if ! ls "$NEW_RELEASE_DIR"/latest*.yml 2>/dev/null | head -1 > /dev/null; then
  echo "❌ 错误: $NEW_RELEASE_DIR 中缺少 latest*.yml 文件"
  echo "   electron-updater 需要此文件来检测更新"
  exit 1
fi

echo "  latest*.yml 内容:"
echo "  ---"
cat "$NEW_RELEASE_DIR"/latest*.yml | head -20 | sed 's/^/  /'
echo "  ---"
echo ""

# 后台启动 HTTP 服务
npx serve "$NEW_RELEASE_DIR" -p $SERVE_PORT --no-clipboard &
SERVE_PID=$!
sleep 2

# 验证服务启动
if ! curl -s "http://localhost:$SERVE_PORT/" > /dev/null 2>&1; then
  echo "❌ HTTP 服务启动失败"
  kill $SERVE_PID 2>/dev/null || true
  exit 1
fi
echo "  -> HTTP 服务已启动 (PID: $SERVE_PID)"
echo ""

# ---------- Step 4: 启动旧版客户端 ----------
echo "[4/4] 启动旧版客户端 ..."
echo ""

APP_PATH=""
if [ "$(uname)" = "Darwin" ]; then
  # macOS: 找 .app
  APP_PATH=$(find "$OLD_RELEASE_DIR" -name "*.app" -maxdepth 2 | head -1)
  if [ -z "$APP_PATH" ]; then
    # 可能在 mac-arm64 或 mac 子目录
    APP_PATH=$(find "$OLD_RELEASE_DIR" -name "*.app" -maxdepth 3 | head -1)
  fi
elif [ "$(uname)" = "Linux" ]; then
  APP_PATH=$(find "$OLD_RELEASE_DIR" -name "*.AppImage" | head -1)
fi

if [ -z "$APP_PATH" ]; then
  echo "⚠️  未找到旧版安装包，请手动启动:"
  echo ""
  echo "  macOS:"
  echo "    NUWAX_UPDATE_SERVER=http://localhost:$SERVE_PORT open \"$OLD_RELEASE_DIR/mac-arm64/NuwaClaw.app\""
  echo ""
  echo "  或直接运行二进制:"
  echo "    NUWAX_UPDATE_SERVER=http://localhost:$SERVE_PORT \"$OLD_RELEASE_DIR/mac-arm64/NuwaClaw.app/Contents/MacOS/NuwaClaw\""
  echo ""
else
  echo "  找到旧版应用: $APP_PATH"
  echo ""
  if [ "$(uname)" = "Darwin" ]; then
    BINARY_PATH="$APP_PATH/Contents/MacOS/NuwaClaw"
    echo "  启动命令:"
    echo "    NUWAX_UPDATE_SERVER=http://localhost:$SERVE_PORT \"$BINARY_PATH\""
    echo ""
    echo "  按 Enter 启动，或 Ctrl+C 取消 ..."
    read -r
    NUWAX_UPDATE_SERVER="http://localhost:$SERVE_PORT" "$BINARY_PATH" &
  else
    echo "  启动命令:"
    echo "    NUWAX_UPDATE_SERVER=http://localhost:$SERVE_PORT \"$APP_PATH\""
    echo ""
    echo "  按 Enter 启动，或 Ctrl+C 取消 ..."
    read -r
    NUWAX_UPDATE_SERVER="http://localhost:$SERVE_PORT" "$APP_PATH" &
  fi
fi

echo ""
echo "========================================="
echo " 测试指引"
echo "========================================="
echo " 1. 打开「关于」页面"
echo " 2. 点「检查更新」或等 10 秒自动检查"
echo " 3. 应显示「发现新版本: v$NEW_VERSION」"
echo " 4. 点「下载更新」，观察进度条"
echo " 5. 下载完成后点「重启安装」"
echo "========================================="
echo ""
echo " 测试完成后按 Ctrl+C 停止更新服务器"

# 等待 Ctrl+C
trap "echo ''; echo '正在清理...'; kill $SERVE_PID 2>/dev/null; echo '完成'; exit 0" INT TERM
wait $SERVE_PID 2>/dev/null
