/**
 * T3.4 — 敏感操作分级分类器
 *
 * 根据工具种类（tool kind）和操作特征，将权限请求分为三个敏感度级别：
 *   low    — 只读操作，默认自动放行
 *   medium — 工作区内写操作，询问用户
 *   high   — 工作区外写、网络访问、命令执行，询问用户
 *
 * 合规模式（requireUserConfirmForAllTools=true）：所有非读操作均需确认。
 * bypassPermissions 模式：所有操作自动放行（调用侧处理，此处不干涉）。
 */

export type SensitivityLevel = "low" | "medium" | "high";

export interface SensitivityResult {
  level: SensitivityLevel;
  /** true 表示需要用户确认，false 表示可以自动放行 */
  requireConfirmation: boolean;
  reason: string;
}

/** ACP tool kind → 敏感度映射（静态规则，优先级低于路径分析） */
const KIND_SENSITIVITY: Record<string, SensitivityLevel> = {
  // 只读
  read: "low",
  glob: "low",
  grep: "low",
  ls: "low",
  // 网络/命令 — 始终 high
  bash: "high",
  web_fetch: "high",
  web_search: "high",
  // 写操作 — medium（路径分析可升级为 high）
  write: "medium",
  edit: "medium",
  multi_edit: "medium",
  notebook_edit: "medium",
  // 其余未知 → medium（保守）
};

/** Claude Code built-in tool title → kind 映射（title 可能比 kind 更可靠） */
const TITLE_TO_KIND: Record<string, string> = {
  Read: "read",
  Glob: "glob",
  Grep: "grep",
  LS: "ls",
  Bash: "bash",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  Write: "write",
  Edit: "edit",
  MultiEdit: "multi_edit",
  NotebookEdit: "notebook_edit",
  NotebookRead: "read",
  TodoRead: "read",
  TodoWrite: "write",
};

export interface ClassifyOptions {
  toolKind?: string | null;
  toolTitle?: string | null;
  rawInput?: unknown;
  workspaceDir?: string;
  /** 合规模式：对所有非读操作强制确认 */
  complianceRequireConfirmAll?: boolean;
}

/**
 * 判断 rawInput 中的路径是否在工作区目录内。
 * 取 rawInput.path / rawInput.file_path / rawInput.command 做粗匹配。
 */
function isOutsideWorkspace(rawInput: unknown, workspaceDir?: string): boolean {
  if (!workspaceDir || !rawInput || typeof rawInput !== "object") return false;
  const inp = rawInput as Record<string, unknown>;
  const candidates = [
    inp.path,
    inp.file_path,
    inp.filePath,
    inp.target,
    inp.destination,
  ]
    .filter((v) => typeof v === "string")
    .map((v) => v as string);

  if (candidates.length === 0) return false;
  return candidates.some((p) => !p.startsWith(workspaceDir));
}

export function classifyPermissionRequest(
  opts: ClassifyOptions,
): SensitivityResult {
  const rawKind = (opts.toolKind ?? "").toLowerCase();
  const titleKind = opts.toolTitle ? TITLE_TO_KIND[opts.toolTitle] : undefined;
  const effectiveKind = rawKind || titleKind || "unknown";

  const baseLevel: SensitivityLevel =
    KIND_SENSITIVITY[effectiveKind] ?? "medium";

  // 写操作 + 工作区外路径 → 升级为 high
  let level = baseLevel;
  if (
    baseLevel === "medium" &&
    isOutsideWorkspace(opts.rawInput, opts.workspaceDir)
  ) {
    level = "high";
  }

  // low 级别：只读，自动放行（除非合规模式要求全部确认）
  if (level === "low") {
    return {
      level,
      requireConfirmation: false,
      reason: "read-only operation — auto-allowed",
    };
  }

  // 合规模式：所有非读操作均需确认
  if (opts.complianceRequireConfirmAll) {
    return {
      level,
      requireConfirmation: true,
      reason: `compliance mode — confirmation required for ${level} operation`,
    };
  }

  // medium / high 均需用户确认
  return {
    level,
    requireConfirmation: true,
    reason: `${level} sensitivity — user confirmation required`,
  };
}
