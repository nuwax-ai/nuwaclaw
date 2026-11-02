/**
 * ttydGateway 路由 query 契约测试（service_type / cwd，对齐 rcoder ttyd_params.rs）。
 *
 * 覆盖：三态解析（ok/invalid/not-found）、已消费参数剥离、cwd 求解优先级
 * （cwd query > arg=--cwd 存量通道 > service_type 推导 > 现有链）、冲突 400、
 * normalProject 镜像目录命中/回落、URL 编码回合。存量行为锁定见
 * ttydGateway.cwd.test.ts（文件级冻结）。
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "home") return os.tmpdir();
      return "/mock/appdata";
    }),
    isPackaged: false,
  },
}));

vi.mock("../../db", () => ({
  readSetting: vi.fn(() => null),
}));

vi.mock("../engines/unifiedAgent", () => ({
  agentService: {
    getAgentConfig: vi.fn((): { workspaceDir: string } | null => null),
    getRecentWorkspaceDir: vi.fn(() => null),
  },
}));

const initialCwdMock = vi.fn(() => "/fallback/workspace");
vi.mock("./ttydHelper", () => ({
  getTtydInitialCwd: () => initialCwdMock(),
}));

import { parseTtydRoute, resolveRouteCwd } from "./ttydGateway";
import { agentService } from "../engines/unifiedAgent";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ttyd-gw-route-"));
const baseWorkspace = path.join(tmpRoot, "ws");
fs.mkdirSync(baseWorkspace, { recursive: true });

vi.mocked(agentService.getAgentConfig).mockReturnValue({
  workspaceDir: baseWorkspace,
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** 从 targetPath 解析回 arg 参数列表（解码回合断言用） */
function argValues(targetPath: string): string[] {
  return new URL(`http://127.0.0.1${targetPath}`).searchParams.getAll("arg");
}

function makeNonEmptyDir(...segments: string[]): string {
  const dir = path.join(baseWorkspace, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  return dir;
}

describe("parseTtydRoute · 三态解析", () => {
  it("路径不匹配 → not-found", () => {
    for (const url of [
      "/computer/ttyd/u1/ws",
      "/other/ttyd/u1/p1/ws",
      "/computer/vnc/u1/p1/ws",
      "/",
    ]) {
      expect(parseTtydRoute(url)).toEqual({ kind: "not-found" });
    }
  });

  it("无 query 的存量 /ws → ok 且注入推导 cwd（回归锁，serviceType=默认）", () => {
    const route = parseTtydRoute("/computer/ttyd/u1/p1/ws");
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.serviceType).toBe("computer-agent-runner");
      expect(route.cwd).toBe("/fallback/workspace");
      expect(argValues(route.targetPath)).toEqual([
        "--cwd",
        "/fallback/workspace",
      ]);
    }
  });
});

describe("parseTtydRoute · query 契约参数", () => {
  it("非法 service_type → invalid（含 code/message）", () => {
    const route = parseTtydRoute("/computer/ttyd/u1/p1/ws?service_type=bogus");
    expect(route).toEqual({
      kind: "invalid",
      code: "TTYD_SERVICE_TYPE_INVALID",
      message: expect.stringContaining("invalid service_type") as unknown,
    });
  });

  it("非 computer 族 service_type（web-agent-runner）→ invalid", () => {
    const route = parseTtydRoute(
      "/computer/ttyd/u1/p1/ws?service_type=web-agent-runner",
    );
    expect(route).toMatchObject({
      kind: "invalid",
      code: "TTYD_SERVICE_TYPE_INVALID",
    });
  });

  it("非法 cwd（相对路径）→ invalid", () => {
    const route = parseTtydRoute("/computer/ttyd/u1/p1/ws?cwd=relative/path");
    expect(route).toMatchObject({ kind: "invalid", code: "TTYD_CWD_INVALID" });
  });

  it("合法 service_type + 无关参数：已消费参数剥离、无关参数透传、arg 注入", () => {
    const route = parseTtydRoute(
      "/computer/ttyd/u1/p1/ws?service_type=computer-normal-project&foo=1",
    );
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.serviceType).toBe("computer-normal-project");
      const forwarded = new URL(`http://127.0.0.1${route.targetPath}`);
      expect(forwarded.searchParams.get("service_type")).toBeNull();
      expect(forwarded.searchParams.get("cwd")).toBeNull();
      expect(forwarded.searchParams.get("foo")).toBe("1");
      expect(forwarded.searchParams.getAll("arg")).toEqual([
        "--cwd",
        expect.any(String),
      ]);
    }
  });

  it("cwd 与存量 arg=--cwd 冲突 → TTYD_CWD_CONFLICT；等值放行", () => {
    expect(
      parseTtydRoute("/computer/ttyd/u1/p1/ws?cwd=/a&arg=--cwd&arg=/b"),
    ).toEqual({
      kind: "invalid",
      code: "TTYD_CWD_CONFLICT",
      message: expect.stringContaining("conflicts") as unknown,
    });

    const equal = parseTtydRoute(
      `/computer/ttyd/u1/p1/ws?cwd=${encodeURIComponent(
        "/tmp/x",
      )}&arg=--cwd&arg=${encodeURIComponent("/tmp/x")}`,
    );
    expect(equal.kind).toBe("ok");
    if (equal.kind === "ok") {
      expect(equal.cwd).toBe("/tmp/x");
      // 显式 arg 已在，不重复注入
      expect(argValues(equal.targetPath)).toEqual(["--cwd", "/tmp/x"]);
    }
  });

  it("cwd 与 arg=--cwd 同目录不同写法（归一化等值）→ 不误报冲突", () => {
    // cwd query 归一为 C:/x，argCwd 原始为 C:\x——同一目录不应 400。
    // C:/x 在测试机不存在 → 显式 cwd 回落 arg 通道原始值（转发后由 wrapper 判定）。
    const route = parseTtydRoute(
      `/computer/ttyd/u1/p1/ws?cwd=C%3A%2Fx&arg=--cwd&arg=${encodeURIComponent(
        "C:\\x",
      )}`,
    );
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.cwd).toBe("C:\\x");
    }
  });
});

