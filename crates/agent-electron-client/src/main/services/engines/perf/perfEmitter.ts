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
 * 计时器：创建时记录起始时间，end() 时自动计算并输出耗时。
 * 用法：const timer = perfEmitter.start(); ... ; timer.end('stage.name', { extra });
 */
export interface PerfTimer {
  end(name: string, extra?: PerfExtra): number;
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

  /**
   * 创建计时器，后续调用 end() 时自动输出耗时。
   * 示例：
   *   const t = perfEmitter.start();
   *   await doSomething();
   *   t.end('stage.name', { key: 'value' });
   */
  start(): PerfTimer {
    const t0 = Date.now();
    return {
      end(name: string, extra?: PerfExtra): number {
        const ms = Date.now() - t0;
        getPerfLogger().info(`[PERF] ${name}: ${ms}ms${formatExtra(extra)}`);
        return ms;
      },
    };
  },
};
