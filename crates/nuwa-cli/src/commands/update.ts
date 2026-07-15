import { spawnSync } from "node:child_process";
import { CLI_VERSION, PACKAGE_NAME } from "../core/version.js";
import { findOnPath } from "../util/which.js";

export type PackageManager = "npm" | "pnpm";

export interface UpdateOptions {
  check?: boolean;
  dryRun?: boolean;
  packageManager?: string;
  registry?: string;
}

export interface CommandResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
) => CommandResult;

function runCommand(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
): CommandResult {
  const result = spawnSync(command, args, options);
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    error: result.error,
  };
}

export function normalizeUpdateTarget(target?: string): string {
  const value = (target || "latest").trim();
  if (!value || value.startsWith("-")) {
    throw new Error(
      "升级版本不能为空。示例：nuwa-cli update latest 或 nuwa-cli update 0.2.0",
    );
  }
  return value.startsWith("v") && /^\d/.test(value.slice(1))
    ? value.slice(1)
    : value;
}

export function normalizePackageManager(value?: string): PackageManager {
  if (!value) return inferPackageManager();
  if (value === "npm" || value === "pnpm") return value;
  throw new Error("--package-manager 只支持 npm 或 pnpm");
}

export function inferPackageManager(
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const userAgent = env.npm_config_user_agent || "";
  if (userAgent.includes("pnpm")) return "pnpm";
  return "npm";
}

export function buildInstallArgs(
  packageManager: PackageManager,
  packageSpec: string,
  registry?: string,
): string[] {
  const args =
    packageManager === "pnpm"
      ? ["add", "-g", packageSpec]
      : ["install", "-g", packageSpec];
  if (registry) args.push("--registry", registry);
  return args;
}

export function buildViewArgs(
  packageSpec: string,
  registry?: string,
): string[] {
  const args = ["view", packageSpec, "version"];
  if (registry) args.push("--registry", registry);
  return args;
}

function buildPackageManagerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NUWACLI_PASSWORD;
  delete env.NUWAX_CONFIG_KEY;
  delete env.NUWAX_SAVED_KEY;
  delete env.NUWACLI_SERVE_LOCK_PATH;
  return env;
}

function resolveCommand(packageManager: PackageManager): string | null {
  return findOnPath(packageManager);
}

function printableCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export async function updateCommand(
  targetArg?: string,
  options: UpdateOptions = {},
  runner: CommandRunner = runCommand,
): Promise<void> {
  try {
    const target = normalizeUpdateTarget(targetArg);
    const packageManager = normalizePackageManager(options.packageManager);
    const command = resolveCommand(packageManager);
    if (!command) {
      throw new Error(
        `未找到 ${packageManager}。请先安装 ${packageManager}，或改用 --package-manager npm|pnpm。`,
      );
    }

    const packageSpec = `${PACKAGE_NAME}@${target}`;
    const env = buildPackageManagerEnv();

    if (options.check) {
      const viewArgs = buildViewArgs(packageSpec, options.registry);
      const result = runner(command, viewArgs, {
        encoding: "utf-8",
        env,
        stdio: "pipe",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          (result.stderr || result.stdout || "查询 npm 版本失败。").trim(),
        );
      }
      const remoteVersion = (result.stdout || "").trim();
      console.log(`当前版本：${CLI_VERSION}`);
      console.log(`${packageSpec}：${remoteVersion}`);
      if (remoteVersion === CLI_VERSION) console.log("已是目标版本。");
      else console.log(`可升级：${CLI_VERSION} -> ${remoteVersion}`);
      return;
    }

    const installArgs = buildInstallArgs(
      packageManager,
      packageSpec,
      options.registry,
    );
    console.log(`当前版本：${CLI_VERSION}`);
    console.log(`升级目标：${packageSpec}`);
    console.log(`执行：${printableCommand(packageManager, installArgs)}`);
    if (options.dryRun) return;

    const result = runner(command, installArgs, {
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    console.log(
      "升级命令已完成。请重新运行 `nuwa-cli --version` 确认当前 shell 解析到的新版本。",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