describe("parseTtydRoute · cwd 求解优先级", () => {
  it("显式 cwd 目录存在 → 用该值（不走推导链）", () => {
    const dir = makeNonEmptyDir("explicit-target");
    const route = parseTtydRoute(
      `/computer/ttyd/u1/p1/ws?cwd=${encodeURIComponent(dir)}`,
    );
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.cwd).toBe(dir);
      expect(argValues(route.targetPath)).toEqual(["--cwd", dir]);
    }
  });

  it("显式 cwd 目录不存在 → warn 回落推导链值", () => {
    const route = parseTtydRoute(
      `/computer/ttyd/u1/p1/ws?cwd=${encodeURIComponent(
        path.join(tmpRoot, "no-such-dir"),
      )}`,
    );
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.cwd).toBe("/fallback/workspace");
    }
  });

  it("仅有存量 arg=--cwd 通道（IPC）→ 不注入不剥离，route.cwd 取该值", () => {
    const route = parseTtydRoute(
      `/computer/ttyd/u1/p1/ws?arg=--cwd&arg=${encodeURIComponent("/tmp/ipc-dir")}`,
    );
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.cwd).toBe("/tmp/ipc-dir");
      expect(argValues(route.targetPath)).toEqual(["--cwd", "/tmp/ipc-dir"]);
    }
  });

  it("URL 编码回合：空格/中文 cwd 注入后解码还原（form 语义）", () => {
    const dir = makeNonEmptyDir("我的 dir");
    const encoded = encodeURIComponent(dir).replace(/%20/g, "+");
    const route = parseTtydRoute(`/computer/ttyd/u1/p1/ws?cwd=${encoded}`);
    expect(route.kind).toBe("ok");
    if (route.kind === "ok") {
      expect(route.cwd).toBe(dir);
      expect(argValues(route.targetPath)).toEqual(["--cwd", dir]);
    }
  });
});

describe("resolveRouteCwd · normalProject 分支", () => {
  it("镜像目录存在且非空 → 命中 normalProject 层", () => {
    const dir = makeNonEmptyDir(
      "computer-project-workspace",
      "6",
      "normalProject",
      "p9",
    );
    expect(
      resolveRouteCwd("6", "p9", { serviceType: "computer-normal-project" }),
    ).toBe(dir);
  });

  it("镜像目录为空（新项目初始态，chat mkdir 后引擎尚未写入）→ 仍命中（对齐云端 is_dir 语义）", () => {
    const dir = path.join(
      baseWorkspace,
      "computer-project-workspace",
      "6",
      "normalProject",
      "p-empty",
    );
    fs.mkdirSync(dir, { recursive: true }); // 只建目录，不放内容
    expect(
      resolveRouteCwd("6", "p-empty", {
        serviceType: "computer-normal-project",
      }),
    ).toBe(dir);
  });

  it("镜像目录不存在 → 不走平铺层，直接回落 getTtydInitialCwd（防跨轨道撞号污染）", () => {
    // 同数字 id 的普通会话平铺工作区存在且非空——normalProject miss 也不得落进去
    const flatDir = makeNonEmptyDir("computer-project-workspace", "6", "p10");
    expect(
      resolveRouteCwd("6", "p10", { serviceType: "computer-normal-project" }),
    ).toBe("/fallback/workspace");
    expect(flatDir).toBeTruthy();
  });

  it("镜像目录空且拼接目录也不可用 → 回落 getTtydInitialCwd", () => {
    expect(
      resolveRouteCwd("6", "p-miss", {
        serviceType: "computer-normal-project",
      }),
    ).toBe("/fallback/workspace");
  });

  it("userId 轨道不可信 → 按 projectId 反查 normalProject 层唯一命中", () => {
    const dir = makeNonEmptyDir(
      "computer-project-workspace",
      "6",
      "normalProject",
      "p7",
    );
    expect(
      resolveRouteCwd("local", "p7", {
        serviceType: "computer-normal-project",
      }),
    ).toBe(dir);
  });

  it("normalProject 层多命中不猜 → 回落现有链", () => {
    makeNonEmptyDir("computer-project-workspace", "6", "normalProject", "p8");
    makeNonEmptyDir("computer-project-workspace", "7", "normalProject", "p8");
    expect(
      resolveRouteCwd("local", "p8", {
        serviceType: "computer-normal-project",
      }),
    ).toBe("/fallback/workspace");
  });

  it("旧签名两参调用（存量用法）行为不变（回归锁）", () => {
    const dir = makeNonEmptyDir("computer-project-workspace", "6", "legacy-p");
    expect(resolveRouteCwd("6", "legacy-p")).toBe(dir);
  });
});
