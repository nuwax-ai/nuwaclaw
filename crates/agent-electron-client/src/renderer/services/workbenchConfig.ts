import { AUTH_KEYS, STORAGE_KEYS } from "@shared/constants";
import {
  getDomainTokenKey,
  getWorkbenchAccessTokenKey,
} from "@shared/utils/domain";

export const WORKBENCH_APP_AGENT_ID_SETTING_KEY = "workbench.app_agent_id";
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

async function resolveAccessToken(
  baseUrl: string | null,
  userInfo: AuthUserInfoLike | null,
): Promise<string | null> {
  const oneShotToken = getNonEmptyString(
    await readSetting(AUTH_KEYS.AUTH_TOKEN),
  );
  if (oneShotToken) return oneShotToken;

  if (baseUrl) {
    const workbenchToken = getNonEmptyString(
      await readSetting(getWorkbenchAccessTokenKey(baseUrl)),
    );
    if (workbenchToken) return workbenchToken;

    const domainToken = getNonEmptyString(
      await readSetting(getDomainTokenKey(baseUrl)),
    );
    if (domainToken) return domainToken;
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
  const [userInfo, step1Config, settingAppAgentId, settingLocale] =
    await Promise.all([
      readSetting<AuthUserInfoLike>(AUTH_KEYS.USER_INFO),
      readSetting<Step1ConfigLike>(STORAGE_KEYS.STEP1_CONFIG),
      readSetting<string>(WORKBENCH_APP_AGENT_ID_SETTING_KEY),
      readSetting<string>(WORKBENCH_LOCALE_SETTING_KEY),
    ]);

  const baseUrl =
    normalizeBaseUrl(userInfo?.currentDomain) ??
    normalizeBaseUrl(step1Config?.serverHost) ??
    "";
  const accessToken =
    (await resolveAccessToken(baseUrl || null, userInfo)) ?? "";
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
