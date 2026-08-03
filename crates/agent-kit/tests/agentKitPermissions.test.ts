import { describe, it, expect, vi } from "vitest";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  globToRegex,
  matchToolApprovalRules,
  normalizeToolApprovalRules,
  extractCommandValues,
  extractToolNameValues,
  runDecisionChain,
  createPendingService,
  pickAllow,
  pickReject,
  type PermissionStage,
  type PermissionDecision,
} from "../src/index.js";

/** Minimal ACP permission request fixture. */
function req(over: Partial<{
  toolCallId: string;
  kind: string;
  title: string;
  rawInput: unknown;
  options: { optionId: string; name: string; kind: string }[];
}>): RequestPermissionRequest {
  return {
    sessionId: "s1",
    toolCall: {
      toolCallId: over.toolCallId ?? "tc1",
      kind: over.kind,
      title: over.title,
      rawInput: over.rawInput,
      content: [],
      locations: [],
    },
    options:
      over.options ?? [
        { optionId: "o_allow", name: "Allow", kind: "allow_always" },
        { optionId: "o_reject", name: "Reject", kind: "reject_once" },
      ],
  };
}

describe("agent-kit toolApprovalRules", () => {
  it("globToRegex: * / ? / 字面转义 / 大小写不敏感", () => {
    expect(globToRegex("*").test("anything")).toBe(true);
    expect(globToRegex("rm *").test("rm -rf /tmp")).toBe(true);
    expect(globToRegex("?.log").test("a.log")).toBe(true);
    expect(globToRegex("?.log").test("ab.log")).toBe(false);
    expect(globToRegex("a.b").test("a.b")).toBe(true);
    expect(globToRegex("a.b").test("aXb")).toBe(false); // '.' 被转义
    expect(globToRegex("RUN").test("run")).toBe(true); // 大小写不敏感
  });

  it("matchToolApprovalRules: 命中 command 模式返回 action", () => {
    const r = req({ kind: "execute", rawInput: { command: "rm -rf /tmp" } });
    expect(
      matchToolApprovalRules(r, [
        { patterns: ["rm -rf *"], action: "ask" },
      ]),
    ).toBe("ask");
  });

  it("matchToolApprovalRules: tool_kind 过滤——kind 不匹配则跳过该规则", () => {
    const r = req({ kind: "execute", rawInput: { command: "rm -rf x" } });
    // tool_kind=bash 不匹配 execute
    expect(
      matchToolApprovalRules(r, [
        { patterns: ["rm *"], action: "deny", tool_kind: "bash" },
      ]),
    ).toBeNull();
    // tool_kind 缺失（通用规则）匹配
    expect(
      matchToolApprovalRules(r, [{ patterns: ["rm *"], action: "deny" }]),
    ).toBe("deny");
  });

  it("matchToolApprovalRules: 首条命中胜出（顺序敏感）", () => {
    const r = req({ kind: "execute", rawInput: { command: "git push" } });
    expect(
      matchToolApprovalRules(r, [
        { patterns: ["git *"], action: "allow" },
        { patterns: ["git push"], action: "ask" },
      ]),
    ).toBe("allow");
  });

  it("matchToolApprovalRules: 无命中返回 null", () => {
    const r = req({ kind: "execute", rawInput: { command: "ls" } });
    expect(matchToolApprovalRules(r, [{ patterns: ["rm *"], action: "deny" }])).toBeNull();
  });

  it("normalizeToolApprovalRules: kind 别名映射到 tool_kind；空数组返回 undefined", () => {
    expect(normalizeToolApprovalRules(undefined)).toBeUndefined();
    expect(normalizeToolApprovalRules([])).toBeUndefined();
    const [rule] = normalizeToolApprovalRules([
      { patterns: ["x"], action: "ask", kind: "bash" },
    ])!;
    expect(rule.tool_kind).toBe("bash");
    expect(rule.patterns).toEqual(["x"]);
  });

  it("extractCommandValues / extractToolNameValues", () => {
    expect(extractCommandValues({ command: "a", cmd: "b" })).toEqual(["a", "b"]);
    expect(extractCommandValues("raw string")).toEqual(["raw string"]);
    expect(extractCommandValues({ x: 1 })).toEqual([]);
    const r = req({ title: "Git Push", rawInput: { tool: "git" } });
    expect(extractToolNameValues(r)).toContain("git");
    expect(extractToolNameValues(r)).toContain("Git"); // title 首词
  });
});

