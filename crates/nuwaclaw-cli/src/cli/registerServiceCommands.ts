import type { Command } from "commander";
import { serveCommand } from "../commands/serve.js";
import { upCommand } from "../commands/up.js";
import { addCloudLoginOptions, addServeRuntimeOptions } from "./options.js";

export function registerServiceCommands(program: Command): void {
  addServeRuntimeOptions(
    program
      .command("serve")
      .description("启动本机 HTTP API（chat + SSE），供脚本/云端/IM 远程调度")
      .option("--engine <engine>", "使用的引擎：claude 或 codex", "claude")
      .option("--tunnel", "登录后启动本地 nuwax-file-server 与 lanproxy 隧道"),
  ).action(serveCommand);

  addServeRuntimeOptions(
    addCloudLoginOptions(
      program
        .command("up")
        .description(
          "一键检测引擎、登录/注册并启动 serve --tunnel；不传账号则用当前默认账号",
        ),
    ).option(
      "--engine <engine>",
      "使用的引擎：claude 或 codex；不传则自动选择",
    ),
  )
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - 不传 --domain / -u / --saved-key 时，使用当前默认账号 savedKey 免密注册。",
        "  - 使用 -u 时，若 credentials.json 中已有同 domain+username 的 savedKey，会随注册请求一起提交，避免新建电脑。",
        "  - 密码通过交互输入；CI 可用 NUWACLAW_PASSWORD，且该变量不会传给 engine/lanproxy/file-server。",
        "  - 未传 --engine 时自动检测 claude/codex；多个可用时随机选择一个。",
      ].join("\n"),
    )
    .action(upCommand);
}
