import * as clack from "@clack/prompts";
import pc from "picocolors";
import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../core/sessions/discovery.js";
import type { EngineKind } from "../core/env/inheritEnv.js";

export interface ResumeTarget {
  sessionId: string;
  cwd: string;
}

/**
 * Resolves what to resume *before* the engine process is spawned — this only
 * touches local session-history files, so a cancelled picker costs nothing.
 *
 * `resumeOption` is commander's optional-value convention: `true` means
 * `--resume` was passed with no id (show a picker), a string is an explicit
 * id, `undefined` means resume wasn't requested at all.
 */
export async function resolveResumeTarget(
  resumeOption: true | string | undefined,
  engine: EngineKind,
): Promise<ResumeTarget | null> {
  if (!resumeOption) return null;

  const sessions = await listLocalSessions(engine);

  if (typeof resumeOption === "string") {
    const match = sessions.find((s) => s.sessionId === resumeOption);
    if (!match) {
      throw new Error(
        `未在本地 ${engine} 会话历史中找到 sessionId "${resumeOption}"。运行 \`nuwa-cli sessions --engine ${engine}\` 查看可用会话。`,
      );
    }
    return { sessionId: match.sessionId, cwd: match.cwd };
  }

  if (sessions.length === 0) {
    throw new Error(`未找到任何本地 ${engine} 会话历史，无法续接。`);
  }

  const picked = await clack.select({
    message: "选择要续接的会话：",
    options: sessions.map((s: LocalSessionSummary) => ({
      value: s.sessionId,
      label: `${s.title}`,
      hint: `${s.updatedAt.slice(0, 16).replace("T", " ")} · ${s.cwd}`,
    })),
  });

  if (clack.isCancel(picked)) {
    console.error(pc.dim("已取消。"));
    process.exit(0);
    return null; // unreachable in production (exit() halts the process); keeps control flow correct if exit is ever intercepted (e.g. tests).
  }

  const match = sessions.find((s) => s.sessionId === picked)!;
  return { sessionId: match.sessionId, cwd: match.cwd };
}
