import { AUTH_KEYS, STORAGE_KEYS } from "@shared/constants";
import {
  getDomainTokenKey,
  getWorkbenchAccessTokenKey,
} from "@shared/utils/domain";
import { recoverWorkbenchAccessToken } from "./workbenchToken";

export const WORKBENCH_APP_AGENT_ID_SETTING_KEY = "workbench.app_agent_id";
/** 设置页保存 appAgentId 后派发，供 App.tsx 在 Agent Mode 打开时重载配置 */
export const WORKBENCH_CONFIG_CHANGED_EVENT = "workbench:config-changed";
export const WORKBENCH_PREVIEW_CONTAINER = "electron-webview" as const;
export const WORKBENCH_LOCALE_SETTING_KEY = "i18n.active_lang";
export const DEFAULT_WORKBENCH_LOCALE = "en-us";

export interface AgentWorkbenchConfig {
  baseUrl: string;
  accessToken: string;
  appAgentId: string;
  workspaceDir: string;
  locale: string;
  previewContainer: typeof WORKBENCH_PREVIEW_CONTAINER;
  useMock?: boolean;
}

export type WorkbenchConfigMissingKey =
  | "baseUrl"
  | "accessToken"
  | "appAgentId"
  | "workspaceDir";

export type WorkbenchConfigMissing = Record<WorkbenchConfigMissingKey, boolean>;

export interface LoadWorkbenchConfigResult {
  config: AgentWorkbenchConfig;
  missing: WorkbenchConfigMissing;
  missingKeys: WorkbenchConfigMissingKey[];
  useMock: boolean;
}

interface Step1ConfigLike {
  serverHost?: unknown;
  workspaceDir?: unknown;
}

interface AuthUserInfoLike {
  currentDomain?: unknown;
  accessToken?: unknown;
  token?: unknown;
  appAgentId?: unknown;
  app_agent_id?: unknown;
  appAgentID?: unknown;
  appAgent?: unknown;
  app_agent?: unknown;
}

type SettingsApi = {
  get: (key: string) => Promise<unknown>;
};

async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const settings = getSettingsApi();
    if (!settings) return null;
    const value = await settings.get(key);
    return (value as T) ?? null;
  } catch {
    return null;
  }
}

function getSettingsApi(): SettingsApi | null {
  return globalThis.window?.electronAPI?.settings ?? null;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: unknown): string | null {
  const raw = getNonEmptyString(value);
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function normalizeLocale(value: unknown): string {
  const locale = getNonEmptyString(value);
  return locale ? locale.toLowerCase() : DEFAULT_WORKBENCH_LOCALE;
}

function getBrowserLocale(): string | null {
  if (typeof navigator === "undefined") return null;
  return getNonEmptyString(navigator.language);
}

function getEnvAppAgentId(): string | null {
  return getNonEmptyString(import.meta.env.VITE_NUWAX_APP_AGENT_ID);
}

function pickNestedId(value: unknown): string | null {
  const direct = getNonEmptyString(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return null;
  return getNonEmptyString((value as { id?: unknown }).id);
}

export function getAppAgentIdFromUserInfo(
  userInfo: AuthUserInfoLike | null,
): string | null {
  if (!userInfo) return null;

  return (
    getNonEmptyString(userInfo.appAgentId) ??
    getNonEmptyString(userInfo.app_agent_id) ??
    getNonEmptyString(userInfo.appAgentID) ??
    pickNestedId(userInfo.appAgent) ??
    pickNestedId(userInfo.app_agent)
  );
}

function uniqueDomainCandidates(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const value of values) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    domains.push(normalized);
  }
  return domains;
}

/** 按域名读取 workbench / auth 缓存 token */
async function readTokenForDomain(domain: string): Promise<string | null> {
  const workbenchToken = getNonEmptyString(
    await readSetting(getWorkbenchAccessTokenKey(domain)),
  );
  if (workbenchToken) return workbenchToken;

  const domainToken = getNonEmptyString(
    await readSetting(getDomainTokenKey(domain)),
  );
  if (domainToken) return domainToken;

  return null;
}

