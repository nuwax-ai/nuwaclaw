/**
 * 渲染进程 i18n 服务
 * 后端接口驱动，自动根据系统语言选择翻译
 *
 * Key 规范：{Client}.{Scope}.{Domain}.{key}
 * Client: Claw (Electron 客户端)
 *
 * 语言文件位于 @shared/locales/
 */

import { apiRequest } from "./api";

// ========== 类型定义 ==========

export type SystemLangMap = Record<string, string>;

export interface I18nLangDto {
  id: number;
  name: string;
  lang: string;
  status: number;
  isDefault: number;
  sort: number;
  modified: string;
  created: string;
}

// ========== 常量 ==========

const DEFAULT_I18N_LANG = "en-us";

const I18N_STORAGE_KEYS = {
  ACTIVE_LANG: "i18n.active_lang",
  LANG_MAP_CACHE: "i18n.lang_map_cache",
  LANG_MAP_CACHE_AT: "i18n.lang_map_cache_at",
  LANG_MAP_CACHE_LANG: "i18n.lang_map_cache_lang",
} as const;

const I18N_MAP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

// ========== 导入语言文件（Vite 支持 JSON import） ==========

import enUS from "@shared/locales/en-US.json";
import zhCN from "@shared/locales/zh-CN.json";
import zhTW from "@shared/locales/zh-TW.json";
import zhHK from "@shared/locales/zh-HK.json";

const LOCALE_MAPS: Record<string, SystemLangMap> = {
  en: enUS as SystemLangMap,
  "en-us": enUS as SystemLangMap,
  zh: zhCN as SystemLangMap,
  "zh-cn": zhCN as SystemLangMap,
  "zh-tw": zhTW as SystemLangMap,
  "zh-hk": zhHK as SystemLangMap,
};

const getLocaleMap = (lang: string): SystemLangMap => {
  const normalized = lang.toLowerCase();
  // 精确匹配
  if (LOCALE_MAPS[normalized]) {
    return LOCALE_MAPS[normalized];
  }
  // 前缀匹配
  for (const [key, map] of Object.entries(LOCALE_MAPS)) {
    if (normalized.startsWith(key)) {
      return map;
    }
  }
  // 中文泛匹配
  if (normalized.startsWith("zh")) {
    return zhCN as SystemLangMap;
  }
  return enUS as SystemLangMap;
};

// ========== 状态 ==========

let currentLang = DEFAULT_I18N_LANG;
let langMap: SystemLangMap = { ...(enUS as SystemLangMap) };
let zhBaseMap: SystemLangMap = { ...(zhCN as SystemLangMap) };
let zhValueToKeyMap: Record<string, string> = {};
let initialized = false;
const warnedLegacyKeys = new Set<string>();
const warnedInvalidKeys = new Set<string>();
const warnedMissingKeys = new Set<string>();

// ========== 工具函数 ==========

const normalizeLang = (lang?: string | null): string =>
  (lang || DEFAULT_I18N_LANG).toLowerCase();

const isZhLang = (lang?: string | null): boolean =>
  normalizeLang(lang).startsWith("zh");

const isLegacySystemKey = (key: string): boolean => key.startsWith("System.");

// Key 格式验证正则
// 格式: {Client}.{Scope}.{Domain}.{key} 或 {Client}.{Scope}.{key}
// Client: Claw|PC|Mobile
// Scope: 任意大写字母开头的标识符（如 Menu, Service, Agent, Client, App 等）
// Domain: 可选的点分隔路径（如 Status）
// key: 任意字母开头的标识符（支持大小写）
const I18N_KEY_REGEX =
  /^(Claw|PC|Mobile)\.[A-Z][A-Za-z0-9]*\.([A-Za-z0-9]+\.)*[A-Za-z][A-Za-z0-9]*$/;

const isValidI18nKey = (key: string): boolean => I18N_KEY_REGEX.test(key);

const warnOnce = (
  cache: Set<string>,
  key: string,
  logger: (k: string) => void,
): void => {
  if (cache.has(key)) return;
  cache.add(key);
  logger(key);
};

const formatText = (template: string, values: string[]): string => {
  if (!values.length) return template;
  let text = template;
  values.forEach((value, index) => {
    text = text.replace(new RegExp(`\\{${index}\\}`, "g"), value);
  });
  let cursor = 0;
  text = text.replace(/\{\}/g, () => values[cursor++] ?? "");
  return text;
};

