/**
 * ttyd 终端 query 契约参数单元测试（纯函数，无 mock）。
 *
 * 语义基准：rcoder crates/rcoder-proxy/src/service/handlers/ttyd_params.rs
 * 与 shared_types/src/validation.rs 的 normalize_absolute_dir（TS 孪生对齐）。
 */
import { describe, expect, it } from "vitest";
import {
  parseTtydRouteParams,
  validateTtydServiceTypeValue,
  normalizeTtydAbsoluteDir,
  DEFAULT_TTYD_SERVICE_TYPE,
} from "./ttydRouteParams";

describe("parseTtydRouteParams · service_type", () => {
  it("无 query → 默认 computer-agent-runner，cwd null", () => {
    expect(parseTtydRouteParams(new URLSearchParams(""))).toEqual({
      ok: true,
      serviceType: DEFAULT_TTYD_SERVICE_TYPE,
      cwd: null,
    });
  });

  it("合法 kebab-case 枚举值通过", () => {
    expect(
      parseTtydRouteParams(
        new URLSearchParams("service_type=computer-normal-project"),
      ),
    ).toEqual({
      ok: true,
      serviceType: "computer-normal-project",
      cwd: null,
    });
    expect(
      parseTtydRouteParams(
        new URLSearchParams("service_type=computer-agent-runner"),
      ),
    ).toEqual({
      ok: true,
      serviceType: "computer-agent-runner",
      cwd: null,
    });
  });

  it("camelCase/PascalCase 兼容词归一为枚举（对齐 rcoder FromStr 词表）", () => {
    for (const [word, expected] of [
      ["normalProject", "computer-normal-project"],
      ["ComputerNormalProject", "computer-normal-project"],
      ["ComputerAgentRunner", "computer-agent-runner"],
    ] as const) {
      const result = parseTtydRouteParams(
        new URLSearchParams(`service_type=${word}`),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.serviceType).toBe(expected);
    }
  });

  it("拼错/大小写错乱/非 computer 族 → TTYD_SERVICE_TYPE_INVALID", () => {
    for (const bad of [
      "bogus",
      "Computer-Normal-Project",
      "cloud-normal-project",
      "web-agent-runner",
      "user-app",
      "userapp",
      " ",
    ]) {
      const result = parseTtydRouteParams(
        new URLSearchParams(`service_type=${encodeURIComponent(bad)}`),
      );
      expect(result).toEqual({
        ok: false,
        code: "TTYD_SERVICE_TYPE_INVALID",
        message: expect.stringContaining("invalid service_type") as unknown,
      });
    }
  });

  it("重复键 last-wins（对齐服务端，重复不 400）", () => {
    const result = parseTtydRouteParams(
      new URLSearchParams(
        "service_type=computer-agent-runner&service_type=computer-normal-project",
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serviceType).toBe("computer-normal-project");
    }
  });
});

describe("parseTtydRouteParams · cwd 归一词汇表", () => {
  it("POSIX 绝对路径原样通过（空格/中文保留）", () => {
    for (const good of ["/home/user/proj", "/tmp/my dir", "/tmp/我的项目"]) {
      const result = parseTtydRouteParams(
        new URLSearchParams(`cwd=${encodeURIComponent(good)}`),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.cwd).toBe(good);
    }
  });

  it("相对路径 → 400", () => {
    for (const bad of ["home/x", "./x", "x", "~", "~/x"]) {
      const result = parseTtydRouteParams(
        new URLSearchParams(`cwd=${encodeURIComponent(bad)}`),
      );
      expect(result).toMatchObject({
        ok: false,
        code: "TTYD_CWD_INVALID",
      });
    }
  });

  it("点段 → 400（含归一前混合分隔符形态）", () => {
    for (const bad of [
      "/home/../etc",
      "/home/./x",
      "/home\\..\\etc",
      "..",
      "/..",
    ]) {
      const result = normalizeTtydAbsoluteDir(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("控制字符（NUL/换行/DEL）→ 400", () => {
    for (const bad of ["/a\u0000b", "/a\nb", "/a\rb", "/a\u007Fb"]) {
      const result = normalizeTtydAbsoluteDir(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("超长 → 400；恰好 512 通过", () => {
    const at513 = `/${"a".repeat(512)}`;
    expect(normalizeTtydAbsoluteDir(at513).ok).toBe(false);
    const at512 = `/${"a".repeat(511)}`;
    expect(normalizeTtydAbsoluteDir(at512).ok).toBe(true);
  });

  it("空串与纯空白 → 400（非绝对路径）", () => {
    expect(parseTtydRouteParams(new URLSearchParams("cwd=")).ok).toBe(false);
    expect(normalizeTtydAbsoluteDir("  ").ok).toBe(false);
  });

  it("前后空白被 trim", () => {
    const result = normalizeTtydAbsoluteDir("  /tmp/x  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/tmp/x");
  });

  it("反斜杠形态折叠为 / 形态（多平台输入容错）", () => {
    const result = normalizeTtydAbsoluteDir("\\home\\user\\x");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/home/user/x");
    const collapsed = normalizeTtydAbsoluteDir("/home//user/x");
    expect(collapsed.ok).toBe(true);
    if (collapsed.ok) expect(collapsed.value).toBe("/home/user/x");
  });

  it("Windows 盘符形态：小写盘符统一大写", () => {
    const result = normalizeTtydAbsoluteDir("c:/Users/dev/proj");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("C:/Users/dev/proj");
  });

  it("Windows verbatim 前缀剥离（含 UNC verbatim）", () => {
    const drive = normalizeTtydAbsoluteDir("\\\\?\\C:\\Users\\dev\\proj");
    expect(drive.ok).toBe(true);
    if (drive.ok) expect(drive.value).toBe("C:/Users/dev/proj");
    const unc = normalizeTtydAbsoluteDir("\\\\?\\UNC\\server\\share\\proj");
    expect(unc.ok).toBe(true);
    if (unc.ok) expect(unc.value).toBe("//server/share/proj");
  });

  it("UNC 前导 // 保留", () => {
    const result = normalizeTtydAbsoluteDir("//server/share/proj");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("//server/share/proj");
  });
});

describe("parseTtydRouteParams · 组合", () => {
  it("service_type + cwd 同传，form 解码空格/加号语义正确", () => {
    // form 语义：+ 与 %20 均为空格；字面 + 须 %2B（URLSearchParams 天然满足）
    const params = new URLSearchParams(
      "service_type=computer-normal-project&cwd=%2Fhome%2Fuser%2Fmy+dir",
    );
    const result = parseTtydRouteParams(params);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serviceType).toBe("computer-normal-project");
      expect(result.cwd).toBe("/home/user/my dir");
    }
  });

  it("cwd 重复键 last-wins", () => {
    const result = parseTtydRouteParams(
      new URLSearchParams("cwd=%2Fa&cwd=%2Fb"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cwd).toBe("/b");
  });

  it("无关参数不影响契约参数解析", () => {
    const result = parseTtydRouteParams(
      new URLSearchParams("foo=1&service_type=computer-normal-project&bar=2"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.serviceType).toBe("computer-normal-project");
  });
});

describe("validateTtydServiceTypeValue", () => {
  it("空串/未收录词返回错误", () => {
    expect(validateTtydServiceTypeValue("").ok).toBe(false);
    expect(validateTtydServiceTypeValue("web-agent-runner").ok).toBe(false);
  });
});