describe("agent-kit runDecisionChain", () => {
  type Ctx = { mode: string };

  it("首个终结阶段胜出", () => {
    const pass: PermissionStage<Ctx> = () => null;
    const win: PermissionStage<Ctx> = () => ({
      kind: "select",
      optionId: "o",
      reason: "r",
    });
    const r = req({});
    expect(runDecisionChain([pass, win], r, { mode: "x" }).kind).toBe("select");
  });

  it("一旦某阶段终结，后续阶段不再调用", () => {
    const later = vi.fn<PermissionStage<Ctx>>(() => ({
      kind: "cancel",
      reason: "never",
    }));
    const first = vi.fn<PermissionStage<Ctx>>(() => ({
      kind: "cancel",
      reason: "first",
    }));
    const r = req({});
    const d = runDecisionChain([first, later], r, { mode: "x" });
    expect((d as { reason: string }).reason).toBe("first");
    expect(later).not.toHaveBeenCalled();
  });

  it("全部 pass 时安全兜底 ask", () => {
    const d = runDecisionChain<Ctx>([() => null, () => null], req({}), { mode: "x" });
    expect(d.kind).toBe("ask");
  });
});

describe("agent-kit createPendingService", () => {
  function allowResponse(): RequestPermissionResponse {
    return { outcome: { outcome: "selected", optionId: "o_allow" } };
  }

  it("idFactory 覆盖默认 itv_ 前缀", () => {
    const svc = createPendingService({ idFactory: () => "custom-id" });
    const { interventionId } = svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({}),
    });
    expect(interventionId).toBe("custom-id");
  });

  it("支持宿主提供 interventionId，并可只读查询 revision", () => {
    const svc = createPendingService({ defaultTimeoutMs: 0 });
    const created = svc.createPending({
      interventionId: "host-itv",
      appSessionId: "a",
      acpSessionId: "s",
      request: req({}),
      revision: 3,
    });
    expect(created.interventionId).toBe("host-itv");
    expect(svc.getPendingByInterventionId("host-itv")?.revision).toBe(3);
  });

  it("resolve 触发 onResolved 回调（含 reason）", async () => {
    const onResolved = vi.fn();
    const svc = createPendingService({
      onResolved,
      defaultTimeoutMs: 0, // 关掉超时避免干扰
    });
    const { interventionId, promise } = svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({}),
    });
    const result = svc.resolveByInterventionId(interventionId, allowResponse());
    expect(result.ok).toBe(true);
    await promise;
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ interventionId, reason: "resolved" }),
    );
  });

  it("resolve 后短期保留：同 key 再 resolve 返回 already_resolved", () => {
    const svc = createPendingService({ defaultTimeoutMs: 0, retentionMs: 60_000 });
    svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({ toolCallId: "tc" }),
    });
    svc.resolveBySessionTool("s", "tc", allowResponse());
    const again = svc.resolveBySessionTool("s", "tc", allowResponse());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.hostStatus).toBe("already_resolved");
  });

  it("retentionMs=0 不保留 resolved 记录", () => {
    const svc = createPendingService({ defaultTimeoutMs: 0, retentionMs: 0 });
    svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({ toolCallId: "tc" }),
    });
    svc.resolveBySessionTool("s", "tc", allowResponse());
    expect(svc.resolveBySessionTool("s", "tc", allowResponse())).toMatchObject({
      ok: false,
      hostStatus: "gone",
    });
  });

  it("取消原因由宿主透传给 onResolved", () => {
    const onResolved = vi.fn();
    const svc = createPendingService({ defaultTimeoutMs: 0, onResolved });
    svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({}),
    });
    svc.cancelByAcpSession("s", "superseded");
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "superseded" }),
    );
  });

  it("hasPendingForAcpSession / cancelByAcpSession（nuwaclaw 下轮用）", () => {
    const svc = createPendingService({ defaultTimeoutMs: 0 });
    svc.createPending({
      appSessionId: "a",
      acpSessionId: "s1",
      request: req({ toolCallId: "t1" }),
    });
    expect(svc.hasPendingForAcpSession("s1")).toBe(true);
    expect(svc.hasPendingForAcpSession("s2")).toBe(false);
    svc.cancelByAcpSession("s1");
    expect(svc.hasPendingForAcpSession("s1")).toBe(false);
    expect(svc.pendingCount).toBe(0);
  });

  it("optionId 白名单：非法 optionId 被拒", () => {
    const svc = createPendingService({ defaultTimeoutMs: 0 });
    const { interventionId } = svc.createPending({
      appSessionId: "a",
      acpSessionId: "s",
      request: req({}),
    });
    const r = svc.resolveByInterventionId(interventionId, {
      outcome: { outcome: "selected", optionId: "not-an-option" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("agent-kit option pickers（行为锚定）", () => {
  it("pickAllow 选 allow_always，pickReject 选 reject_once", () => {
    const r = req({});
    expect((pickAllow(r) as { optionId: string }).optionId).toBe("o_allow");
    expect((pickReject(r) as { optionId: string }).optionId).toBe("o_reject");
  });

  it("pickAllow 缺 allow 选项时 cancel", () => {
    const r = req({
      options: [{ optionId: "o", name: "X", kind: "other" }],
    });
    expect(pickAllow(r).kind).toBe("cancel");
  });
});

// 显式引用避免未使用告警
void ({} as PermissionDecision);