// ========== Electron Settings 存储 ==========

const getBrowserLang = (): string => {
  if (typeof navigator === "undefined") {
    return DEFAULT_I18N_LANG;
  }
  return normalizeLang(navigator.language);
};

const readFromSettings = async (key: string): Promise<string | null> => {
  try {
    const value = await window.electronAPI?.settings.get(key);
    return value as string | null;
  } catch {
    return null;
  }
};

const writeToSettings = async (key: string, value: string): Promise<void> => {
  try {
    await window.electronAPI?.settings.set(key, value);
  } catch {
    // ignore cache failures
  }
};

/**
 * 获取用户配置的服务器域名
 * 优先使用 step1_config.serverHost（用户登录时配置的域名）
 */
const getUserDomain = async (): Promise<string | null> => {
  try {
    const step1 = (await window.electronAPI?.settings.get("step1_config")) as {
      serverHost?: string;
    } | null;
    return step1?.serverHost || null;
  } catch {
    return null;
  }
};

const readMapFromCache = async (
  lang: string,
): Promise<SystemLangMap | null> => {
  const cacheAtStr = await readFromSettings(
    I18N_STORAGE_KEYS.LANG_MAP_CACHE_AT,
  );
  const cacheText = await readFromSettings(I18N_STORAGE_KEYS.LANG_MAP_CACHE);
  const cacheLangRaw = await readFromSettings(
    I18N_STORAGE_KEYS.LANG_MAP_CACHE_LANG,
  );
  const cacheAt = Number(cacheAtStr);
  const cacheLang = cacheLangRaw ? normalizeLang(cacheLangRaw) : "";

  if (!cacheText || !cacheAt) return null;
  if (Date.now() - cacheAt > I18N_MAP_CACHE_TTL) return null;
  if (cacheLang && cacheLang !== normalizeLang(lang)) return null;

  try {
    const cacheValue = JSON.parse(cacheText) as SystemLangMap;
    if (cacheValue && typeof cacheValue === "object") {
      return cacheValue;
    }
  } catch {
    // ignore invalid cache
  }
  return null;
};

const persistMapCache = async (
  lang: string,
  map: SystemLangMap,
): Promise<void> => {
  await writeToSettings(I18N_STORAGE_KEYS.LANG_MAP_CACHE, JSON.stringify(map));
  await writeToSettings(
    I18N_STORAGE_KEYS.LANG_MAP_CACHE_AT,
    String(Date.now()),
  );
  await writeToSettings(
    I18N_STORAGE_KEYS.LANG_MAP_CACHE_LANG,
    normalizeLang(lang),
  );
};

const readLangFromCache = async (): Promise<string | null> => {
  return readFromSettings(I18N_STORAGE_KEYS.ACTIVE_LANG);
};

// ========== API ==========

const buildZhValueToKeyMap = (map: SystemLangMap): void => {
  const nextMap: Record<string, string> = {};
  Object.entries(map).forEach(([key, value]) => {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return;
    if (!(normalizedValue in nextMap)) {
      nextMap[normalizedValue] = key;
    }
  });
  zhValueToKeyMap = nextMap;
};

const fetchAndApplyLangMap = async (lang?: string): Promise<boolean> => {
  const targetLang = normalizeLang(lang || currentLang);
  const userDomain = await getUserDomain();
  try {
    const result = await apiRequest<SystemLangMap>("/api/i18n/query", {
      method: "GET",
      params: { lang: targetLang, side: "Claw" },
      headers: {
        "Accept-Language": targetLang,
        "X-Lang": targetLang,
      },
      showError: false,
      baseUrl: userDomain || undefined,
    });
    langMap = {
      ...getLocaleMap(targetLang),
      ...result,
    };
    await persistMapCache(targetLang, langMap);
    return true;
  } catch {
    return false;
  }
};

const fetchZhBaseMap = async (): Promise<void> => {
  zhBaseMap = { ...getLocaleMap("zh-cn") };
  const userDomain = await getUserDomain();
  try {
    const result = await apiRequest<SystemLangMap>("/api/i18n/query", {
      method: "GET",
      params: { lang: "zh-cn", side: "Claw" },
      headers: {
        "Accept-Language": "zh-cn",
        "X-Lang": "zh-cn",
      },
      showError: false,
      baseUrl: userDomain || undefined,
    });
    if (result) {
      zhBaseMap = {
        ...getLocaleMap("zh-cn"),
        ...result,
      };
    }
  } catch {
    // ignore zh fallback fetch errors
  }
  buildZhValueToKeyMap(zhBaseMap);
};

