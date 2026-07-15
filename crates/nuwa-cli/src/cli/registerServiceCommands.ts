import type { Command } from "commander";
import {
  serviceInstallCommand,
  serviceStartCommand,
  serviceStatusCommand,
  serviceStopCommand,
  serviceUninstallCommand,
} from "../commands/service.js";
import { serveCommand } from "../commands/serve.js";
import { upCommand } from "../commands/up.js";
import {
  addCloudLoginOptions,
  addServeRuntimeOptions,
  addServiceInstallOptions,
} from "./options.js";

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

  const service = program
    .command("service")
    .description("管理后台常驻与开机/登录自启动服务");

  addServiceInstallOptions(
    service
      .command("install")
      .description(
        "安装当前用户后台服务；默认下次用户登录启动，传 --now 立即启动",
      ),
  )
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - 安装前需要已有 CLI 默认账号：先运行 `nuwa-cli login` 或 `nuwa-cli up` 成功一次。",
        "  - 启动项不会保存密码、savedKey、configKey 或模型 API key；登录态仍从 ~/.nuwa-cli/credentials.json 读取。",
        "  - macOS 使用 LaunchAgent，Linux 使用 systemd user service，Windows 使用当前用户计划任务。",
        "  - Linux 默认是用户登录后启动；未登录也启动需要系统启用 linger。",
      ].join("\n"),
    )
    .action(serviceInstallCommand);

  service
    .command("start")
    .description("启动已安装的后台服务")
    .action(serviceStartCommand);

  service
    .command("stop")
    .description("停止已安装的后台服务")
    .action(serviceStopCommand);

  service
    .command("status")
    .description("查看系统启动项与当前 serve 运行状态")
    .action(serviceStatusCommand);

  service
    .command("uninstall")
    .description("停止并移除后台服务/开机启动项")
    .action(serviceUninstallCommand);
}
