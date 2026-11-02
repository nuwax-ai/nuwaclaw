/**
 * OPENCODE_LOG_DIR 容器路径本地化
 *
 * 在沙箱/容器环境中，OPENCODE_LOG_DIR 可能指向容器内路径（不存在于宿主）。
 * 此函数检测路径是否存在，不存在则替换为宿主日志目录。
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { APP_DATA_DIR_NAME } from "../../constants";

const FALLBACK_LOG_DIR = path.join(os.homedir(), APP_DATA_DIR_NAME, "logs");

/**
 * 如果 env.OPENCODE_LOG_DIR 指向不存在的路径，替换为本地 fallback。
 * 返回规范化后的 env（浅拷贝，不修改原对象）。
 */
export function normalizeLogDirInEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> | undefined {
  if (!env) return undefined;
  if (!env.OPENCODE_LOG_DIR || fs.existsSync(env.OPENCODE_LOG_DIR)) {
    return env;
  }
  return { ...env, OPENCODE_LOG_DIR: FALLBACK_LOG_DIR };
}
