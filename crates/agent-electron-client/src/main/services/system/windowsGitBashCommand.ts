/**
 * Windows 下将 Agent/终端命令包装为 Git Bash `-c` 执行，避免脚本文件触发 ShellExecute「打开方式」弹窗。
 */

import * as path from "path";
import log from "electron-log";
import { createPlatformAdapter } from "./platformAdapter";
import { getBundledGitBashPath } from "./binaryLocator";

/** 不宜作为 CreateProcess 可执行文件直接启动的脚本/批处理扩展名 */
const WINDOWS_SCRIPT_FILE_PATTERN =
  /\.(?:sh|bash|zsh|ps1|psm1|py|pyw|js|mjs|cjs|ts|cmd|bat)$/i;

const WINDOWS_INTERPRETER_NAMES = new Set([
  "node",
  "nodejs",
  "python",
  "python3",
  "py",
  "pwsh",
  "powershell",
  "cmd",
  "bash",
  "sh",
  "npm",
  "npx",
  "uv",
  "ruby",
  "perl",
]);

function bashExecutableName(filePath: string): string {
  const pathApi = /^[A-Za-z]:[\\/]/.test(filePath) ? path.win32 : path;
  return pathApi
    .basename(filePath)
    .toLowerCase()
    .replace(/\.exe$/, "");
}

export function isGitBashInvocation(command: string, args: string[]): boolean {
  const name = bashExecutableName(command);
  if (name !== "bash" && name !== "sh") {
    return false;
  }
  return args[0] === "-c" || args[0] === "-lc";
}

function stripWrappingQuotes(token: string): string {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function tokenLooksLikeScriptFile(token: string): boolean {
  const base = path.basename(stripWrappingQuotes(token));
  return WINDOWS_SCRIPT_FILE_PATTERN.test(base);
}

export function isKnownCommandInterpreter(command: string): boolean {
  return WINDOWS_INTERPRETER_NAMES.has(bashExecutableName(command));
}

/**
 * 命令是否把脚本文件当作可执行文件直接启动（无 node/python/powershell 等解释器）。
 * 在 Windows 上这类 spawn 可能触发「打开方式」或执行失败。
 */
export function commandNeedsShellInterpreter(
  command: string,
  args: string[],
): boolean {
  if (tokenLooksLikeScriptFile(command)) {
    return true;
  }
  if (isKnownCommandInterpreter(command)) {
    return false;
  }
  return args.some((arg) => tokenLooksLikeScriptFile(arg));
}

/** @deprecated 使用 commandNeedsShellInterpreter */
export function commandLooksLikeShellScript(
  command: string,
  args: string[],
): boolean {
  return commandNeedsShellInterpreter(command, args);
}

/** POSIX 单引号转义（用于 bash -c 内 argv 拼接） */
export function quoteBashWord(word: string): string {
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(word)) {
    return word;
  }
  return `'${word.replace(/'/g, `'"'"'`)}'`;
}

/**
 * 为 bash -c 拼接单行命令。
 * args 为空时 command 视为完整 shell 行（保留 &&、管道等）；
 * args 非空时 command 视为可执行文件路径，会对含空格路径加引号。
 */
export function formatBashCommandLine(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }
  return [quoteBashWord(command), ...args.map(quoteBashWord)].join(" ");
}

export type WindowsGitBashCommandResult = {
  command: string;
  args: string[];
  /** 是否已改写为 bundled Git Bash -c 执行 */
  gitBashWrapped: boolean;
};

/**
 * 将 Windows 命令包装为应用包内 bundled Git Bash 执行。
 * 非 Windows 或 prepare:git 未就绪时原样返回（脚本类命令会打 warn）。
 */
export function wrapWindowsCommandWithGitBash(
  command: string,
  args: string[],
): WindowsGitBashCommandResult {
  const platformAdapter = createPlatformAdapter();
  if (!platformAdapter.isWindows) {
    return { command, args, gitBashWrapped: false };
  }

  const bashPath = getBundledGitBashPath();
  if (!bashPath) {
    if (commandNeedsShellInterpreter(command, args)) {
      log.warn(
        "[windowsGitBashCommand] Bundled Git Bash not found; script/batch files (.sh/.ps1/.js/.py/.cmd…) may trigger Windows open-with dialog or fail to run. Run npm run prepare:git.",
        { command, args },
      );
    }
    return { command, args, gitBashWrapped: false };
  }

  if (isGitBashInvocation(command, args)) {
    const sameBash =
      path.win32.normalize(command).toLowerCase() ===
      path.win32.normalize(bashPath).toLowerCase();
    if (sameBash) {
      return { command, args, gitBashWrapped: false };
    }
    return { command: bashPath, args, gitBashWrapped: true };
  }

  const shellLine = formatBashCommandLine(command, args);
  return { command: bashPath, args: ["-c", shellLine], gitBashWrapped: true };
}
