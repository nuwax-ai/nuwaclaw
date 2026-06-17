/**
 * ttyd bundled env export helpers
 *
 * 将 getAppEnv() 的部分关键环境变量导出为可被 shell wrapper 加载的脚本，
 * 以便 ttyd 终端会话默认使用应用内置的 uv/pnpm/node/rg/nuwaxcode 等工具，
 * 同时不改变 ttyd 主进程启动时选择的 env（仍可保持 process.env）。
 */

export type TtydEnvMap = Record<string, string>;

const EXPLICIT_KEYS = [
  "PATH",
  "NODE_PATH",
  "MSYS2_PATH_TYPE",
  "ORIGINAL_PATH",
] as const;

const PREFIX_KEYS = [
  "UV_",
  "PNPM_",
  "NPM_CONFIG_",
  "NUWAXCODE_",
  "CLAUDE_CODE_",
] as const;

export function pickTtydBundledEnv(allEnv: TtydEnvMap): TtydEnvMap {
  const picked: TtydEnvMap = {};

  for (const k of EXPLICIT_KEYS) {
    const v = allEnv[k];
    if (typeof v === "string" && v.length > 0) picked[k] = v;
  }

  for (const [k, v] of Object.entries(allEnv)) {
    if (typeof v !== "string" || v.length === 0) continue;
    if (PREFIX_KEYS.some((p) => k.startsWith(p))) {
      picked[k] = v;
    }
  }

  return picked;
}

function bashSingleQuote(value: string): string {
  // Bash single-quoted string escape using the canonical '"'"' sequence.
  // Example: abc'def -> 'abc'"'"'def'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function toBashEnvScript(env: TtydEnvMap): string {
  const lines: string[] = [];
  lines.push("#!/bin/bash");
  lines.push("# Nuwax Agent – ttyd bundled env (auto-generated; do not edit)");
  lines.push("");

  const keys = Object.keys(env).sort();
  for (const key of keys) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    lines.push(`export ${key}=${bashSingleQuote(env[key] ?? "")}`);
  }

  lines.push("");
  return lines.join("\n");
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toPowerShellEnvScript(env: TtydEnvMap): string {
  const lines: string[] = [];
  lines.push("# Nuwax Agent – ttyd bundled env (auto-generated; do not edit)");
  lines.push("$ErrorActionPreference = 'Continue'");
  lines.push("");

  const keys = Object.keys(env).sort();
  for (const key of keys) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    lines.push(`$env:${key} = ${psSingleQuote(env[key] ?? "")}`);
  }

  lines.push("");
  return lines.join("\n");
}
