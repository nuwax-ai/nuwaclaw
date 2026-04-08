/**
 * i18n 配置
 * 启动时从后端 /api/i18n/lang/list 拉取语言列表，动态扩展 i18next supportedLngs
 *
 * 注意：此文件仅用于初始化 i18next
 * 实际翻译使用 @/services/core/i18n 中的 dict() 函数
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_SERVER_HOST } from "@shared/constants";

const STATIC_SUPPORTED_LNGS = [
  "en",
  "en-us",
  "zh",
  "zh-cn",
  "zh-tw",
  "zh-hk",
  "en-US",
  "zh-CN",
  "zh-TW",
  "zh-HK",
] as const;

interface I18nLangListItem {
  lang?: string;
  status?: number;
}

interface LangListResponse<T = unknown> {
  code: string;
  success?: boolean;
  data: T;
}

function normalizeLangCode(lang: string): string {
  return String(lang || "").trim();
}

function mergeSupportedLngs(extraLangs: string[]): string[] {
  const merged = new Set<string>(STATIC_SUPPORTED_LNGS);

  for (const lang of extraLangs) {
    const raw = normalizeLangCode(lang);
    if (!raw) continue;
    merged.add(raw);
    merged.add(raw.toLowerCase());
  }

  return [...merged];
}

async function getUserDomain(): Promise<string> {
  try {
    const step1 = (await window.electronAPI?.settings.get("step1_config")) as {
      serverHost?: string;
    } | null;
    return step1?.serverHost || DEFAULT_SERVER_HOST;
  } catch {
    return DEFAULT_SERVER_HOST;
  }
}

async function fetchSupportedLangsFromServer(): Promise<string[]> {
  try {
    const baseUrl = await getUserDomain();
    const response = await fetch(`${baseUrl}/api/i18n/lang/list`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as LangListResponse<
      I18nLangListItem[]
    >;
    if (payload?.code !== "0000" || !Array.isArray(payload.data)) return [];

    return payload.data
      .filter((item) => (item?.status ?? 0) === 1)
      .map((item) => normalizeLangCode(item?.lang || ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

i18n.init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...STATIC_SUPPORTED_LNGS],
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

let initSupportedLangsPromise: Promise<void> | null = null;

export function initSupportedLangs(): Promise<void> {
  if (initSupportedLangsPromise) return initSupportedLangsPromise;

  initSupportedLangsPromise = (async () => {
    const dynamicLangs = await fetchSupportedLangsFromServer();
    const nextSupportedLngs = mergeSupportedLngs(dynamicLangs);
    i18n.options.supportedLngs = nextSupportedLngs;
  })();

  return initSupportedLangsPromise;
}

export default i18n;
