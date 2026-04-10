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
# Windows Git Bash 下若直接找不到 gh，可与 sign-release-win.sh 一样设置:
#   GH_BIN="/c/Program Files/GitHub CLI/gh.exe"
# 脚本会自动用 where.exe / 常见安装路径解析（逻辑与 sign-release-win.sh 对齐）。

set -e

# 正式发布仓库：Electron 包在 nuwaclaw 仓库的 Releases 中（如 electron-v0.9.0）
REPO="${GITHUB_REPOSITORY:-nuwax-ai/nuwaclaw}"

# 与 scripts/build/sign-release-win.sh 中 resolve_gh 保持一致：Git Bash 常未继承含 gh 的 Windows PATH。
resolve_powershell() {
  if command -v pwsh.exe >/dev/null 2>&1; then
    echo "pwsh.exe"
    return 0
  fi
  if command -v pwsh >/dev/null 2>&1; then
    echo "pwsh"
    return 0
  fi
  if command -v powershell.exe >/dev/null 2>&1; then
    echo "powershell.exe"
    return 0
  fi
  if command -v powershell >/dev/null 2>&1; then
    echo "powershell"
    return 0
  fi
  local win_ps="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
  if [[ -x "$win_ps" ]]; then
    echo "$win_ps"
    return 0
  fi
  return 1
}

resolve_gh() {
  if [[ -n "${GH_BIN:-}" ]]; then
    echo "$GH_BIN"
    return 0
  fi
  if command -v gh >/dev/null 2>&1; then
    echo "gh"
    return 0
  fi
  local gh_win_path=""
  gh_win_path="$(where.exe gh 2>/dev/null | awk 'NR==1{print;exit}' | tr -d '\r')"
  if [[ -n "$gh_win_path" ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$gh_win_path"
    return 0
  fi
  local candidate_win_paths=(
    "C:\\Program Files\\GitHub CLI\\gh.exe"
    "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"
    "${LOCALAPPDATA:-}\\Programs\\GitHub CLI\\gh.exe"
    "${USERPROFILE:-}\\scoop\\apps\\gh\\current\\bin\\gh.exe"
  )
  local p=""
  for p in "${candidate_win_paths[@]}"; do
    [[ -z "$p" ]] && continue
    p="$(echo "$p" | tr -d '\r')"
    if [[ -n "$p" ]] && [[ -f "$(cygpath -u "$p" 2>/dev/null)" ]]; then
      cygpath -u "$p"
      return 0
    fi
  done
  local ps_bin=""
  ps_bin="$(resolve_powershell || true)"
  if [[ -n "$ps_bin" ]]; then
    if "$ps_bin" -Command "gh --version" >/dev/null 2>&1; then
      echo "__POWERSHELL_GH__:$ps_bin"
      return 0
    fi
  fi
  return 1
}

run_gh() {
  if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
    local ps_bin="${GH_BIN#__POWERSHELL_GH__:}"
    local ps_cmd="gh"
    local arg esc
    for arg in "$@"; do
      esc="${arg//\'/\'\'}"
      ps_cmd+=" '$esc'"
    done
    "$ps_bin" -NoProfile -Command "$ps_cmd"
    return $?
  fi
  "$GH_BIN" "$@"
}

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

GH_BIN=""
GH_BIN="$(resolve_gh)" || true
if [[ -z "$GH_BIN" ]]; then
  echo "错误: 未找到 GitHub CLI (gh)。Git Bash 下 PATH 往往不含「GitHub CLI」安装目录，而 sign-release-win.sh 会主动解析 gh.exe 路径。"
  echo "可选:"
  echo "  - 设置 GH_BIN=\"/c/Program Files/GitHub CLI/gh.exe\" 后再运行本脚本"
  echo "  - 或将 C:\\Program Files\\GitHub CLI 加入 Windows 用户 PATH 后重新打开终端"
  exit 127
fi

# workflow_dispatch 需要 ref：使用仓库默认分支，仅 tag 由用户指定
REF=$(run_gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

# 获取 GitHub token
TOKEN=$(run_gh auth token)

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
