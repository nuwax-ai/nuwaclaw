import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  validateAgentWorkDirInput,
  isAbsoluteAgentWorkDir,
  isNormalProjectServiceType,
  extractNormalProjectContainerPid,
} from "./agentWorkDir";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-work-dir-"));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("validateAgentWorkDirInput · 标识符轨道（存量行为回归）", () => {
  it("accepts plain identifiers", () => {
    expect(validateAgentWorkDirInput("proj-1")).toEqual({
      ok: true,
      kind: "id",
      value: "proj-1",
    });
    expect(validateAgentWorkDirInput("A_b_0")).toEqual({
      ok: true,
      kind: "id",
      value: "A_b_0",
    });
  });

  it("rejects empty and >64 chars", () => {
    expect(validateAgentWorkDirInput("").code).toBe("AGENT_WORK_DIR_INVALID");
    expect(validateAgentWorkDirInput("a".repeat(65)).code).toBe(
      "AGENT_WORK_DIR_INVALID",
    );
  });

  it("rejects separators, traversal and non-identifier chars", () => {
    // 非 + 非绝对（如相对路径/穿越段）全部落标识符轨道被正则拒绝
    for (const bad of ["a/b", "../etc", "..", "a b", "中", "a:b"]) {
      expect(validateAgentWorkDirInput(bad).code).toBe(
        "AGENT_WORK_DIR_INVALID",
      );
    }
  });
});

