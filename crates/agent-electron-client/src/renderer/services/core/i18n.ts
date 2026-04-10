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
  LANG_FORCE_REFRESH_ON_INIT: "i18n.lang_force_refresh_on_init",
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

const isLocaleSupported = (lang: string): boolean => {
  const normalized = lang.toLowerCase();
  return normalized in LOCALE_MAPS;
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

const getLocalBaseMap = (lang: string): SystemLangMap => {
  const normalized = normalizeLang(lang);
  return getLocaleMap(normalized);
};

// ========== 状态 ==========

let currentLang = DEFAULT_I18N_LANG;
let langMap: SystemLangMap = { ...(enUS as SystemLangMap) };
let isCurrentLangSupported_ = true;
let zhBaseMap: SystemLangMap = { ...(zhCN as SystemLangMap) };
let zhValueToKeyMap: Record<string, string> = {};
let initPromise: Promise<void> | null = null;
const warnedLegacyKeys = new Set<string>();
const warnedInvalidKeys = new Set<string>();
const warnedMissingKeys = new Set<string>();

// ========== 工具函数 ==========

const normalizeLangStrict = (lang?: string | null): string =>
  String(lang || "")
    .trim()
    .toLowerCase();

const normalizeLang = (lang?: string | null): string =>
  normalizeLangStrict(lang) || DEFAULT_I18N_LANG;

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

  // 位置占位符：t(key, "a", "b") → 替换 {0} {1} 和 {}
  const stringValues = values.map((v) => String(v ?? ""));
  stringValues.forEach((value, index) => {
    text = text.replace(new RegExp(`\\{${index}\\}`, "g"), value);
  });
  let cursor = 0;
  text = text.replace(/\{\}/g, () => stringValues[cursor++] ?? "");
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

const readForceRefreshLangOnInit = async (): Promise<string> => {
  const lang = await readFromSettings(
    I18N_STORAGE_KEYS.LANG_FORCE_REFRESH_ON_INIT,
  );
  return normalizeLangStrict(lang);
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

export const fetchAndApplyLangMap = async (
  lang?: string,
  options?: { forceRefresh?: boolean },
): Promise<boolean> => {
  const targetLang = normalizeLang(lang || currentLang);
  const userDomain = await getUserDomain();
  try {
    const result = await apiRequest<SystemLangMap>("/api/i18n/query", {
      method: "GET",
      params: { lang: targetLang, side: "Claw" },
      headers: {
        "Accept-Language": targetLang,
      },
      cache: options?.forceRefresh ? "no-store" : undefined,
      showError: false,
      ...(userDomain ? { baseUrl: userDomain } : {}),
    });
    const mergedMap = {
      ...getLocalBaseMap(targetLang),
      ...result,
    };
    if (normalizeLang(currentLang) === targetLang) {
      langMap = mergedMap;
    }
    await persistMapCache(targetLang, mergedMap);
    return true;
  } catch {
    return false;
  }
};

// ========== 导出函数 ==========

export const getCurrentLang = (): string => currentLang;

export const getCurrentLangMap = (): SystemLangMap => ({ ...langMap });

export const isCurrentLangSupported = (): boolean => isCurrentLangSupported_;

export const setCurrentLang = async (lang?: string | null): Promise<void> => {
  const resolvedLang = normalizeLang(lang || getBrowserLang());
  currentLang = resolvedLang;
  isCurrentLangSupported_ = isLocaleSupported(resolvedLang);

  langMap = { ...getLocalBaseMap(resolvedLang) };
  await writeToSettings(I18N_STORAGE_KEYS.ACTIVE_LANG, resolvedLang);
};

export const initI18n = (): Promise<void> => {
  if (initPromise) return initPromise;
  initPromise = _doInitI18n();
  return initPromise;
};

const _doInitI18n = async (): Promise<void> => {
  const cachedLang = await readLangFromCache();
  const resolvedLang = normalizeLang(cachedLang || getBrowserLang());
  const forceRefreshLang = await readForceRefreshLangOnInit();
  const shouldForceRefresh = forceRefreshLang === resolvedLang;
  if (forceRefreshLang) {
    await writeToSettings(I18N_STORAGE_KEYS.LANG_FORCE_REFRESH_ON_INIT, "");
  }
  await setCurrentLang(resolvedLang);
  // 启动时同步主进程语言，避免主进程弹窗（如自动更新）与渲染进程语言不一致
  try {
    await window.electronAPI?.i18n?.setLang(resolvedLang);
  } catch {
    // ignore sync failures
  }

  const baseMap = getLocalBaseMap(resolvedLang);
  langMap = { ...baseMap };

  const cachedMap = await readMapFromCache(resolvedLang);
  if (cachedMap) {
    langMap = {
      ...baseMap,
      ...cachedMap,
    };
  }

  if (isZhLang(resolvedLang)) {
    zhBaseMap = { ...langMap };
    buildZhValueToKeyMap(zhBaseMap);
  } else if (!Object.keys(zhValueToKeyMap).length) {
    buildZhValueToKeyMap(getLocaleMap("zh-cn"));
  }

  // 远端翻译改为后台刷新，避免首屏/切换语言时阻塞。
  void (async () => {
    const fetched = await fetchAndApplyLangMap(resolvedLang, {
      forceRefresh: shouldForceRefresh,
    });

    if (isZhLang(resolvedLang)) {
      if (normalizeLang(currentLang) === resolvedLang) {
        zhBaseMap = { ...langMap };
        buildZhValueToKeyMap(zhBaseMap);
      }
    }
    // 非中文语言：使用本地 zh-CN.json 构建反向映射即可，无需额外请求服务端

    if (!fetched && !cachedMap && normalizeLang(currentLang) === resolvedLang) {
      langMap = { ...baseMap };
    }
  })().catch(() => {
    // ignore background refresh failures
  });
};

/**
 * 标记下次初始化时强制 no-store 刷新当前语言翻译。
 * 用于语言切换后刷新页面，避免切换流程被网络阻塞。
 */
export const scheduleLangMapRefreshOnNextInit = async (
  lang?: string | null,
): Promise<void> => {
  const targetLang = normalizeLangStrict(lang || currentLang);
  if (!targetLang) return;
  await writeToSettings(
    I18N_STORAGE_KEYS.LANG_FORCE_REFRESH_ON_INIT,
    targetLang,
  );
};

/**
 * 切换语言后强制刷新翻译映射（绕过浏览器缓存），并更新中文反向映射。
 * 返回值表示是否成功从服务端拉取到最新翻译。
 */
export const refreshLangMap = async (
  lang?: string | null,
): Promise<boolean> => {
  const targetLang = normalizeLang(lang || currentLang);
  await setCurrentLang(targetLang);

  const fetched = await fetchAndApplyLangMap(targetLang, {
    forceRefresh: true,
  });
  if (isZhLang(targetLang)) {
    zhBaseMap = { ...langMap };
    buildZhValueToKeyMap(zhBaseMap);
  }
  // 非中文语言：本地 zh-CN.json 反向映射已由 _doInitI18n 构建，无需额外请求

  if (!Object.keys(zhValueToKeyMap).length) {
    buildZhValueToKeyMap(getLocaleMap("zh-cn"));
  }

  return fetched;
};

/**
 * 多语言翻译函数
 * @param key 翻译 key，格式：{Client}.{Scope}.{Domain}.{key}
 * @param values 替换参数：
 *   - 位置占位符：t(key, "a", "b") → 替换 {0}/{1} 或 {}
 *   - 命名占位符：t(key, { error: "xxx" }) → 替换 {error}
 */
export const dict = (key: string, ...values: I18nValues): string => {
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

  let template = langMap[normalizedKey];
  if (!template && isCurrentLangSupported()) {
    template =
      getLocaleMap("en")[normalizedKey] || getLocaleMap("zh-cn")[normalizedKey];
  }
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
export const t = (key: string, ...values: I18nValues): string =>
  dict(key, ...values);

/**
 * 获取语言列表（Promise 缓存，避免 SettingsPage useEffect 多次触发重复请求）
 */
let langListPromise: Promise<I18nLangDto[]> | null = null;
export async function fetchI18nLangList(): Promise<I18nLangDto[]> {
  if (langListPromise) return langListPromise;
  langListPromise = (async () => {
    const userDomain = await getUserDomain();
    const result = await apiRequest<I18nLangDto[]>("/api/i18n/lang/list", {
      method: "GET",
      showError: false,
      ...(userDomain ? { baseUrl: userDomain } : {}),
    });
    return result || [];
  })();
  return langListPromise;
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
