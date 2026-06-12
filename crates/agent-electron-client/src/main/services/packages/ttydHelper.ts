/**
 * ttyd 服务辅助模块
 *
 * 封装与 ttyd 生命周期无关的独立逻辑：
 *   - 初始工作目录解析（三级回退）
 *   - ttyd-cwd 文件读写（供 wrapper 脚本动态读取）
 *   - shell wrapper 脚本生成
 *   - 带 --cwd 参数的 WebSocket URL 构建
 *
 * 本模块不依赖 serviceManager 的 ctx，可独立 import、独立测试。
 */

import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import log from "electron-log";
import { APP_DATA_DIR_NAME } from "@shared/constants";
import { readSetting } from "../../db";
import { agentService } from "../engines/unifiedAgent";
import { getConfiguredPorts } from "../startupPorts";

// ── 路径常量 ──────────────────────────────────────────────────────────────────

const getAppDataDir = () => path.join(app.getPath("home"), APP_DATA_DIR_NAME);
const getCwdFilePath = () => path.join(getAppDataDir(), "ttyd-cwd");
const getWrapperPath = () => path.join(getAppDataDir(), "bin", "ttyd-shell.sh");

// ── 工作目录解析 ──────────────────────────────────────────────────────────────

/**
 * 三级回退策略确定 ttyd shell 的初始工作目录：
 *  1. 最近活跃会话的 workspaceDir（agentService.getRecentWorkspaceDir()）
 *  2. 设置页配置的默认工作区目录（step1_config.workspaceDir）
 *  3. 用户 HOME 目录（兜底）
 */
export function getTtydInitialCwd(): string {
  // 1. 最近活跃会话工作区
  const recentWorkspace = agentService.getRecentWorkspaceDir();
  if (recentWorkspace && fs.existsSync(recentWorkspace)) {
    log.info(`[ttydHelper] cwd = recent session workspace: ${recentWorkspace}`);
    return recentWorkspace;
  }

  // 2. 设置页配置的默认工作区
  const step1 = readSetting("step1_config") as { workspaceDir?: string } | null;
  if (step1?.workspaceDir && fs.existsSync(step1.workspaceDir)) {
    log.info(
      `[ttydHelper] cwd = configured workspaceDir: ${step1.workspaceDir}`,
    );
    return step1.workspaceDir;
  }

  // 3. 兜底：HOME
  const home = app.getPath("home");
  log.info(`[ttydHelper] cwd = home fallback: ${home}`);
  return home;
}

// ── ttyd-cwd 文件 ─────────────────────────────────────────────────────────────

/**
 * 将当前工作区目录写入 ttyd-cwd 文件。
 * wrapper 脚本在每次新终端连接时读取此文件，实现动态 cwd（ttyd 进程不需重启）。
 */
export function writeTtydCwdFile(cwd: string): void {
  const cwdFile = getCwdFilePath();
  try {
    fs.mkdirSync(path.dirname(cwdFile), { recursive: true });
    fs.writeFileSync(cwdFile, cwd, "utf8");
  } catch (e) {
    log.warn("[ttydHelper] Failed to write ttyd-cwd file:", e);
  }
}

// ── shell wrapper 脚本 ────────────────────────────────────────────────────────

/**
 * 写出 ttyd shell wrapper 脚本到 ~/.nuwaclaw/bin/ttyd-shell.sh（仅 Unix）。
 *
 * wrapper 逻辑（每次新终端连接时执行）：
 *  1. 优先解析 ttyd -a flag 透传的 --cwd <dir> 参数（前端通过 URL query 传入）
 *  2. 若未传 --cwd，读取 ttyd-cwd 文件（ttyd 启动/刷新时写入）
 *  3. 校验目录存在后 cd，最终 exec $SHELL -l（login shell）
 *
 * 返回 wrapper 脚本路径；写出失败则返回 null（调用方降级为直接使用 login shell）。
 */
export function ensureTtydShellWrapper(): string | null {
  const wrapperPath = getWrapperPath();
  const cwdFile = getCwdFilePath();

  const script = `#!/bin/bash
# Nuwax Agent – ttyd shell wrapper（自动生成，请勿手动编辑）
# 解析 --cwd 参数（由 ttyd -a flag 从 WebSocket URL query 参数传入）
_NUWAX_CWD=""
while [ $# -gt 0 ]; do
    case "$1" in
        --cwd) _NUWAX_CWD="$2"; shift 2 ;;
        *) shift ;;
    esac
done
# 未通过 URL 传入时，读取 ttyd-cwd 文件（ttyd 启动时写入的默认工作区）
if [ -z "$_NUWAX_CWD" ]; then
    _NUWAX_CWD="$(cat "${cwdFile}" 2>/dev/null || true)"
fi
# 进入目标目录：--cwd 有效则用之，否则读 ttyd-cwd 文件，最后兜底 HOME。
# cd 失败需明确报错（写到 ttyd 终端 stderr），不能 || true 静默吞错让用户毫无感知。
_NUWAX_TARGET=""
if [ -n "$_NUWAX_CWD" ] && [ -d "$_NUWAX_CWD" ]; then
    _NUWAX_TARGET="$_NUWAX_CWD"
elif [ -d "$HOME" ]; then
    _NUWAX_TARGET="$HOME"
else
    echo "[ttyd-wrapper] WARNING: no valid cwd (--cwd=\${_NUWAX_CWD:-<unset>}, HOME=\${HOME:-<unset>}); staying in inherited cwd" >&2
fi
if [ -n "$_NUWAX_TARGET" ]; then
    cd "$_NUWAX_TARGET" || echo "[ttyd-wrapper] WARNING: cd to '\$_NUWAX_TARGET' failed" >&2
fi
exec "\${SHELL:-/bin/bash}" -l
`;

  try {
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
    return wrapperPath;
  } catch (e) {
    log.warn("[ttydHelper] Failed to write ttyd wrapper script:", e);
    return null;
  }
}

// ── WebSocket URL 构建 ────────────────────────────────────────────────────────

/**
 * 返回带当前工作区 --cwd 参数的 WebSocket URL，供前端建立终端连接时使用。
 *
 * 格式：ws://127.0.0.1:<port>/ws?arg=--cwd&arg=<encoded_workspace>
 *
 * ttyd 的 -a flag 将 URL query 参数透传给 wrapper 脚本 argv，
 * wrapper 解析 --cwd 后自动 cd 到目标目录。
 */
export function getTtydWsUrl(): string {
  const { ttyd: port } = getConfiguredPorts();
  const cwd = getTtydInitialCwd();
  return `ws://127.0.0.1:${port}/ws?arg=--cwd&arg=${encodeURIComponent(cwd)}`;
}
