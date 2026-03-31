import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";
import { APP_DATA_DIR_NAME, LOGS_DIR_NAME } from "../../constants";

type TraceLevel = "basic" | "deep";

export interface FirstTokenTraceContext {
  requestId?: string;
  sessionId?: string;
  projectId?: string;
  engine?: string;
}

interface TraceEvent {
  ts: number;
  iso: string;
  stage: string;
  request_id?: string;
  session_id?: string;
  project_id?: string;
  engine?: string;
  since_request_start_ms?: number;
  since_prev_event_ms?: number;
  data?: Record<string, unknown>;
}

interface TraceRequestState {
  requestId: string;
  startAt: number;
  firstEventAt: number;
  projectId?: string;
  sessionId?: string;
  engine?: string;
  events: TraceEvent[];
  firstTokenReported: boolean;
  closed: boolean;
}

const TRACE_TTL_MS = 30 * 60 * 1000;
const TRACE_DIR_NAME = "first-token-trace";

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const normalized = v.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseSample(v: string | undefined): number {
  if (!v) return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function todayDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatMs(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "N/A";
  return `${Math.max(0, Math.round(v))}ms`;
}

function shortId(id: string | undefined): string {
  if (!id) return "(none)";
  return id.length <= 12 ? id : `${id.slice(0, 12)}...`;
}

function safeGap(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  return Math.max(0, b - a);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export class FirstTokenTrace {
  private readonly enabled = parseBool(process.env.NUWAX_TRACE_FIRST_TOKEN);
  private readonly level: TraceLevel =
    process.env.NUWAX_TRACE_LEVEL?.toLowerCase() === "deep" ? "deep" : "basic";
  private readonly sampleRate = parseSample(process.env.NUWAX_TRACE_SAMPLE);
  private readonly traceDir = path.join(
    os.homedir(),
    APP_DATA_DIR_NAME,
    LOGS_DIR_NAME,
    TRACE_DIR_NAME,
  );
  private readonly logFile =
    process.env.NUWAX_TRACE_LOG_FILE ||
    path.join(this.traceDir, `trace.${todayDateStr()}.jsonl`);
  private readonly reportFile =
    process.env.NUWAX_TRACE_REPORT_FILE ||
    path.join(this.traceDir, `waterfall.${todayDateStr()}.md`);
  private readonly nuwaxcodeLogDir = path.join(this.traceDir, "nuwaxcode");

  private readonly requests = new Map<string, TraceRequestState>();
  private readonly sessionToRequest = new Map<string, string>();
  private readonly projectToRequest = new Map<string, string>();
  private readonly sampled = new Map<string, boolean>();

  // 缓冲写入：累积 trace 行，达到阈值或超时时 flush
  private writeBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_SIZE = 50;
  private static readonly FLUSH_INTERVAL_MS = 2000;

  // prune debounce：最多每秒执行一次
  private lastPruneAt = 0;
  private static readonly PRUNE_INTERVAL_MS = 1000;

  constructor() {
    if (!this.enabled) return;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.mkdirSync(path.dirname(this.reportFile), { recursive: true });
      if (this.level === "deep") {
        fs.mkdirSync(this.nuwaxcodeLogDir, { recursive: true });
      }
      this.enqueueWrite(
        safeStringify({
          ts: Date.now(),
          iso: new Date().toISOString(),
          stage: "trace.config",
          data: {
            enabled: this.enabled,
            level: this.level,
            sampleRate: this.sampleRate,
            logFile: this.logFile,
            reportFile: this.reportFile,
            nuwaxcodeLogDir:
              this.level === "deep" ? this.nuwaxcodeLogDir : "(disabled)",
          },
        }),
      );
      log.info(
        `[FirstTokenTrace] enabled level=${this.level} sample=${this.sampleRate} log=${this.logFile} report=${this.reportFile}`,
      );
    } catch (e) {
      log.warn("[FirstTokenTrace] init failed:", e);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isDeepMode(): boolean {
    return this.enabled && this.level === "deep";
  }

  getLogFilePath(): string | null {
    return this.enabled ? this.logFile : null;
  }

  getReportFilePath(): string | null {
    return this.enabled ? this.reportFile : null;
  }

  getNuwaxcodeLogDir(): string | null {
    if (!this.isDeepMode()) return null;
    return this.nuwaxcodeLogDir;
  }

  trace(
    stage: string,
    context: FirstTokenTraceContext = {},
    data?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;
    const now = Date.now();
    this.maybePrune(now);

    const requestId =
      context.requestId ||
      (context.sessionId
        ? this.sessionToRequest.get(context.sessionId)
        : undefined) ||
      (context.projectId
        ? this.projectToRequest.get(context.projectId)
        : undefined);

    if (requestId && !this.shouldSample(requestId)) return;

    let state: TraceRequestState | undefined;
    if (requestId) {
      state = this.requests.get(requestId);
      if (!state) {
        state = {
          requestId,
          startAt: now,
          firstEventAt: now,
          projectId: context.projectId,
          sessionId: context.sessionId,
          engine: context.engine,
          events: [],
          firstTokenReported: false,
          closed: false,
        };
        this.requests.set(requestId, state);
      }
      if (context.projectId) {
        state.projectId = context.projectId;
        this.projectToRequest.set(context.projectId, requestId);
      }
      if (context.sessionId) {
        state.sessionId = context.sessionId;
        this.sessionToRequest.set(context.sessionId, requestId);
      }
      if (context.engine) state.engine = context.engine;
    }

    const previous = state?.events[state.events.length - 1];
    const event: TraceEvent = {
      ts: now,
      iso: new Date(now).toISOString(),
      stage,
      request_id: requestId,
      session_id: context.sessionId || state?.sessionId,
      project_id: context.projectId || state?.projectId,
      engine: context.engine || state?.engine,
      since_request_start_ms: state ? now - state.startAt : undefined,
      since_prev_event_ms: previous ? now - previous.ts : undefined,
      data,
    };

    if (state) {
      state.events.push(event);
    }
    this.enqueueWrite(safeStringify(event));

    if (stage === "sse.first_token" && state && !state.firstTokenReported) {
      state.firstTokenReported = true;
      this.appendWaterfall(state, "first_token");
    }
    if (
      (stage === "sse.end_turn" ||
        stage === "acp.prompt.completed" ||
        stage === "chat.failed") &&
      state
    ) {
      state.closed = true;
      if (!state.firstTokenReported) {
        this.appendWaterfall(state, "closed_without_first_token");
      }
    }
  }

  private shouldSample(requestId: string): boolean {
    if (this.sampleRate >= 1) return true;
    if (this.sampleRate <= 0) return false;
    const cached = this.sampled.get(requestId);
    if (cached !== undefined) return cached;
    const md5 = crypto.createHash("md5").update(requestId).digest("hex");
    // 取 MD5 前 8 个 hex（32 bit）作为 [0, 2^32-1] 的整数，再除以 2^32 映射到 [0, 1)。
    // 必须用 2^32 作除数：若用 2^32-1，则最大哈希会得到 1.0，落在 [0,1) 之外且破坏均匀性。
    const v = parseInt(md5.slice(0, 8), 16) / 0x100000000;
    const keep = v < this.sampleRate;
    this.sampled.set(requestId, keep);
    return keep;
  }

  private enqueueWrite(line: string): void {
    this.writeBuffer.push(line);
    if (this.writeBuffer.length >= FirstTokenTrace.FLUSH_SIZE) {
      this.flushBuffer();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(
        () => this.flushBuffer(),
        FirstTokenTrace.FLUSH_INTERVAL_MS,
      );
    }
  }

  private flushBuffer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.writeBuffer.length === 0) return;
    const batch = this.writeBuffer.join("\n") + "\n";
    this.writeBuffer = [];
    fs.writeFile(
      this.logFile,
      batch,
      { flag: "a", encoding: "utf8" },
      (err) => {
        if (err) log.warn("[FirstTokenTrace] flush trace failed:", err);
      },
    );
  }

  private maybePrune(now: number): void {
    if (now - this.lastPruneAt < FirstTokenTrace.PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    for (const [requestId, state] of this.requests.entries()) {
      if (now - state.firstEventAt <= TRACE_TTL_MS) continue;
      this.requests.delete(requestId);
      this.sampled.delete(requestId);
      if (state.sessionId) this.sessionToRequest.delete(state.sessionId);
      if (state.projectId) this.projectToRequest.delete(state.projectId);
    }
  }

  private findStageAt(
    state: TraceRequestState,
    stage: string,
  ): number | undefined {
    const evt = state.events.find((e) => e.stage === stage);
    return evt?.ts;
  }

  private appendWaterfall(state: TraceRequestState, trigger: string): void {
    const events = state.events.filter(
      (e) =>
        !e.stage.startsWith("acp.stdout.") &&
        !e.stage.startsWith("acp.stderr.") &&
        !e.stage.startsWith("trace.config"),
    );
    if (events.length === 0) return;

    const startTs = this.findStageAt(state, "chat.received") ?? events[0].ts;
    const firstTokenTs = this.findStageAt(state, "sse.first_token");
    const chatEndTs = this.findStageAt(state, "chat.response.sent");
    const promptSentTs = this.findStageAt(state, "acp.prompt.sent");

    const segmentA = safeGap(startTs, chatEndTs);
    const segmentB = safeGap(promptSentTs, firstTokenTs);
    const total = safeGap(startTs, firstTokenTs);

    let bottleneckName = "(none)";
    let bottleneckMs = 0;
    for (let i = 1; i < events.length; i++) {
      const gap = events[i].ts - events[i - 1].ts;
      if (gap > bottleneckMs) {
        bottleneckMs = gap;
        bottleneckName = `${events[i - 1].stage} -> ${events[i].stage}`;
      }
    }

    const warmupHit = events.some((e) => e.stage === "warmup.reuse.hit");
    const warmupMiss = events.find((e) => e.stage === "warmup.reuse.miss");

    const lines: string[] = [];
    lines.push(
      `## ${new Date().toISOString()} rid=${shortId(state.requestId)} session=${shortId(
        state.sessionId,
      )}`,
    );
    lines.push("");
    lines.push(`- trigger: \`${trigger}\``);
    lines.push(`- request_id: \`${state.requestId}\``);
    lines.push(`- project_id: \`${state.projectId || "(none)"}\``);
    lines.push(`- session_id: \`${state.sessionId || "(none)"}\``);
    lines.push(`- engine: \`${state.engine || "(unknown)"}\``);
    lines.push(`- warmup: \`${warmupHit ? "hit" : "miss"}\``);
    if (warmupMiss?.data?.reason) {
      lines.push(`- warmup_miss_reason: \`${String(warmupMiss.data.reason)}\``);
    }
    lines.push(`- segment_A_chat: \`${formatMs(segmentA)}\``);
    lines.push(`- segment_B_prompt_to_first_token: \`${formatMs(segmentB)}\``);
    lines.push(`- total_first_token: \`${formatMs(total)}\``);
    lines.push(
      `- bottleneck_gap: \`${formatMs(bottleneckMs)}\` at \`${bottleneckName}\``,
    );
    lines.push("");
    lines.push("| Stage | Time | +From Start | +From Prev |");
    lines.push("| --- | --- | --- | --- |");
    for (const evt of events) {
      lines.push(
        `| ${evt.stage} | ${evt.iso} | ${formatMs(evt.ts - startTs)} | ${formatMs(evt.since_prev_event_ms)} |`,
      );
    }
    lines.push("");

    try {
      fs.appendFileSync(this.reportFile, `${lines.join("\n")}\n`, "utf8");
    } catch (e) {
      log.warn("[FirstTokenTrace] append report failed:", e);
    }
  }
}

export const firstTokenTrace = new FirstTokenTrace();
