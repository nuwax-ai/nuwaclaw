/**
 * 单元测试: constants 端口偏移注入（NUWAX_PORT_OFFSET）
 *
 * 商业版构建（nuwa-work 壳）注入 NUWAX_PORT_OFFSET=1000 → 19099/61002~61009/61173，
 * 与社区版（60xxx/18099）、nuwa-cli（60015/60016/10076）三方错开；
 * 不注入时全部回落社区默认值。构建期 define 的运行时等价物。
 */

import { describe, it, expect, afterEach, vi } from "vitest";

describe("NUWAX_PORT_OFFSET 注入", () => {
  afterEach(() => {
    delete process.env.NUWAX_PORT_OFFSET;
    vi.resetModules();
  });

  it("未注入时回落社区默认端口", async () => {
    delete process.env.NUWAX_PORT_OFFSET;
    const c = await import("./constants");
    expect(c.NUWAX_PORT_OFFSET).toBe(0);
    expect(c.DEFAULT_MCP_PROXY_PORT).toBe(18099);
    expect(c.DEFAULT_LANPROXY_PORT).toBe(60002);
    expect(c.DEFAULT_FILE_SERVER_PORT).toBe(60005);
    expect(c.DEFAULT_AGENT_RUNNER_PORT).toBe(60006);
    expect(c.DEFAULT_ADMIN_SERVER_PORT).toBe(60007);
    expect(c.DEFAULT_GUI_MCP_PORT).toBe(60008);
    expect(c.DEFAULT_TTYD_PORT).toBe(60009);
    expect(c.DEFAULT_DEV_SERVER_PORT).toBe(60173);
  });

  it("注入 1000 时全部默认端口整体 +1000", async () => {
    process.env.NUWAX_PORT_OFFSET = "1000";
    const c = await import("./constants");
    expect(c.NUWAX_PORT_OFFSET).toBe(1000);
    expect(c.DEFAULT_MCP_PROXY_PORT).toBe(19099);
    expect(c.DEFAULT_LANPROXY_PORT).toBe(61002);
    expect(c.DEFAULT_FILE_SERVER_PORT).toBe(61005);
    expect(c.DEFAULT_AGENT_RUNNER_PORT).toBe(61006);
    expect(c.DEFAULT_ADMIN_SERVER_PORT).toBe(61007);
    expect(c.DEFAULT_GUI_MCP_PORT).toBe(61008);
    expect(c.DEFAULT_TTYD_PORT).toBe(61009);
    expect(c.DEFAULT_DEV_SERVER_PORT).toBe(61173);
  });

  it("非数字注入按 0 处理", async () => {
    process.env.NUWAX_PORT_OFFSET = "abc";
    const c = await import("./constants");
    expect(c.NUWAX_PORT_OFFSET).toBe(0);
    expect(c.DEFAULT_AGENT_RUNNER_PORT).toBe(60006);
  });

  it("负值注入按 0 处理（不允许向下偏移）", async () => {
    process.env.NUWAX_PORT_OFFSET = "-1000";
    const c = await import("./constants");
    expect(c.NUWAX_PORT_OFFSET).toBe(0);
    expect(c.DEFAULT_AGENT_RUNNER_PORT).toBe(60006);
  });
});
