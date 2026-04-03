/**
 * 主进程 i18n 服务
 * 基于系统语言返回对应的翻译
 * 语言文件位于 @shared/locales/
 */

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// ========== 类型 ==========

export type SystemLangMap = Record<string, string>;

// ========== 语言文件路径 ==========

function getLocaleFilePath(locale: string): string {
  const localeFileMap: Record<string, string> = {
    en: "en-US.json",
    "en-us": "en-US.json",
    zh: "zh-CN.json",
    "zh-cn": "zh-CN.json",
    "zh-tw": "zh-TW.json",
    "zh-hk": "zh-HK.json",
  };

  const fileName = localeFileMap[locale.toLowerCase()] || "en-US.json";

  // 开发模式：src/shared/locales/
  // 打包后：app.asar 后无法直接读取，需要用 process.resourcesPath
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "locales", fileName);
  }
  // 开发模式：相对于项目根目录
  return path.join(__dirname, "..", "..", "shared", "locales", fileName);
}

// ========== 加载语言文件 ==========

function loadLocaleFile(locale: string): SystemLangMap {
  const filePath = getLocaleFilePath(locale);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(`[i18n] Failed to load locale file ${filePath}:`, e);
  }
  return {};
}

// ========== 最小字典（兜底用 - 当语言文件加载失败时） ==========

const MIN_EN_I18N_MAP: SystemLangMap = {
  "Claw.Tray.showWindow": "Show Window",
  "Claw.Tray.restartServices": "Restart Services",
  "Claw.Tray.stopServices": "Stop Services",
  "Claw.Tray.autoLaunch": "Auto Launch",
  "Claw.Tray.checkUpdate": "Check for Updates",
  "Claw.Tray.about": "About {0} v{1}",
  "Claw.Tray.quit": "Quit",
  "Claw.Tray.Status.running": "Running",
  "Claw.Tray.Status.stopped": "Stopped",
  "Claw.Tray.Status.error": "Error",
  "Claw.Tray.Status.starting": "Starting",
  "Claw.Dialog.error": "Error",
  "Claw.Dialog.autoLaunchFailed": "Failed to set auto launch",
};

const MIN_ZH_I18N_MAP: SystemLangMap = {
  "Claw.Tray.showWindow": "显示主窗口",
  "Claw.Tray.restartServices": "重启服务",
  "Claw.Tray.stopServices": "停止服务",
  "Claw.Tray.autoLaunch": "开机自启动",
  "Claw.Tray.checkUpdate": "检查更新",
  "Claw.Tray.about": "关于 {0} v{1}",
  "Claw.Tray.quit": "退出",
  "Claw.Tray.Status.running": "运行中",
  "Claw.Tray.Status.stopped": "已停止",
  "Claw.Tray.Status.error": "错误",
  "Claw.Tray.Status.starting": "启动中",
  "Claw.Dialog.error": "错误",
  "Claw.Dialog.autoLaunchFailed": "设置开机自启动失败",
};

// ========== 状态 ==========

let currentLang: string;
let langMap: SystemLangMap;

// ========== 工具函数 ==========

const normalizeLang = (lang: string): string => lang.toLowerCase();

const isZhLang = (lang: string): boolean =>
  normalizeLang(lang).startsWith("zh");

const formatText = (template: string, values: string[]): string => {
  if (!values.length) return template;
  let text = template;
  values.forEach((value, index) => {
    text = text.replace(new RegExp(`\\{${index}\\}`, "g"), value);
  });
  return text;
};

// ========== 初始化 ==========

const initLang = (): void => {
  const systemLang = app.getLocale();
  currentLang = normalizeLang(systemLang);

  // 尝试加载语言文件
  langMap = loadLocaleFile(currentLang);

  // 如果加载失败，使用最小字典
  if (Object.keys(langMap).length === 0) {
    langMap = isZhLang(currentLang)
      ? { ...MIN_ZH_I18N_MAP }
      : { ...MIN_EN_I18N_MAP };
  }
};

// ========== 导出函数 ==========

/**
 * 获取当前语言
 */
export function getCurrentLang(): string {
  return currentLang;
}

/**
 * 翻译函数
 * @param key 翻译 key
 * @param values 替换参数
 */
export function t(key: string, ...values: string[]): string {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";

  const template = langMap[normalizedKey] || MIN_EN_I18N_MAP[normalizedKey];
  if (!template) {
    console.warn(`[i18n] Missing translation for key: ${normalizedKey}`);
    return normalizedKey;
  }

  return formatText(template, values);
}

/**
 * 获取翻译 map
 */
export function getLangMap(): SystemLangMap {
  return { ...langMap };
}

// 延迟初始化（等待 app ready）
let initialized = false;
export function initI18n(): void {
  if (initialized) return;
  initLang();
  initialized = true;
}
