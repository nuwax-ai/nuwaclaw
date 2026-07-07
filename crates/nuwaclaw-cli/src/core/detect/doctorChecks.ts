import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { cliCredentialsPath, cliToolsDir } from "../../util/paths.js";
import { findOnPath, getVersion } from "../../util/which.js";

export interface DoctorCheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export function checkNodeVersion(): DoctorCheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  const ok = major >= 22;
  return {
    id: "node",
    label: "Node.js",
    ok,
    detail: ok ? `v${version}` : `v${version}（需要 >= 22）`,
    fix: ok ? undefined : "安装 Node.js 22 或更高版本：https://nodejs.org",
  };
}

export function checkClaude(): DoctorCheckResult {
  const binPath = findOnPath("claude");
  if (!binPath) {
    return {
      id: "claude",
      label: "claude CLI",
      ok: false,
      detail: "未在 PATH 中找到",
      fix: "安装 Claude Code CLI 并登录：https://docs.claude.com/claude-code",
    };
  }
  const version = getVersion(binPath);
  return {
    id: "claude",
    label: "claude CLI",
    ok: true,
    detail: `${binPath}${version ? ` (${version})` : ""}`,
  };
}

export function checkCodex(): DoctorCheckResult {
  // nuwaclaw's codex engine (nuwax-codex-acp) embeds codex-core directly and
  // never shells out to a separate `codex` binary — the real prerequisite is
  // ~/.codex/auth.json, which any codex-using tool (CLI, Codex Desktop, the
  // VS Code extension) can have produced. Only检测文件是否存在，不读取其内容。
  const binPath = findOnPath("codex");
  const version = binPath ? getVersion(binPath) : null;
  const authFile = path.join(os.homedir(), ".codex", "auth.json");
  const hasAuth = fs.existsSync(authFile);
  const binNote = binPath
    ? `codex CLI: ${binPath}${version ? ` (${version})` : ""}`
    : "未检测到 codex CLI（不影响引擎使用）";

  if (!hasAuth) {
    return {
      id: "codex",
      label: "codex 登录态",
      ok: false,
      detail: `未检测到登录凭证（~/.codex/auth.json）。${binNote}`,
      fix: "用 `codex login`、Codex Desktop 或 VS Code 插件登录一次",
    };
  }
  return {
    id: "codex",
    label: "codex 登录态",
    ok: true,
    detail: `已检测到登录凭证。${binNote}`,
  };
}

export function checkUv(): DoctorCheckResult {
  const binPath = findOnPath("uv");
  if (!binPath) {
    return {
      id: "uv",
      label: "uv",
      ok: false,
      detail: "未在 PATH 中找到（可选，部分 MCP 依赖需要）",
      fix: "安装 uv：https://docs.astral.sh/uv/getting-started/installation/",
    };
  }
  const version = getVersion(binPath);
  return {
    id: "uv",
    label: "uv",
    ok: true,
    detail: `${binPath}${version ? ` (${version})` : ""}`,
  };
}

export function checkGuiAgent(): DoctorCheckResult {
  const installed = fs.existsSync(
    path.join(
      cliToolsDir(),
      "node_modules",
      "agent-gui-server",
      "package.json",
    ),
  );
  return {
    id: "gui-agent",
    label: "gui-agent MCP（电脑操作能力）",
    ok: installed,
    detail: installed
      ? "已安装"
      : "未安装（可选，`chat --gui-mcp` 时按需安装）",
  };
}

export function checkTccRisk(): DoctorCheckResult {
  const cwd = process.cwd();
  const risky = process.platform === "darwin" && /\/Downloads(\/|$)/.test(cwd);
  return {
    id: "tcc",
    label: "macOS 权限（TCC）",
    ok: !risky,
    detail: risky
      ? `当前目录 ${cwd} 在系统权限保护范围内，子进程可能因权限不足崩溃`
      : "当前目录无已知 TCC 风险",
    fix: risky
      ? "在「系统设置 → 隐私与安全性」授予终端对该目录的完全磁盘访问权限，或切换到非受保护目录"
      : undefined,
  };
}

export function checkNuwaxLogin(): DoctorCheckResult {
  const credPath = cliCredentialsPath();
  if (!fs.existsSync(credPath)) {
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok: false,
      detail: "未登录",
      fix: "运行 `nuwaclaw login --domain <host> --saved-key <key>` 登录",
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    // "logged in" tracks configKey (session validity), not savedKey (device
    // memory) — logout clears configKey but keeps savedKey, and a merely
    // remembered device must not be reported as an active login.
    const ok = Boolean(raw?.configKey);
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok,
      detail: ok
        ? `已登录（${raw.domain ?? "未知域名"}）`
        : raw?.savedKey
          ? "未登录（savedKey 已保存，可免密重新登录）"
          : "凭证文件存在但未登录",
      fix: ok
        ? undefined
        : raw?.savedKey
          ? "运行 `nuwaclaw login` 免密重新登录"
          : "运行 `nuwaclaw login --domain <host> --saved-key <key>` 登录",
    };
  } catch {
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok: false,
      detail: "凭证文件损坏",
      fix: "运行 `nuwaclaw login` 重新登录",
    };
  }
}

/** Count session files without parsing them — cheap, bounded directory walk. */
function countFiles(
  root: string,
  matches: (name: string) => boolean,
  maxDepth: number,
): number {
  let count = 0;
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (matches(entry.name)) count++;
    }
  }
  if (fs.existsSync(root)) walk(root, 0);
  return count;
}

export function checkLocalSessions(): DoctorCheckResult {
  const claudeCount = countFiles(
    path.join(os.homedir(), ".claude", "projects"),
    (name) => name.endsWith(".jsonl"),
    1,
  );
  const codexCount = countFiles(
    path.join(os.homedir(), ".codex", "sessions"),
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    3,
  );
  return {
    id: "local-sessions",
    label: "本地会话历史",
    ok: true,
    detail: `claude: ${claudeCount} 个会话，codex: ${codexCount} 个会话`,
  };
}

export function runAllDoctorChecks(): DoctorCheckResult[] {
  return [
    checkNodeVersion(),
    checkClaude(),
    checkCodex(),
    checkUv(),
    checkGuiAgent(),
    checkTccRisk(),
    checkNuwaxLogin(),
    checkLocalSessions(),
  ];
}
