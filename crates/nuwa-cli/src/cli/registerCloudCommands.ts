import type { Command } from "commander";
import {
  accountListCommand,
  accountSwitchCommand,
} from "../commands/account.js";
import { configGetCommand, configSetCommand } from "../commands/config.js";
import {
  loginCommand,
  logoutCommand,
  statusCommand,
} from "../commands/login.js";
import { addCloudLoginHelp, addCloudLoginOptions } from "./options.js";

export function registerCloudCommands(program: Command): void {
  addCloudLoginHelp(
    addCloudLoginOptions(
      program
        .command("login")
        .description(
          "登录 Nuwax 云账号；不传 domain/username 时使用当前默认账号",
        ),
    ),
  ).action(loginCommand);

  program
    .command("logout")
    .description("退出登录（保留 savedKey，可免密重新登录）")
    .action(logoutCommand);

  program
    .command("status")
    .description("查看 Nuwax 登录状态")
    .option("--remote", "额外向服务器校验 savedKey 是否仍然有效")
    .action(statusCommand);

  const config = program
    .command("config")
    .description("查看/修改当前默认账号配置（多账号请用 account 命令）");

  config
    .command("get [key]")
    .description("查看配置项，省略 key 时列出全部")
    .action(configGetCommand);

  config
    .command("set <key> <value>")
    .description("设置配置项（domain/saved-key/username/lanproxy-path）")
    .action(configSetCommand);

  const account = program
    .command("account")
    .description(
      "管理 credentials.json 中保存的多个 Nuwax 账号（轻量 JSON，无 SQLite）",
    );

  account
    .command("list")
    .description("列出已保存账号，并用 * 标记当前默认账号")
    .action(accountListCommand);

  account
    .command("switch <account>")
    .description("切换当前默认账号；serve 运行中会拒绝，需先 Ctrl-C 停服务")
    .addHelpText(
      "after",
      [
        "",
        "参数：",
        "  account  可用 `nuwa-cli account list` 输出的 key，例如 testagent.xspaceagi.com_18011447397；",
        "           也可传唯一 username。",
        "",
        "说明：",
        "  切换账号会重新注册当前账号，并要求重新启动 serve/file-server/lanproxy。",
        "  如果 serve 正在运行，本命令会拒绝执行；请先在 up/serve 终端按 Ctrl-C。",
      ].join("\n"),
    )
    .action(accountSwitchCommand);
}