/**
 * 解析 Agent Mode 用的 Bearer token。
 * 顺序：one-shot → userInfo.accessToken → 各候选域名的 workbench/domain 缓存。
 */
async function resolveAccessToken(
  baseUrl: string | null,
  userInfo: AuthUserInfoLike | null,
  extraDomains: string[] = [],
): Promise<string | null> {
  const oneShotToken = getNonEmptyString(
    await readSetting(AUTH_KEYS.AUTH_TOKEN),
  );
  if (oneShotToken) return oneShotToken;

  const explicitUserToken = getNonEmptyString(userInfo?.accessToken);
  if (explicitUserToken) return explicitUserToken;

  const domains = uniqueDomainCandidates(
    baseUrl,
    userInfo?.currentDomain,
    ...extraDomains,
  );
  for (const domain of domains) {
    const cached = await readTokenForDomain(domain);
    if (cached) return cached;
  }

  return getNonEmptyString(userInfo?.token);
}

function buildMissing(config: AgentWorkbenchConfig): WorkbenchConfigMissing {
  return {
    baseUrl: !config.baseUrl,
    accessToken: !config.accessToken,
    appAgentId: !config.appAgentId,
    workspaceDir: !config.workspaceDir,
  };
}

function collectMissingKeys(
  missing: WorkbenchConfigMissing,
): WorkbenchConfigMissingKey[] {
  return (Object.keys(missing) as WorkbenchConfigMissingKey[]).filter(
    (key) => missing[key],
  );
}

export async function loadWorkbenchConfig(): Promise<LoadWorkbenchConfigResult> {
  const [
    userInfo,
    step1Config,
    settingAppAgentId,
    settingLocale,
    lanproxyHost,
  ] = await Promise.all([
    readSetting<AuthUserInfoLike>(AUTH_KEYS.USER_INFO),
    readSetting<Step1ConfigLike>(STORAGE_KEYS.STEP1_CONFIG),
    readSetting<string>(WORKBENCH_APP_AGENT_ID_SETTING_KEY),
    readSetting<string>(WORKBENCH_LOCALE_SETTING_KEY),
    readSetting<string>(AUTH_KEYS.LANPROXY_SERVER_HOST),
  ]);

  const baseUrl =
    normalizeBaseUrl(userInfo?.currentDomain) ??
    normalizeBaseUrl(step1Config?.serverHost) ??
    "";
  const domainCandidates = [
    baseUrl,
    userInfo?.currentDomain,
    getNonEmptyString(step1Config?.serverHost),
    getNonEmptyString(lanproxyHost),
  ].filter(Boolean) as string[];

  let accessToken =
    (await resolveAccessToken(baseUrl || null, userInfo, domainCandidates)) ??
    "";
  if (!accessToken) {
    accessToken = (await recoverWorkbenchAccessToken(domainCandidates)) ?? "";
  }
  const appAgentId =
    getAppAgentIdFromUserInfo(userInfo) ??
    getNonEmptyString(settingAppAgentId) ??
    getEnvAppAgentId() ??
    "";
  const workspaceDir = getNonEmptyString(step1Config?.workspaceDir) ?? "";
  const locale = normalizeLocale(
    settingLocale ?? getBrowserLocale() ?? DEFAULT_WORKBENCH_LOCALE,
  );

  const configWithoutMock: AgentWorkbenchConfig = {
    baseUrl,
    accessToken,
    appAgentId,
    workspaceDir,
    locale,
    previewContainer: WORKBENCH_PREVIEW_CONTAINER,
  };
  const missing = buildMissing(configWithoutMock);
  const useMock = missing.accessToken || missing.appAgentId;
  const config: AgentWorkbenchConfig = {
    ...configWithoutMock,
    useMock,
  };

  return {
    config,
    missing,
    missingKeys: collectMissingKeys(missing),
    useMock,
  };
}
