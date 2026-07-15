import pc from "picocolors";
import { readCredentials } from "../core/auth/credentials.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import {
  getServiceStatus,
  installService,
  startService,
  stopService,
  uninstallService,
  type ServiceInstallOptions,
} from "../core/service/serviceManager.js";

function hasUsableDefaultAccount(): boolean {
  const credentials = readCredentials();
  return Boolean(credentials.domain && credentials.savedKey);
}

function requireDefaultAccount(): void {
  if (hasUsableDefaultAccount()) return;
  throw new Error(
    "未找到可用于启动的默认账号。请先运行 `nuwa-cli login --domain <host> --saved-key <key>`，或 `nuwa-cli up --domain <host> -u <username>` 成功注册一次。",
  );
}

function printPlatformNote(): void {
  if (process.platform === "darwin") {
    console.log(
      pc.dim(
        "macOS 使用当前用户 LaunchAgent：用户登录后自动启动；未登录前不会运行。",
      ),
    );
  } else if (process.platform === "linux") {
    console.log(
      pc.dim(
        "Linux 使用 systemd user service：默认用户登录后启动；如需未登录也随系统启动，请在系统上启用 linger（例如 `loginctl enable-linger $USER`，可能需要管理员权限）。",
      ),
    );
  } else if (process.platform === "win32") {
    console.log(
      pc.dim(
        "Windows 使用当前用户计划任务：用户登录时自动启动；不需要把密码写入计划任务。",
      ),
    );
  }
}

export async function serviceInstallCommand(
  options: ServiceInstallOptions,
): Promise<void> {
  try {
    requireDefaultAccount();
    installService(options);
    console.log(
      pc.green(
        options.now
          ? "nuwa-cli 后台服务已安装并启动。"
          : "nuwa-cli 后台服务已安装，将在下次用户登录时自动启动。",
      ),
    );
    printPlatformNote();
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 安装后台服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

export async function serviceStartCommand(): Promise<void> {
  try {
    requireDefaultAccount();
    startService();
    console.log(pc.green("nuwa-cli 后台服务已启动。"));
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 启动后台服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

export async function serviceStopCommand(): Promise<void> {
  try {
    stopService();
    console.log(pc.green("nuwa-cli 后台服务已停止。"));
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 停止后台服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

export async function serviceUninstallCommand(): Promise<void> {
  try {
    uninstallService();
    console.log(pc.green("nuwa-cli 后台服务已卸载。"));
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 卸载后台服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

export async function serviceStatusCommand(): Promise<void> {
  try {
    const service = getServiceStatus();
    const installed = service.installed ? "已安装" : "未安装";
    const active =
      service.active === null ? "未知" : service.active ? "运行中" : "未运行";
    console.log(`系统启动项：${installed}，${active}`);
    if (service.configPath)
      console.log(pc.dim(`配置文件：${service.configPath}`));
    if (service.taskName) console.log(pc.dim(`计划任务：${service.taskName}`));

    const serve = await getServeStatus();
    if (serve.state === "running") {
      console.log(
        `serve：运行中 http://${serve.host}:${serve.port}（pid ${serve.pid}）`,
      );
    } else if (serve.state === "unhealthy") {
      console.log(
        pc.yellow(
          `serve：进程存在但 /health 不可用 http://${serve.host}:${serve.port}（pid ${serve.pid}）`,
        ),
      );
    } else {
      console.log(`serve：未运行${serve.note ? `（${serve.note}）` : ""}`);
    }

    if (service.details.trim()) {
      console.log(pc.dim("\n系统状态详情："));
      console.log(pc.dim(service.details.trim()));
    }
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 查看后台服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}
