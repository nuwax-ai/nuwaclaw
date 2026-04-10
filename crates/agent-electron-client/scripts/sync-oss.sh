#!/usr/bin/env bash
# 同步 Electron Release 到阿里云 OSS（仅同步，不重新打包）
# 触发 nuwaclaw 仓库的 sync-electron-to-oss.yml（仅同步、不构建），
# 从 GitHub Release 下载已有资产 → 生成 latest.json → 上传到 OSS。
# 仅根据 tag + channel 同步，分支固定为仓库默认分支（用于取 workflow 定义），用户无需关心分支。
# 注意：真正执行同步的是目标 release 仓库（默认 nuwaclaw）里的 workflow，
# 若本仓库 workflow 有更新，请同步到目标仓库后再使用。
#
# 用法（在 crates/agent-electron-client 目录下）:
#   ./scripts/sync-oss.sh <tag> [channel]
# 用法（在仓库根目录）:
#   ./crates/agent-electron-client/scripts/sync-oss.sh <tag> [channel]
# 示例（已有 Release 时只推 OSS，不触发构建）:
#   ./scripts/sync-oss.sh electron-v0.9.0           # 默认 stable
#   ./scripts/sync-oss.sh electron-v0.9.0 beta      # 仅更新 beta/latest.json
#
# 依赖: gh (GitHub CLI)、jq，且需已 gh auth login。

set -e

# 正式发布仓库：Electron 包在 nuwaclaw 仓库的 Releases 中（如 electron-v0.9.0）
REPO="${GITHUB_REPOSITORY:-nuwax-ai/nuwaclaw}"

# 解析参数：tag + 可选 channel，不涉及分支
if [ $# -eq 0 ]; then
  echo "用法: $0 <tag> [channel]"
  echo "示例: $0 electron-v0.8.0 stable"
  echo "示例: $0 electron-v0.8.0 beta"
  exit 1
fi

TAG="$1"
CHANNEL="${2:-stable}"

# 验证 tag 格式
if [[ ! "$TAG" =~ ^electron-v ]]; then
  echo "错误: tag 必须以 'electron-v' 开头"
  echo "当前: $TAG"
  exit 1
fi

if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "beta" ]]; then
  echo "错误: channel 仅支持 stable 或 beta"
  echo "当前: $CHANNEL"
  exit 1
fi

# workflow_dispatch 需要 ref：使用仓库默认分支，仅 tag 由用户指定
REF=$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

# 获取 GitHub token
TOKEN=$(gh auth token)

# 触发 workflow_dispatch：ref 用默认分支；新版 workflow 支持 inputs.tag + inputs.channel
dispatch_sync_workflow() {
  local payload="$1"
  curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/actions/workflows/sync-electron-to-oss.yml/dispatches" \
    -d "$payload"
}

RESPONSE=$(dispatch_sync_workflow "{\"ref\":\"$REF\",\"inputs\":{\"tag\":\"$TAG\",\"channel\":\"$CHANNEL\"}}")

if [ -n "$RESPONSE" ]; then
  # 远程 nuwaclaw 若仍为旧版 YAML（仅有 tag），GitHub 会 422：Unexpected inputs: ["channel"]
  MSG=$(echo "$RESPONSE" | jq -r '.message // empty' 2>/dev/null || echo "")
  if [[ "$MSG" == *"Unexpected inputs"* && "$MSG" == *"channel"* ]]; then
    if [[ "$CHANNEL" == "beta" ]]; then
      echo "错误: 远程 workflow 不支持 channel=beta"
      exit 1
    fi
    # 兼容旧版 workflow（未声明 channel input）：stable 场景退回仅传 tag
    RESPONSE=$(dispatch_sync_workflow "{\"ref\":\"$REF\",\"inputs\":{\"tag\":\"$TAG\"}}")
  fi
fi

if [ -n "$RESPONSE" ]; then
  echo "错误: $RESPONSE"
  exit 1
fi

echo "✓ 触发成功"
exit 0