describe("validateAgentWorkDirInput · 绝对路径轨道", () => {
  it("accepts an existing writable directory and normalizes via realpath", () => {
    const dir = path.join(tmpRoot, "proj-a");
    fs.mkdirSync(dir, { recursive: true });
    const result = validateAgentWorkDirInput(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("abs");
      expect(result.value).toBe(fs.realpathSync(dir));
    }
  });

  it("resolves symlink to its target (唯一形态)", () => {
    const target = path.join(tmpRoot, "symlink-target");
    const link = path.join(tmpRoot, "symlink-link");
    fs.mkdirSync(target, { recursive: true });
    try {
      fs.symlinkSync(target, link);
    } catch {
      // 无符号链接权限的环境（部分 CI）跳过
      return;
    }
    const result = validateAgentWorkDirInput(link);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(fs.realpathSync(target));
  });

  it("classifies nonexistent path as NOT_FOUND", () => {
    const result = validateAgentWorkDirInput(path.join(tmpRoot, "no-such-dir"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AGENT_WORK_DIR_NOT_FOUND");
      expect(result.message).toContain("no-such-dir");
    }
  });

  it("classifies a file as NOT_A_DIRECTORY", () => {
    const file = path.join(tmpRoot, "plain-file.txt");
    fs.writeFileSync(file, "x");
    const result = validateAgentWorkDirInput(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_WORK_DIR_NOT_A_DIRECTORY");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "classifies read-only directory as NOT_WRITABLE (posix 非 root)",
    () => {
      const ro = path.join(tmpRoot, "read-only");
      fs.mkdirSync(ro, { recursive: true });
      fs.chmodSync(ro, 0o555);
      try {
        const result = validateAgentWorkDirInput(ro);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe("AGENT_WORK_DIR_NOT_WRITABLE");
        }
      } finally {
        fs.chmodSync(ro, 0o755);
      }
    },
  );

  it("rejects absurdly long paths", () => {
    const result = validateAgentWorkDirInput(`${tmpRoot}${"/x".repeat(4096)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_WORK_DIR_INVALID");
  });

  it.skipIf(process.platform !== "win32")(
    "windows: accepts drive-letter absolute path",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-awd-"));
      const result = validateAgentWorkDirInput(dir);
      expect(result.ok).toBe(true);
    },
  );
});

describe("isAbsoluteAgentWorkDir", () => {
  it("delegates to path.isAbsolute platform semantics", () => {
    expect(isAbsoluteAgentWorkDir("/Users/x/proj")).toBe(true);
    expect(isAbsoluteAgentWorkDir("proj-1")).toBe(false);
    expect(isAbsoluteAgentWorkDir("../etc")).toBe(false);
  });
});

describe("validateAgentWorkDirInput · normalProject 轨道（三轨制）", () => {
  it("service_type=computer-normal-project + 单段名 → normal-project 轨道，value 不变", () => {
    expect(
      validateAgentWorkDirInput("np-9", {
        serviceType: "computer-normal-project",
      }),
    ).toEqual({ ok: true, kind: "normal-project", value: "np-9" });
  });

  it("camelCase 旧词 normalProject 同样命中（对齐 rcoder FromStr 兼容词）", () => {
    expect(
      validateAgentWorkDirInput("np-9", { serviceType: "normalProject" }),
    ).toEqual({ ok: true, kind: "normal-project", value: "np-9" });
  });

  it("service_type=computer-agent-runner + 单段名 → 维持标识符轨道（存量行为）", () => {
    expect(
      validateAgentWorkDirInput("c-1", {
        serviceType: "computer-agent-runner",
      }),
    ).toEqual({ ok: true, kind: "id", value: "c-1" });
  });

  it("容器物化形态 /home/user/normalProject/{pid} → 提取 pid，service_type 缺失也命中", () => {
    // 双轨制下该形态会因目录不存在被 NOT_FOUND 误拒（mac/win 上必然）
    for (const serviceType of [undefined, "computer-normal-project"]) {
      expect(
        validateAgentWorkDirInput("/home/user/normalProject/np-9", {
          serviceType,
        }),
      ).toEqual({ ok: true, kind: "normal-project", value: "np-9" });
    }
  });

  it("容器前缀但 pid 非法（嵌套段/非法字符/超长）→ 落绝对路径轨道 NOT_FOUND", () => {
    for (const bad of [
      "/home/user/normalProject/a/b",
      "/home/user/normalProject/a b",
      `/home/user/normalProject/${"a".repeat(65)}`,
    ]) {
      const result = validateAgentWorkDirInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("AGENT_WORK_DIR_NOT_FOUND");
    }
  });

  it("normalProject + 本机自选绝对目录 → 维持绝对路径轨道（agentWorkspacePath 覆盖场景）", () => {
    const dir = path.join(tmpRoot, "np-picked");
    fs.mkdirSync(dir, { recursive: true });
    const result = validateAgentWorkDirInput(dir, {
      serviceType: "computer-normal-project",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("abs");
      expect(result.value).toBe(fs.realpathSync(dir));
    }
  });

  it("无 options 的存量调用：标识符/绝对路径两轨行为完全不变（回归锁）", () => {
    expect(validateAgentWorkDirInput("proj-1")).toEqual({
      ok: true,
      kind: "id",
      value: "proj-1",
    });
    const dir = path.join(tmpRoot, "regression-dir");
    fs.mkdirSync(dir, { recursive: true });
    const result = validateAgentWorkDirInput(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("abs");
  });
});

describe("isNormalProjectServiceType", () => {
  it("接受 kebab/camel/Pascal 形态，拒绝空值与其余值", () => {
    expect(isNormalProjectServiceType("computer-normal-project")).toBe(true);
    expect(isNormalProjectServiceType("normalProject")).toBe(true);
    expect(isNormalProjectServiceType("ComputerNormalProject")).toBe(true);
    expect(isNormalProjectServiceType(undefined)).toBe(false);
    expect(isNormalProjectServiceType("")).toBe(false);
    expect(isNormalProjectServiceType("computer-agent-runner")).toBe(false);
    expect(isNormalProjectServiceType("web-agent-runner")).toBe(false);
  });
});

describe("extractNormalProjectContainerPid", () => {
  it("合法物化形态提取 pid", () => {
    expect(
      extractNormalProjectContainerPid("/home/user/normalProject/42"),
    ).toBe("42");
    expect(
      extractNormalProjectContainerPid("/home/user/normalProject/np_9-a"),
    ).toBe("np_9-a");
  });

  it("非物化形态返回 null", () => {
    for (const bad of [
      "/home/user/42",
      "/home/user/normalProject/",
      "/home/user/normalProject/a/b",
      "/home/user/normalProject/a b",
      "normalProject/42",
      "/home/other/normalProject/42",
    ]) {
      expect(extractNormalProjectContainerPid(bad)).toBeNull();
    }
  });
});
