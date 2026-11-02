/**
 * App 路径常量与初始化状态持久化
 *
 * 提供 ~/.nuwaclaw/ 下各目录的路径 getter，以及依赖初始化状态的读写。
 */

import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import log from "electron-log";
import { APP_DATA_DIR_NAME } from "../constants";

// ==================== App Paths ====================

/** 获取应用数据目录 ~/.nuwaclaw/ */
export function getAppDataDir(): string {
  return path.join(app.getPath("home"), APP_DATA_DIR_NAME);
}

export function getAppBinDir(): string {
  return path.join(getAppDataDir(), "bin");
}

export function getAppNodeModules(): string {
  return path.join(getAppDataDir(), "node_modules");
}

/** 获取 Electron extraResources 路径 */
export function getResourcesPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  const projectRoot = process.cwd();
  const resourcesFromCwd = path.join(projectRoot, "resources");
  if (fs.existsSync(resourcesFromCwd)) {
    return resourcesFromCwd;
  }
  return path.join(__dirname, "../../../../../resources");
}

// ==================== Init Deps State ====================

const INIT_DEPS_STATE_FILENAME = ".init-deps-state.json";

export interface InitDepsState {
  appVersion: string;
  packages: Record<string, string>;
}

/**
 * 读取上次初始化依赖同步状态（用于检测客户端升级后是否需要重装）
 */
export function getInitDepsState(): InitDepsState | null {
  const filePath = path.join(getAppDataDir(), INIT_DEPS_STATE_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as InitDepsState;
    if (
      typeof data.appVersion !== "string" ||
      !data.packages ||
      typeof data.packages !== "object"
    )
      return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 写入初始化依赖同步状态（安装/同步完成后调用）
 */
export function setInitDepsState(state: InitDepsState): void {
  const dir = getAppDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, INIT_DEPS_STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  log.info(
    "[Dependencies] init-deps-state updated:",
    state.appVersion,
    Object.keys(state.packages).length,
    "packages",
  );
}
