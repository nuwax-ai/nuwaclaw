import pc from "picocolors";
import { listLocalSessions } from "../core/sessions/discovery.js";
import {
  buildContextDigest,
  buildContextHandoff,
  readContext,
  type ContextEngine,
} from "../core/context/context.js";

export interface ContextListCommandOptions {
  engine?: string;
  json?: boolean;
}

export interface ContextReadCommandOptions {
  ref?: string;
  limit?: string;
  json?: boolean;
}

function parseEngine(value: string | undefined): ContextEngine | undefined {
  if (value === "claude" || value === "codex") return value;
  return undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function requireRef(ref: string | undefined): string {
  if (!ref) throw new Error("缺少 --ref <engine:sessionId>");
  return ref;
}

async function runJsonCommand(op: () => Promise<unknown>): Promise<void> {
  try {
    console.log(JSON.stringify(await op()));
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

export async function contextListCommand(
  options: ContextListCommandOptions,
): Promise<void> {
  const engine = parseEngine(options.engine);
  if (options.engine && !engine) {
    console.error(pc.red("[nuwa-cli] --engine 必须是 claude 或 codex"));
    process.exitCode = 1;
    return;
  }

  const sessions = await listLocalSessions(engine);
  if (options.json) {
    console.log(JSON.stringify({ items: sessions }));
    return;
  }

  if (sessions.length === 0) {
    console.log(pc.dim("未找到本地可引用上下文。"));
    return;
  }
  for (const s of sessions) {
    console.log(
      `${pc.cyan(`${s.engine}:${s.sessionId}`)} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
    );
    console.log(`       ${pc.dim(s.cwd)}`);
  }
}

export async function contextReadCommand(
  options: ContextReadCommandOptions,
): Promise<void> {
  await runJsonCommand(async () =>
    readContext(requireRef(options.ref), { limit: parseLimit(options.limit) }),
  );
}

export async function contextDigestCommand(
  options: ContextReadCommandOptions,
): Promise<void> {
  await runJsonCommand(async () =>
    buildContextDigest(requireRef(options.ref), {
      limit: parseLimit(options.limit),
    }),
  );
}

export async function contextHandoffCommand(
  options: ContextReadCommandOptions,
): Promise<void> {
  await runJsonCommand(async () =>
    buildContextHandoff(requireRef(options.ref), {
      limit: parseLimit(options.limit),
    }),
  );
}
