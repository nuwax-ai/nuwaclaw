#!/usr/bin/env bash
# 同步 Electron Release 到阿里云 OSS（仅同步，不重新打包）
# 触发 nuwaclaw 仓库的 sync-electron-to-oss.yml（仅同步、不构建），
# 从 GitHub Release 下载已有资产 → 生成 latest.json → 上传到 OSS。
# 仅根据 tag 同步，分支固定为仓库默认分支（用于取 workflow 定义），用户无需关心分支。
#
# 用法（在 crates/agent-electron-client 目录下）:
#   ./scripts/sync-oss.sh <tag>
# 用法（在仓库根目录）:
#   ./crates/agent-electron-client/scripts/sync-oss.sh <tag>
# 示例（已有 Release 时只推 OSS，不触发构建）:
#   ./scripts/sync-oss.sh electron-v0.9.0
#
# 依赖: gh (GitHub CLI)、jq，且需已 gh auth login。

set -e

# 正式发布仓库：Electron 包在 nuwaclaw 仓库的 Releases 中（如 electron-v0.9.0）
REPO="${GITHUB_REPOSITORY:-nuwax-ai/nuwaclaw}"

# 解析参数：只接受 tag，不涉及分支
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

# workflow_dispatch 需要 ref：使用仓库默认分支，仅 tag 由用户指定
REF=$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

echo "==> 触发 OSS 同步（仅按 tag，分支使用仓库默认）"
echo "  仓库: $REPO"
echo "  Tag: $TAG"
echo ""

# 获取 GitHub token
TOKEN=$(gh auth token)

# 触发 workflow_dispatch：ref 用默认分支，inputs 只传 tag
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/actions/workflows/sync-electron-to-oss.yml/dispatches" \
  -d "{\"ref\":\"$REF\",\"inputs\":{\"tag\":\"$TAG\"}}")

if [ -n "$RESPONSE" ]; then
  echo "错误: $RESPONSE"
  echo ""
  echo "若为 'Workflow does not have workflow_dispatch trigger'，请将本仓库的"
  echo "  .github/workflows/sync-electron-to-oss.yml"
  echo "复制到 nuwaclaw 仓库的 .github/workflows/ 并推送，然后重试。"
  exit 1
fi

echo "✓ 触发成功"
echo ""

# 等待并获取 run ID
echo "==> 获取 workflow run ID..."
sleep 3

RUN_INFO=$(gh run list --workflow="sync-electron-to-oss.yml" --limit 1 --json databaseId,status,conclusion,displayTitle)
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
