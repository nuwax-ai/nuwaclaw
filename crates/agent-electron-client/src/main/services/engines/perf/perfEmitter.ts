import { getPerfLogger } from "../../../bootstrap/logConfig";

type PerfExtra = Record<string, string | number | boolean | null | undefined>;

function formatExtra(extra?: PerfExtra): string {
  if (!extra) return "";
  const entries = Object.entries(extra).filter(([, v]) => v !== undefined);
  if (!entries.length) return "";
  return (
    "  " +
    entries
      .map(([k, v]) => `${k}=${typeof v === "boolean" ? String(v) : (v ?? "")}`)
      .join(" ")
  );
}

/**
 * PERF 输出统一入口，降低业务代码对具体日志实现的侵入。
 */
export const perfEmitter = {
  duration(name: string, ms: number, extra?: PerfExtra): void {
    getPerfLogger().info(`[PERF] ${name}: ${ms}ms${formatExtra(extra)}`);
  },

  point(name: string, extra?: PerfExtra): void {
    getPerfLogger().info(`[PERF] ${name}${formatExtra(extra)}`);
  },
};
