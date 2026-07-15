import pc from "picocolors";
import {
  listStoredAccounts,
  readCredentials,
  resolveStoredAccount,
} from "../core/auth/credentials.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import { performReg } from "./login.js";

export async function accountListCommand(): Promise<void> {
  const accounts = listStoredAccounts();
  if (accounts.length === 0) {
    console.log(
      pc.dim("暂无已保存账号。运行 `nuwaclaw login` 或 `nuwaclaw up` 添加。"),
    );
    return;
  }

  for (const item of accounts) {
    const marker = item.current ? "*" : " ";
    const computerName = item.account.computerName ?? "(未知电脑名)";
    console.log(
      `${marker} ${item.key}  ${item.account.domain}  ${item.account.username}  ${computerName}`,
    );
  }
}

export async function accountSwitchCommand(selector: string): Promise<void> {
  try {
    const serveStatus = await getServeStatus();
    if (serveStatus.state !== "stopped") {
      console.error(
        pc.red(
          `[nuwaclaw] 当前 serve 正在运行或未健康关闭（端口 ${serveStatus.port}，PID ${serveStatus.pid}）。切换账号需要重启所有服务，请先 Ctrl-C 停止 serve 后再切换。`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const credentials = readCredentials();
    const resolved = resolveStoredAccount(selector, credentials);
    if (!resolved) {
      console.error(
        pc.red(
          `[nuwaclaw] 未找到账号 "${selector}"。运行 \`nuwaclaw account list\` 查看可切换账号。`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    await performReg(resolved.account.domain, {
      username: resolved.account.username,
      password: "",
      savedKey: resolved.account.savedKey,
    });
    console.log(
      pc.green(
        `已切换当前账号：${resolved.account.username}（${resolved.account.domain}）。请重新启动 \`nuwaclaw up\` 或 \`nuwaclaw serve --tunnel\`。`,
      ),
    );
  } catch (err) {
    console.error(pc.red(`[nuwaclaw] 切换账号失败：${(err as Error).message}`));
    process.exitCode = 1;
  }
}
