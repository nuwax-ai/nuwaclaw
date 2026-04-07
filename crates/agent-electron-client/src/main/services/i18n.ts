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

const LOCALE_FILE_MAP: Record<string, string> = {
  en: "en-US.json",
  "en-us": "en-US.json",
  zh: "zh-CN.json",
  "zh-cn": "zh-CN.json",
  "zh-tw": "zh-TW.json",
  "zh-hk": "zh-HK.json",
};

function getLocaleFilePath(locale: string): string {
  const fileName = LOCALE_FILE_MAP[locale.toLowerCase()] || "en-US.json";

  if (app.isPackaged) {
    return path.join(process.resourcesPath, "locales", fileName);
  }
  // 开发模式：app.getAppPath() = crates/agent-electron-client/
  return path.join(app.getAppPath(), "src", "shared", "locales", fileName);
}

// ========== 加载语言文件 ==========

function loadLocaleFile(locale: string): SystemLangMap {
  const filePath = getLocaleFilePath(locale);
  if (!fs.existsSync(filePath)) {
    console.warn(`[i18n] Locale file not found: ${filePath}`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`[i18n] Failed to parse locale file ${filePath}:`, e);
    return {};
  }
}

// ========== 状态 ==========

let currentLang: string;
let langMap: SystemLangMap;

// ========== 工具函数 ==========

const normalizeLang = (lang: string): string => lang.toLowerCase();

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
  langMap = loadLocaleFile(currentLang);
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

  const template = langMap?.[normalizedKey];
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

/**
 * 获取当前语言（IPC 暴露用别名）
 */
export function getMainLang(): string {
  return currentLang;
}

/**
 * 运行时切换主进程语言
 * @param lang 语言代码（如 "zh-CN"、"en"）
 */
export function setMainLang(lang: string): void {
  const normalized = normalizeLang(lang);
  if (!normalized) return;

  currentLang = normalized;
  langMap = loadLocaleFile(normalized);
}

// 延迟初始化（等待 app ready）
let initialized = false;
export function initI18n(): void {
  if (initialized) return;
  initLang();
  initialized = true;
}
