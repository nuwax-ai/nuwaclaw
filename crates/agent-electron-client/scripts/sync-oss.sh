#!/usr/bin/env bash
# 同步 Electron Release 到阿里云 OSS
# 触发 GitHub Actions workflow release-electron.yml，将指定 tag 的构建产物同步到 OSS。
#
# 用法（在 crates/agent-electron-client 目录下）:
#   ./scripts/sync-oss.sh <tag>
# 用法（在仓库根目录）:
#   ./crates/agent-electron-client/scripts/sync-oss.sh <tag>
# 示例:
#   ./scripts/sync-oss.sh electron-v0.8.0
#
# 依赖: gh (GitHub CLI)、jq，且需已 gh auth login。

set -e

REPO="${GITHUB_REPOSITORY:-nuwax-ai/nuwax-agent-client}"
BRANCH="${GITHUB_BRANCH:-feature/electron-client-0.8}"

# 解析参数
if [ $# -eq 0 ]; then
  echo "用法: $0 <tag>"
  echo "示例: $0 electron-v0.8.0"
  exit 1
fi

TAG="$1"

# 验证 tag 格式
if [[ ! "$TAG" =~ ^electron-v ]]; then
  echo "错误: tag 必须以 'electron-v' 开头"
  echo "当前: $TAG"
  exit 1
fi

echo "==> 触发 OSS 同步"
echo "  仓库: $REPO"
echo "  分支: $BRANCH"
echo "  Tag: $TAG"
echo ""

# 获取 GitHub token
TOKEN=$(gh auth token)

# 触发 workflow_dispatch
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/actions/workflows/release-electron.yml/dispatches" \
  -d "{\"ref\":\"$BRANCH\",\"inputs\":{\"tag\":\"$TAG\"}}")

if [ -n "$RESPONSE" ]; then
  echo "错误: $RESPONSE"
  exit 1
fi

echo "✓ 触发成功"
echo ""

# 等待并获取 run ID
echo "==> 获取 workflow run ID..."
sleep 3

RUN_INFO=$(gh run list --workflow="release-electron.yml" --limit 1 --json databaseId,status,conclusion,displayTitle)
RUN_ID=$(echo "$RUN_INFO" | jq -r '.[0].databaseId')

echo "✓ Run ID: $RUN_ID"
echo ""

# 监控进度
echo "==> 监控进度..."
echo ""

while true; do
  STATUS=$(gh run view "$RUN_ID" --json status --jq '.status')
  CONCLUSION=$(gh run view "$RUN_ID" --json conclusion --jq '.conclusion')

  case "$STATUS" in
    completed)
      if [ "$CONCLUSION" = "success" ]; then
        echo "✓ OSS 同步成功!"
        gh run view "$RUN_ID" --url
        exit 0
      else
        echo "✗ OSS 同步失败: $CONCLUSION"
        gh run view "$RUN_ID" --url
        exit 1
      fi
      ;;
    in_progress|queued)
      echo "  状态: $STATUS ($(date +%H:%M:%S))"
      ;;
    *)
      echo "  未知状态: $STATUS"
      ;;
  esac

  sleep 5
done
