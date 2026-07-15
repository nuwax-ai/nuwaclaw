import type { Command } from "commander";
import { CLI_AGENT_PORT } from "../core/ports.js";

export function addCloudLoginOptions(command: Command): Command {
  return command
    .option("--domain <host>", "Nuwax 服务器地址；不传则使用当前默认 domain")
    .option(
      "--saved-key <key>",
      "已有 savedKey；会保存为当前账号并加入多账号 JSON 映射",
    )
    .option(
      "-u, --username <username>",
      "账号名；同 domain+username 已保存时会复用 savedKey，密码仅用于本次请求",
    );
}

export function addCloudLoginHelp(command: Command): Command {
  return command.addHelpText(
    "after",
    [
      "",
      "说明：",
      "  - 不使用 SQLite，凭证保存在 ~/.nuwa-cli/credentials.json。",
      "  - 同一 domain+username 再次登录会复用已保存 savedKey，避免后端新建电脑。",
      "  - 不传 --domain / -u 时，会用当前默认账号的 savedKey 免密重新注册。",
    ].join("\n"),
  );
}

export function addModelOverlayOptions(command: Command): Command {
  return command
    .option("--api-key <key>", "覆盖模型 API key")
    .option("--base-url <url>", "覆盖模型 API base URL")
    .option("--model <model>", "覆盖模型名称");
}

export function addServeRuntimeOptions(command: Command): Command {
  return addModelOverlayOptions(
    command
      .option(
        "--port <port>",
        "HTTP API 优先监听端口；占用时自动向后寻找可用端口",
        String(CLI_AGENT_PORT),
      )
      .option("--host <host>", "HTTP API 监听地址", "127.0.0.1")
      .option(
        "--cwd <dir>",
        "当前项目目录；不传时按 ~/.nuwa-cli/workspaces/<project_id> 自动创建",
      )
      .option(
        "--approve <policy>",
        "权限策略：auto（默认，自动批准）或 deny",
        "auto",
      )
      .option(
        "--lanproxy-path <path>",
        "lanproxy 二进制或 resources/lanproxy 目录",
      )
      .option("--lanproxy-host <host>", "覆盖注册返回的 lanproxy serverHost")
      .option("--lanproxy-port <port>", "覆盖注册返回的 lanproxy serverPort")
      .option("--lanproxy-ssl <true|false>", "lanproxy 是否启用 ssl", "true")
      .option(
        "--daemon",
        "后台启动 serve（stdout/stderr 写入 ~/.nuwa-cli/logs/serve.log）",
      ),
  );
}

export function addServiceInstallOptions(command: Command): Command {
  return command
    .option(
      "--engine <engine>",
      "服务启动时使用的引擎：claude 或 codex；不传则由 up 自动检测",
    )
    .option(
      "--port <port>",
      "HTTP API 优先监听端口；占用时自动向后寻找可用端口",
      String(CLI_AGENT_PORT),
    )
    .option("--host <host>", "HTTP API 监听地址", "127.0.0.1")
    .option(
      "--cwd <dir>",
      "当前项目目录；不传时按 ~/.nuwa-cli/workspaces/<project_id> 自动创建",
    )
    .option(
      "--approve <policy>",
      "权限策略：auto（默认，自动批准）或 deny",
      "auto",
    )
    .option(
      "--lanproxy-path <path>",
      "lanproxy 二进制或 resources/lanproxy 目录",
    )
    .option("--lanproxy-host <host>", "覆盖注册返回的 lanproxy serverHost")
    .option("--lanproxy-port <port>", "覆盖注册返回的 lanproxy serverPort")
    .option("--lanproxy-ssl <true|false>", "lanproxy 是否启用 ssl", "true")
    .option("--now", "安装后立即启动服务");
}
