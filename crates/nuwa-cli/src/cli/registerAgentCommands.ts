import type { Command } from "commander";
import { chatCommand } from "../commands/chat.js";
import { doctorCommand } from "../commands/doctor.js";
import {
  sessionsCommand,
  sessionsSummaryCommand,
} from "../commands/sessions.js";
import { addModelOverlayOptions } from "./options.js";

export function registerAgentCommands(program: Command): void {
  program
    .command("doctor")
    .description(
      "检测本机环境：Node、claude/codex CLI、uv、登录态、本地会话历史",
    )
    .action(doctorCommand);

  addModelOverlayOptions(
    program
      .command("chat")
      .description("与本机已登录的 claude/codex 对话（复用其登录态与本地配置）")
      .option("--engine <engine>", "使用的引擎：claude 或 codex", "claude")
      .option("--cwd <dir>", "工作目录", process.cwd())
      .option("-p, --print <prompt>", "单次输出模式：发送一条 prompt 并退出")
      .option("--yolo", "自动批准所有工具调用（危险，谨慎使用）")
      .option(
        "--mode <modeId>",
        "设置引擎会话模式（如 acceptEdits/bypassPermissions，因引擎而异）",
      )
      .option(
        "--resume [sessionId]",
        "续接本地历史会话；不带 id 时弹出交互选择列表",
      )
      .option(
        "--ref-session <engine:sessionId>",
        "关联另一个引擎的历史会话作为上下文（如 claude:xxxx）；不是真续接，" +
          "只在首轮提醒模型按需运行 `sessions summary` 查看",
      )
      .option(
        "--handoff <engine:sessionId>",
        "从另一个本地会话生成结构化交接包，并在新 ACP 会话首轮注入",
      )
      .option(
        "--gui-mcp",
        "为本次会话追加 gui-agent MCP（截图/键鼠电脑操作能力，默认关闭）",
      )
      .option(
        "--gui-mcp-path <dir>",
        "gui-agent MCP 的本地路径（未发 npm 前的开发用逃生舱）",
      ),
  ).action(chatCommand);

  const sessions = program
    .command("sessions")
    .description("列出本地 claude/codex 会话历史")
    .option("--engine <engine>", "只看某个引擎：claude 或 codex")
    .action(sessionsCommand);

  sessions
    .command("summary")
    .description(
      "输出某个本地会话的紧凑 JSON 摘要（供 agent 按需读取另一引擎的历史，见 chat --ref-session）",
    )
    // Plain (not required) — the parent `sessions` command already declares
    // `--engine`, and commander attributes a shared flag name to whichever
    // command in the chain declares it first, so a child `requiredOption` of
    // the same name never sees the value and always fails. sessionsSummaryCommand
    // reads the merged value via `command.optsWithGlobals()` and validates it
    // itself instead of relying on commander's required-option check.
    .option("--engine <engine>", "会话所属引擎：claude 或 codex")
    .option("--session-id <id>", "会话 ID")
    .option("--limit <n>", "只返回最近 N 条消息")
    .option("--json", "以 JSON 输出（当前是唯一输出格式）")
    .action(sessionsSummaryCommand);
}
