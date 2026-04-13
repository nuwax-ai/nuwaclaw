/**
 * 主进程 i18n 服务
 * 基于系统语言返回对应的翻译
 * 语言文件位于 @shared/locales/
 */

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log";

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

type I18nValues = (
  | string
  | number
  | undefined
  | Record<string, string | number | undefined>
)[];

const formatText = (template: string, values: I18nValues): string => {
  if (!values.length) return template;
  let text = template;

  // 命名占位符：t(key, { error: "xxx" }) → 替换 {error}
  const namedValues = values.find(
    (v): v is Record<string, string | number | undefined> =>
      typeof v === "object" && v !== null,
  );
  if (namedValues) {
    Object.entries(namedValues).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v ?? ""));
    });
    return text;
  }

  // 位置占位符 {0} {1} ... 和 {} 空占位符
  const stringValues = values.map((v) => String(v ?? ""));
  stringValues.forEach((value, index) => {
    text = text.replace(new RegExp(`\\{${index}\\}`, "g"), value);
  });
  let cursor = 0;
  text = text.replace(/\{\}/g, () => stringValues[cursor++] ?? "");
  return text;
};

// ========== 初始化 ==========

const initLang = (): void => {
  const systemLang = app.getLocale() || "en";
  currentLang = normalizeLang(systemLang);
  const fileName = LOCALE_FILE_MAP[currentLang] || "en-US.json";
  langMap = loadLocaleFile(currentLang);
  log.info(
    `[i18n] initLang: systemLocale="${systemLang}" → normalized="${currentLang}" → file="${fileName}", loadedKeys=${Object.keys(langMap).length}`,
  );
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
 * @param values 替换参数：位置占位符 (string) 或命名占位符 (Record)
 */
export function t(key: string, ...values: I18nValues): string {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";

  const template = langMap?.[normalizedKey];
  if (!template) {
    log.warn(
      `[i18n] Missing translation for key: "${normalizedKey}", currentLang="${currentLang}"`,
    );
    return normalizedKey;
  }

  const result = formatText(template, values);
  log.debug(
    `[i18n] t("${normalizedKey}") resolved (currentLang="${currentLang}", len=${result.length})`,
  );
  return result;
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
  const normalized = normalizeLang(lang) || "en";
  currentLang = normalized;
  langMap = loadLocaleFile(normalized);
  const devModeKey = "Claw.AutoUpdater.devModeUnsupported";
  const hasDevModeUnsupported = Boolean(langMap[devModeKey]);
  log.info(
    `[i18n] setMainLang("${lang}") → normalized="${normalized}", ${devModeKey}=${hasDevModeUnsupported ? "present" : "missing"}, loadedKeys=${Object.keys(langMap).length}`,
  );
}

// 延迟初始化（等待 app ready）
let initialized = false;
export function initI18n(): void {
  if (initialized) return;
  initLang();
  initialized = true;
}