// ========== 导出函数 ==========

export const getCurrentLang = (): string => currentLang;

export const getCurrentLangMap = (): SystemLangMap => ({ ...langMap });

export const setCurrentLang = async (lang?: string | null): Promise<void> => {
  const resolvedLang = normalizeLang(lang || getBrowserLang());
  currentLang = resolvedLang;
  langMap = { ...getLocaleMap(resolvedLang) };
  await writeToSettings(I18N_STORAGE_KEYS.ACTIVE_LANG, resolvedLang);
};

export const initI18n = async (): Promise<void> => {
  if (initialized) return;

  const cachedLang = await readLangFromCache();
  const resolvedLang = normalizeLang(cachedLang || getBrowserLang());
  await setCurrentLang(resolvedLang);

  langMap = { ...getLocaleMap(resolvedLang) };

  const cachedMap = await readMapFromCache(resolvedLang);
  if (cachedMap) {
    langMap = {
      ...getLocaleMap(resolvedLang),
      ...cachedMap,
    };
  }

  const fetched = await fetchAndApplyLangMap();
  if (isZhLang(getCurrentLang())) {
    zhBaseMap = { ...langMap };
    buildZhValueToKeyMap(zhBaseMap);
  } else {
    await fetchZhBaseMap();
  }

  if (!Object.keys(zhValueToKeyMap).length) {
    buildZhValueToKeyMap(getLocaleMap("zh-cn"));
  }

  if (!fetched && !cachedMap) {
    langMap = { ...getLocaleMap(resolvedLang) };
  }
  initialized = true;
};

/**
 * 多语言翻译函数
 * @param key 翻译 key，格式：{Client}.{Scope}.{Domain}.{key}
 * @param values 替换参数，如 '{0}' 会替换为 values[0]
 */
export const dict = (key: string, ...values: string[]): string => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";

  if (isLegacySystemKey(normalizedKey)) {
    warnOnce(warnedLegacyKeys, normalizedKey, (k) => {
      console.error(
        `[i18n] Legacy key is not supported anymore and should be migrated: ${k}`,
      );
    });
    return normalizedKey;
  }

  if (!isValidI18nKey(normalizedKey)) {
    warnOnce(warnedInvalidKeys, normalizedKey, (k) => {
      console.error(
        `[i18n] Invalid key format. Expected {Client}.{Scope}.{Domain}.{key}: ${k}`,
      );
    });
    return normalizedKey;
  }

  const template =
    langMap[normalizedKey] ||
    getLocaleMap("en")[normalizedKey] ||
    getLocaleMap("zh-cn")[normalizedKey];
  if (!template) {
    warnOnce(warnedMissingKeys, normalizedKey, (k) => {
      console.error(`[i18n] Missing translation entry for key: ${k}`);
    });
    return normalizedKey;
  }

  return formatText(template, values);
};

/**
 * dict 的别名
 */
export const t = (key: string, ...values: string[]): string =>
  dict(key, ...values);

/**
 * 获取语言列表
 */
export async function fetchI18nLangList(): Promise<I18nLangDto[]> {
  const result = await apiRequest<I18nLangDto[]>("/api/i18n/lang/list", {
    method: "GET",
    showError: false,
  });
  return result || [];
}

/**
 * 翻译原始中文文本（基于中文到 key 的反向映射）
 */
export const translateLiteralText = (rawText: string): string => {
  const originalText = String(rawText || "");
  const trimmedText = originalText.trim();
  if (!trimmedText) return originalText;

  // 直接支持新规范 key 文本
  if (isValidI18nKey(trimmedText)) {
    return originalText.replace(trimmedText, dict(trimmedText));
  }

  if (isLegacySystemKey(trimmedText)) {
    dict(trimmedText);
    return originalText;
  }

  // 中文界面无需替换
  if (getCurrentLang().startsWith("zh")) {
    return originalText;
  }

  const key = zhValueToKeyMap[trimmedText];
  if (!key) return originalText;

  const translated = dict(key);
  if (!translated || translated === key) return originalText;
  return originalText.replace(trimmedText, translated);
};
