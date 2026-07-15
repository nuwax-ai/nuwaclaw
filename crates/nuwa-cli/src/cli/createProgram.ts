import { Command } from "commander";
import { CLI_VERSION } from "../core/version.js";
import { registerAgentCommands } from "./registerAgentCommands.js";
import { registerCloudCommands } from "./registerCloudCommands.js";
import { registerContextCommands } from "./registerContextCommands.js";
import { registerServiceCommands } from "./registerServiceCommands.js";
import { registerUpdateCommand } from "./registerUpdateCommand.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("nuwa-cli")
    .description(
      "Headless multi-engine agent CLI — attaches to your already-installed claude/codex CLIs over ACP",
    )
    .version(CLI_VERSION);

  registerAgentCommands(program);
  registerContextCommands(program);
  registerCloudCommands(program);
  registerServiceCommands(program);
  registerUpdateCommand(program);

  return program;
}
