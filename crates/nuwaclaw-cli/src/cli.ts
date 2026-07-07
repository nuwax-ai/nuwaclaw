import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { chatCommand } from "./commands/chat.js";
import {
  sessionsCommand,
  sessionsSummaryCommand,
} from "./commands/sessions.js";
import {
  loginCommand,
  logoutCommand,
  statusCommand,
} from "./commands/login.js";
import { configGetCommand, configSetCommand } from "./commands/config.js";
import { serveCommand } from "./commands/serve.js";

const pkgVersion = "0.1.0";

const program = new Command();

program
  .name("nuwaclaw")
  .description(
    "Headless multi-engine agent CLI — attaches to your already-installed claude/codex CLIs over ACP",
  )
  .version(pkgVersion);

program
  .command("doctor")
  .description("检测本机环境：Node、claude/codex CLI、uv、登录态、本地会话历史")
  .action(doctorCommand);

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
    "--gui-mcp",
    "为本次会话追加 gui-agent MCP（截图/键鼠电脑操作能力，默认关闭）",
  )
  .option(
    "--gui-mcp-path <dir>",
    "gui-agent MCP 的本地路径（未发 npm 前的开发用逃生舱）",
  )
  .option(
    "--api-key <key>",
    "覆盖模型 API key（默认不设置，使用本机 CLI 自身配置）",
  )
  .option("--base-url <url>", "覆盖模型 API base URL")
  .option("--model <model>", "覆盖模型名称")
  .action(chatCommand);

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

program
  .command("login")
  .description("登录 Nuwax 云账号（domain+savedKey，无 UI）")
  .option("--domain <host>", "Nuwax 服务器地址")
  .option("--saved-key <key>", "已有的 savedKey，直接登录")
  .option("-u, --username <username>", "首次登录：用户名（随后提示输入密码）")
  .action(loginCommand);

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
  .description("查看/修改 nuwaclaw 配置（domain/saved-key/username）");
config
  .command("get [key]")
  .description("查看配置项，省略 key 时列出全部")
  .action(configGetCommand);
config
  .command("set <key> <value>")
  .description("设置配置项")
  .action(configSetCommand);

program
  .command("serve")
  .description("启动本机 HTTP API（chat + SSE），供脚本/云端/IM 远程调度")
  .option("--port <port>", "监听端口", "60016")
  .option("--host <host>", "监听地址", "127.0.0.1")
  .option("--engine <engine>", "使用的引擎：claude 或 codex", "claude")
  .option("--cwd <dir>", "工作目录", process.cwd())
  .option(
    "--approve <policy>",
    "权限策略：auto（默认，自动批准）或 deny",
    "auto",
  )
  .option(
    "--tunnel",
    "实验性：登录后启动本地 nuwax-file-server；lanproxy 云端隧道尚未接入",
  )
  .option("--api-key <key>", "覆盖模型 API key")
  .option("--base-url <url>", "覆盖模型 API base URL")
  .option("--model <model>", "覆盖模型名称")
  .action(serveCommand);

program.parseAsync(process.argv);
