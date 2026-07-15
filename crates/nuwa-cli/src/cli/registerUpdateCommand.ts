import type { Command } from "commander";
import { updateCommand } from "../commands/update.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [version]")
    .description("升级 nuwa-cli CLI（默认升级到 latest）")
    .option("--check", "只查询目标版本，不执行安装")
    .option("--dry-run", "打印升级命令但不执行")
    .option(
      "--package-manager <npm|pnpm>",
      "指定包管理器；默认根据当前环境推断",
    )
    .option("--registry <url>", "指定 npm registry")
    .addHelpText(
      "after",
      [
        "",
        "示例：",
        "  nuwa-cli update",
        "  nuwa-cli update 0.2.0",
        "  nuwa-cli update --check",
        "  nuwa-cli update --package-manager pnpm",
        "",
        "说明：",
        "  - update 只升级 npm/pnpm 安装的 CLI 包，不修改 ~/.nuwa-cli 登录数据。",
        "  - npx/pnpm dlx 临时运行时，建议直接使用 npx -y @nuwax-ai/nuwa-cli@latest ...。",
      ].join("\n"),
    )
    .action(updateCommand);
}
