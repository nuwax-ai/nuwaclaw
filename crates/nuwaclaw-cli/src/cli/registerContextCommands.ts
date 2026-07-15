import type { Command } from "commander";
import {
  contextDigestCommand,
  contextHandoffCommand,
  contextListCommand,
  contextReadCommand,
} from "../commands/context.js";

export function registerContextCommands(program: Command): void {
  const context = program
    .command("context")
    .description("跨 Agent 上下文引用与交接（ACP 会话之上的只读辅助层）");

  context
    .command("list")
    .description("列出本地可引用上下文")
    .option("--engine <engine>", "只看某个引擎：claude 或 codex")
    .option("--json", "以 JSON 输出")
    .action(contextListCommand);

  context
    .command("read")
    .description("读取一个本地会话的规范化消息流 JSON")
    .requiredOption("--ref <engine:sessionId>", "上下文引用，如 claude:xxxx")
    .option("--limit <n>", "只返回最近 N 条消息")
    .option("--json", "以 JSON 输出（当前是唯一输出格式）")
    .action(contextReadCommand);

  context
    .command("digest")
    .description("输出一个本地会话的规则型压缩摘要 JSON")
    .requiredOption("--ref <engine:sessionId>", "上下文引用，如 claude:xxxx")
    .option("--limit <n>", "最多读取最近 N 条消息参与摘要")
    .option("--json", "以 JSON 输出（当前是唯一输出格式）")
    .action(contextDigestCommand);

  context
    .command("handoff")
    .description("输出一个适合跨 Agent 接手工作的结构化交接包 JSON")
    .requiredOption("--ref <engine:sessionId>", "上下文引用，如 claude:xxxx")
    .option("--limit <n>", "最多读取最近 N 条消息参与交接包")
    .option("--json", "以 JSON 输出（当前是唯一输出格式）")
    .action(contextHandoffCommand);
}
