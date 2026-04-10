/**
 * 设置页面（对齐 Tauri 客户端）
 *
 * 功能：
 * - 服务配置（端口、工作区目录）
 * - AI 配置（API key、模型、max_tokens、温度）
 * - 系统设置（主题、开机自启动、日志目录）
 */

import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  Button,
  Form,
  Row,
  Col,
  Input,
  InputNumber,
  Select,
  Slider,
  Switch,
  message,
  Modal,
  Spin,
  Tooltip,
} from "antd";
import {
  FolderOutlined,
  SaveOutlined,
  EditOutlined,
  SettingOutlined,
  DesktopOutlined,
  ReloadOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import { APP_DISPLAY_NAME, APP_DATA_DIR_NAME } from "@shared/constants";
import {
  setupService,
  Step1Config,
  DEFAULT_STEP1_CONFIG,
} from "../../services/core/setup";
import {
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MODEL_OPTIONS,
  STORAGE_KEYS,
  I18N_KEYS,
} from "@shared/constants";
import { FEATURES } from "@shared/featureFlags";
import {
  t,
  setCurrentLang,
  scheduleLangMapRefreshOnNextInit,
  fetchI18nLangList,
  type I18nLangDto,
} from "../../services/core/i18n";
import i18next from "../../services/i18n";

import styles from "../../styles/components/ClientPage.module.css";
import { useTheme, useI18nLang, type ThemeMode } from "../../App";
import type {
  SandboxCapabilities,
  SandboxPolicy,
  SandboxStatus,
} from "@shared/types/sandbox";

// Dev tools: 仅开发模式加载
const IS_DEV = import.meta.env.DEV;
const DevToolsPanel = IS_DEV
  ? React.lazy(() => import("../dev/DevToolsPanel"))
  : null;

// AI 配置接口
interface AISettings {
  default_model: string;
  max_tokens: number;
  temperature: number;
}

const DEFAULT_AI_SETTINGS: AISettings = {
  default_model: DEFAULT_AI_MODEL,
  max_tokens: DEFAULT_MAX_TOKENS,
  temperature: DEFAULT_TEMPERATURE,
};

// Backend options are not exposed in UI — "auto" is used by default.

// 本地支持的语言选项（兜底用）
// 使用与后端一致的完整语言码格式（如 zh-cn），与 i18nLang 格式对齐
const LOCAL_LANG_OPTIONS = [
  { value: "en-us", label: t("Claw.Settings.system.langEnglish") },
  { value: "zh-cn", label: t("Claw.Settings.system.langChinese") },
  { value: "zh-tw", label: t("Claw.Settings.system.langChineseTW") },
  { value: "zh-hk", label: t("Claw.Settings.system.langChineseHK") },
];

export default function SettingsPage() {
  // 主题
  const { themeMode, setThemeMode } = useTheme();

  // 服务配置
  const [form] = Form.useForm<Step1Config>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<Step1Config | null>(
    null,
  );

  // AI 配置
  const [aiForm] = Form.useForm<AISettings & { apiKey: string }>();
  const [aiEditing, setAiEditing] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [originalAiConfig, setOriginalAiConfig] = useState<
    (AISettings & { apiKey: string }) | null
  >(null);

  // 系统设置
  const [autolaunchEnabled, setAutolaunchEnabled] = useState(false);
  const [autolaunchLoading, setAutolaunchLoading] = useState(false);
  const [logDir, setLogDir] = useState("");
  const { lang: i18nLang } = useI18nLang();
  const [langChanging, setLangChanging] = useState(false);
  const [langList, setLangList] = useState<I18nLangDto[]>([]);
  const [langConfirmModalVisible, setLangConfirmModalVisible] = useState(false);
  const [langConfirmLoading, setLangConfirmLoading] = useState(false);
  const [pendingLang, setPendingLang] = useState("");
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxPolicy, setSandboxPolicy] = useState<SandboxPolicy | null>(
    null,
  );
  const [sandboxCapabilities, setSandboxCapabilities] =
    useState<SandboxCapabilities | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(
    null,
  );

  // GUI MCP 设置
  const [guiMcpLoading, setGuiMcpLoading] = useState(false);
  const [guiMcpSaving, setGuiMcpSaving] = useState(false);
  const [guiMcpEnabled, setGuiMcpEnabled] = useState<boolean | null>(null);

  // 使用表单中的 workspaceDir 作为"系统模块"的展示源，确保编辑保存后展示保持实时一致。
  const workspaceDir = Form.useWatch("workspaceDir", form) || "";

  // ========== 加载服务配置 ==========
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const config = await setupService.getStep1Config();
      form.setFieldsValue(config);
      setOriginalConfig(config);
    } catch (error) {
      console.error("Failed to load config:", error);
      message.error(t(I18N_KEYS.Toast.ERROR.LOAD_FAILED));
    } finally {
      setLoading(false);
    }
  }, [form]);

  // ========== 加载 AI 配置 ==========
  const loadAiConfig = useCallback(async () => {
    try {
      const apiKey = (await window.electronAPI?.settings.get(
        STORAGE_KEYS.API_KEY,
      )) as string | null;
      const settings = (await window.electronAPI?.settings.get(
        "app_settings",
      )) as AISettings | null;
      const aiConfig = {
        apiKey: apiKey || "",
        default_model:
          settings?.default_model || DEFAULT_AI_SETTINGS.default_model,
        max_tokens: settings?.max_tokens || DEFAULT_AI_SETTINGS.max_tokens,
        temperature: settings?.temperature ?? DEFAULT_AI_SETTINGS.temperature,
      };
      aiForm.setFieldsValue(aiConfig);
      setOriginalAiConfig(aiConfig);
    } catch (error) {
      console.error("Failed to load AI config:", error);
    }
  }, [aiForm]);

  // ========== 加载系统设置 ==========
  const loadSystemSettings = useCallback(async () => {
    try {
      const enabled = await window.electronAPI?.autolaunch?.get();
      setAutolaunchEnabled(enabled ?? false);
    } catch (error) {
      console.error("Failed to load autolaunch status:", error);
    }
    try {
      const dir = await window.electronAPI?.log?.getDir();
      setLogDir(dir || "");
    } catch (error) {
      console.error("Failed to load log directory:", error);
    }
  }, []);

  const loadSandboxState = useCallback(async () => {
    if (!window.electronAPI?.sandbox) return;

    setSandboxLoading(true);
    try {
      const [policyRes, capsRes, statusRes] = await Promise.all([
        window.electronAPI.sandbox.getPolicy(),
        window.electronAPI.sandbox.capabilities(),
        window.electronAPI.sandbox.status(),
      ]);

      if (policyRes?.success && policyRes.data) {
        setSandboxPolicy(policyRes.data);
      }
      if (capsRes?.success && capsRes.data) {
        setSandboxCapabilities(capsRes.data);
      }
      if (statusRes?.success && statusRes.data) {
        setSandboxStatus(statusRes.data);
      }
    } catch (error) {
      console.error("Failed to load sandbox config:", error);
    } finally {
      setSandboxLoading(false);
    }
  }, []);

  const loadGuiMcpState = useCallback(async () => {
    if (!window.electronAPI?.guiServer) return;
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) return;

    setGuiMcpLoading(true);
    try {
      const result = await window.electronAPI.guiServer.isEnabled();
      if (result.enabled !== undefined) {
        setGuiMcpEnabled(result.enabled);
      }
    } catch (error) {
      console.error("Failed to load GUI MCP state:", error);
    } finally {
      setGuiMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadAiConfig();
    loadSystemSettings();
    loadSandboxState();
    loadGuiMcpState();

    // 监听来自托盘等外部修改的自启动状态变化
    const handleAutolaunchChanged = (enabled: boolean) => {
      setAutolaunchEnabled(enabled);
    };
    window.electronAPI?.on(
      "autolaunch:changed",
      handleAutolaunchChanged as any,
    );
    return () => {
      window.electronAPI?.off(
        "autolaunch:changed",
        handleAutolaunchChanged as any,
      );
    };
  }, [loadConfig, loadAiConfig, loadSystemSettings, loadSandboxState]);

  // ========== 加载语言列表 ==========
  useEffect(() => {
    const loadLangList = async () => {
      try {
        const list = await fetchI18nLangList();
        if (list && list.length > 0) {
          setLangList(list);
        }
      } catch {
        // 失败时保持空，使用本地兜底
      }
    };
    loadLangList();
  }, []);

  // ========== 服务配置操作 ==========
  const handleSelectWorkspace = async () => {
    const result = await window.electronAPI?.dialog.openDirectory(
      t("Claw.Settings.dialog.selectWorkspace"),
    );
    if (result?.success && result.path) {
      form.setFieldValue("workspaceDir", result.path);
    }
  };

  const handleCancelEdit = () => {
    if (originalConfig) {
      form.setFieldsValue(originalConfig);
    }
    setEditing(false);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      Modal.confirm({
        title: t("Claw.Settings.messages.saveConfig"),
        content: t("Claw.Settings.messages.saveConfigConfirm"),
        okText: t("Claw.Settings.saveConfig.save"),
        cancelText: t("Claw.Settings.saveConfig.cancel"),
        onOk: async () => {
          setSaving(true);
          try {
            const existing = await setupService.getStep1Config();
            await setupService.saveStep1Config({ ...existing, ...values });
            setOriginalConfig(values);
            setEditing(false);
            message.success(t(I18N_KEYS.Toast.SUCCESS.CONFIG_SAVED));
          } catch (error) {
            message.error(t(I18N_KEYS.Toast.ERROR.CONFIG_SAVE_FAILED));
          } finally {
            setSaving(false);
          }
        },
      });
    } catch {
      // form validation failed
    }
  };

  // ========== AI 配置操作 ==========
  const handleCancelAiEdit = () => {
    if (originalAiConfig) {
      aiForm.setFieldsValue(originalAiConfig);
    }
    setAiEditing(false);
  };

  const handleSaveAiConfig = async () => {
    try {
      const values = await aiForm.validateFields();
      setAiSaving(true);
      try {
        // 保存 API Key
        await window.electronAPI?.settings.set(
          STORAGE_KEYS.API_KEY,
          values.apiKey || "",
        );
        // 保存其他 AI 设置
        await window.electronAPI?.settings.set("app_settings", {
          default_model: values.default_model,
          max_tokens: values.max_tokens,
          temperature: values.temperature,
        });
        setOriginalAiConfig(values);
        setAiEditing(false);
        message.success(t(I18N_KEYS.Toast.SUCCESS.AI_CONFIG_SAVED));
      } catch (error) {
        message.error(t(I18N_KEYS.Toast.ERROR.AI_CONFIG_SAVE_FAILED));
      } finally {
        setAiSaving(false);
      }
    } catch {
      // form validation failed
    }
  };

  // ========== 系统设置操作 ==========
  const handleAutolaunchChange = async (enabled: boolean) => {
    setAutolaunchLoading(true);
    try {
      const result = await window.electronAPI?.autolaunch?.set(enabled);
      if (result?.success) {
        setAutolaunchEnabled(enabled);
        message.success(
          enabled
            ? t("Claw.Settings.messages.autoLaunchEnabled")
            : t("Claw.Settings.messages.autoLaunchDisabled"),
        );
      } else {
        message.error(
          result?.error || t("Claw.Settings.messages.settingFailed"),
        );
      }
    } catch (error) {
      message.error(t(I18N_KEYS.Toast.ERROR.OPEN_SETTINGS_FAILED));
    } finally {
      setAutolaunchLoading(false);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      await window.electronAPI?.log?.openDir();
    } catch {
      message.error(t(I18N_KEYS.Toast.ERROR.OPEN_LOGS_FAILED));
    }
  };

  const handleOpenWorkspaceDir = async () => {
    // 没有有效目录时直接提示，避免触发无意义 IPC 调用。
    if (!workspaceDir) {
      message.warning(t("Claw.Settings.messages.workspaceNotConfigured"));
      return;
    }
    try {
      const result = await window.electronAPI?.shell?.openPath(workspaceDir);
      if (!result?.success) {
        message.error(
          result?.error || t("Claw.Settings.messages.openWorkspaceFailed"),
        );
      }
    } catch {
      message.error(t("Claw.Settings.messages.openWorkspaceFailed"));
    }
  };

  const handlePatchSandboxPolicy = async (
    patch: Partial<SandboxPolicy>,
    opts?: { skipMutualExclusion?: boolean },
  ) => {
    if (!window.electronAPI?.sandbox) return;
    if (patch.enabled === true && sandboxCapabilities?.platform === "linux") {
      message.warning(t("Claw.Settings.messages.sandboxLinuxNotAvailableYet"));
      return;
    }

    // GUI MCP 与 Sandbox 互斥：开启 Sandbox 前先关闭 GUI MCP。
    if (
      !opts?.skipMutualExclusion &&
      patch.enabled === true &&
      FEATURES.ENABLE_GUI_AGENT_SERVER &&
      guiMcpEnabled &&
      window.electronAPI?.guiServer
    ) {
      setGuiMcpSaving(true);
      try {
        const disableGuiResult =
          await window.electronAPI.guiServer.setEnabled(false);
        if (!disableGuiResult.success) {
          message.error(
            disableGuiResult.error ||
              t("Claw.Settings.guiMcp.messages.updateFailed"),
          );
          return;
        }
        setGuiMcpEnabled(false);
        message.success(t("Claw.Settings.guiMcp.messages.disableSuccess"));
      } catch {
        message.error(t("Claw.Settings.guiMcp.messages.updateFailed"));
        return;
      } finally {
        setGuiMcpSaving(false);
      }
    }

    setSandboxSaving(true);
    try {
      const result = await window.electronAPI.sandbox.setPolicy(patch);
      if (result?.success && result.data) {
        setSandboxPolicy(result.data);
        message.success(t("Claw.Settings.messages.sandboxPolicyUpdated"));
        await loadSandboxState();
      } else {
        message.error(
          result?.error ||
            t("Claw.Settings.messages.updateSandboxPolicyFailed"),
        );
      }
    } catch (error) {
      message.error(t("Claw.Settings.messages.updateSandboxPolicyFailed"));
    } finally {
      setSandboxSaving(false);
    }
  };

  const handleSetGuiMcpEnabled = async (
    enabled: boolean,
    opts?: { skipMutualExclusion?: boolean },
  ) => {
    if (!window.electronAPI?.guiServer) return;

    // GUI MCP 与 Sandbox 互斥：开启 GUI MCP 前先关闭 Sandbox。
    if (
      enabled &&
      !opts?.skipMutualExclusion &&
      sandboxPolicy?.enabled &&
      window.electronAPI?.sandbox
    ) {
      setSandboxSaving(true);
      try {
        const disableSandboxResult = await window.electronAPI.sandbox.setPolicy(
          {
            enabled: false,
          },
        );
        if (disableSandboxResult?.success && disableSandboxResult.data) {
          setSandboxPolicy(disableSandboxResult.data);
          message.success(t("Claw.Settings.messages.sandboxPolicyUpdated"));
          await loadSandboxState();
        } else {
          message.error(
            disableSandboxResult?.error ||
              t("Claw.Settings.messages.updateSandboxPolicyFailed"),
          );
          return;
        }
      } catch {
        message.error(t("Claw.Settings.messages.updateSandboxPolicyFailed"));
        return;
      } finally {
        setSandboxSaving(false);
      }
    }

    setGuiMcpSaving(true);
    try {
      const result = await window.electronAPI.guiServer.setEnabled(enabled);
      if (result.success) {
        setGuiMcpEnabled(enabled);
        message.success(
          t(
            enabled
              ? "Claw.Settings.guiMcp.messages.enableSuccess"
              : "Claw.Settings.guiMcp.messages.disableSuccess",
          ),
        );
      } else {
        message.error(
          result.error || t("Claw.Settings.guiMcp.messages.updateFailed"),
        );
      }
    } catch {
      message.error(t("Claw.Settings.guiMcp.messages.updateFailed"));
    } finally {
      setGuiMcpSaving(false);
    }
  };

  // ========== 语言切换 ==========
  const handleLanguageChange = async (lang: string) => {
    setPendingLang(lang);
    setLangConfirmModalVisible(true);
  };

  const handleLangConfirm = async () => {
    const lang = pendingLang;
    if (!lang) return;
    setLangConfirmLoading(true);

    // 确保 loading 最少展示 500ms，避免闪烁
    const minLoadingDelay = new Promise((resolve) => setTimeout(resolve, 500));

    try {
      // 1. 立即切换本地语言（不阻塞等待网络）
      await setCurrentLang(lang);
      // 2. 标记下次初始化时强制 no-store 刷新翻译
      await scheduleLangMapRefreshOnNextInit(lang);

      // 3. 同步到主进程（检查返回值，失败则抛出）
      const result = await window.electronAPI?.i18n?.setLang(lang);
      if (result && !result.success) {
        throw new Error(result.error || "Main process language change failed");
      }

      // 4. 刷新页面，初始化阶段后台重新拉取翻译
      await minLoadingDelay;
      window.location.reload();
    } catch (error) {
      console.error("Language change failed:", error);
      message.error(t("Claw.Settings.messages.languageChangeFailed"));
      setLangConfirmModalVisible(false);
    } finally {
      setLangConfirmLoading(false);
    }
  };

  const handleLangCancel = () => {
    setLangConfirmModalVisible(false);
    setPendingLang("");
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* 服务配置 */}
      <div className={styles.section}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <SettingOutlined
              style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
            />
            <span className={styles.sectionTitle}>
              {t("Claw.Settings.saveConfig.title")}
            </span>
          </div>
          {editing ? (
            <div className={styles.servicesHeaderActions}>
              <Button size="small" onClick={handleCancelEdit} disabled={saving}>
                {t("Claw.Settings.saveConfig.cancel")}
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                {t("Claw.Settings.saveConfig.save")}
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(true)}
            >
              {t("Claw.Settings.saveConfig.edit")}
            </Button>
          )}
        </div>
        <div className={styles.sectionBody}>
          <Form form={form} layout="vertical" disabled={!editing} size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="fileServerPort"
                  label={t("Claw.Settings.saveConfig.fileServerPort")}
                  rules={[
                    {
                      required: true,
                      message: t("Claw.Settings.saveConfig.enterPort"),
                    },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="agentPort"
                  label={t("Claw.Settings.saveConfig.agentPort")}
                  rules={[
                    {
                      required: true,
                      message: t("Claw.Settings.saveConfig.enterPort"),
                    },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              {FEATURES.ENABLE_GUI_AGENT_SERVER && (
                <Col span={8}>
                  <Form.Item
                    name="guiMcpPort"
                    label={t("Claw.Settings.saveConfig.guiMcpPort")}
                    rules={[
                      {
                        required: true,
                        message: t("Claw.Settings.saveConfig.enterPort"),
                      },
                    ]}
                  >
                    <InputNumber
                      min={1}
                      max={65535}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                </Col>
              )}
            </Row>

            <Form.Item
              name="workspaceDir"
              label={t("Claw.Settings.workspace.title")}
              rules={[
                {
                  required: true,
                  message: t("Claw.Settings.workspace.selectDir"),
                },
              ]}
              style={{ marginBottom: 0 }}
            >
              <Input
                placeholder={t("Claw.Settings.workspace.clickToSelect")}
                readOnly
                addonAfter={
                  editing && (
                    <Button
                      type="text"
                      size="small"
                      icon={<FolderOutlined />}
                      onClick={handleSelectWorkspace}
                      style={{ padding: 0 }}
                    >
                      {t("Claw.Settings.workspace.select")}
                    </Button>
                  )
                }
              />
            </Form.Item>
          </Form>

          {!editing && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: "var(--color-text-tertiary)",
              }}
            >
              {t("Claw.Settings.saveConfig.restartHint")}
            </div>
          )}
        </div>
      </div>

      {/* 实验功能：Sandbox / GUI MCP */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <ExperimentOutlined
            style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
          />
          <span className={styles.sectionTitle}>
            {t("Claw.Settings.experimental.title")}
          </span>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          <div
            style={{
              padding: "10px 0 0 0",
              fontSize: 11,
              color: "var(--color-text-tertiary)",
            }}
          >
            {t("Claw.Settings.experimental.mutualExclusionHint")}
          </div>

          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.sandbox.enable")}
                </span>
                <div className={styles.serviceDescription}>
                  {sandboxStatus
                    ? (() => {
                        const { type, available, degraded, reason } =
                          sandboxStatus;
                        const isolation = degraded
                          ? t("Claw.Settings.sandbox.statusDegraded")
                          : available
                            ? t("Claw.Settings.sandbox.statusAvailable")
                            : t("Claw.Settings.sandbox.statusUnavailable");
                        return `${type} · ${isolation}${
                          reason ? ` · ${reason}` : ""
                        }`;
                      })()
                    : t("Claw.Settings.sandbox.statusNotLoaded")}
                </div>
              </div>
            </div>
            <Switch
              size="small"
              checked={sandboxPolicy?.enabled ?? false}
              loading={sandboxSaving || sandboxLoading}
              onChange={(checked) =>
                handlePatchSandboxPolicy({ enabled: checked })
              }
            />
          </div>

          <div
            style={{
              margin: "8px 0 6px 20px",
              padding: "10px 12px",
              border: "1px dashed var(--color-border)",
              borderRadius: 8,
              background: "var(--color-bg-section-header)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.sandbox.mode")}
                </span>
                <div className={styles.serviceDescription}>
                  {t("Claw.Settings.sandbox.modeDesc")}
                  <br />
                  {t("Claw.Settings.sandbox.modeRestartHint")}
                </div>
              </div>
              <Select
                size="small"
                style={{ width: 220 }}
                value={sandboxPolicy?.mode ?? "compat"}
                loading={sandboxSaving || sandboxLoading}
                disabled={!sandboxPolicy?.enabled}
                onChange={(value) =>
                  handlePatchSandboxPolicy({
                    mode: value as SandboxPolicy["mode"],
                  })
                }
                options={[
                  {
                    value: "strict",
                    label: t("Claw.Settings.sandbox.modeStrict"),
                  },
                  {
                    value: "compat",
                    label: t("Claw.Settings.sandbox.modeCompat"),
                  },
                  {
                    value: "permissive",
                    label: t("Claw.Settings.sandbox.modePermissive"),
                  },
                ]}
              />
            </div>
          </div>

          {FEATURES.ENABLE_GUI_AGENT_SERVER && (
            <div className={styles.serviceRow} style={{ marginTop: 10 }}>
              <div className={styles.serviceInfo}>
                <div>
                  <span className={styles.serviceLabel}>
                    {t("Claw.Settings.guiMcp.enable")}
                  </span>
                  <div className={styles.serviceDescription}>
                    {guiMcpEnabled === null
                      ? t("Claw.Settings.sandbox.statusNotLoaded")
                      : guiMcpEnabled
                        ? t("Claw.Settings.guiMcp.statusEnabled")
                        : t("Claw.Settings.guiMcp.statusDisabled")}
                  </div>
                </div>
              </div>
              <Switch
                size="small"
                checked={guiMcpEnabled ?? false}
                loading={guiMcpSaving || guiMcpLoading}
                onChange={handleSetGuiMcpEnabled}
              />
            </div>
          )}
        </div>
      </div>

      {/* AI 配置 - 暂时隐藏，当前需求不需要 */}
      {/* <div className="section" style={{ marginTop: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
            AI 配置
          </span>
          {aiEditing ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="small" onClick={handleCancelAiEdit} disabled={aiSaving}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveAiConfig}
                loading={aiSaving}
              >
                保存
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setAiEditing(true)}
            >
              编辑
            </Button>
          )}
        </div>

        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: '#fff',
            padding: 16,
          }}
        >
          <Form form={aiForm} layout="vertical" disabled={!aiEditing} size="small">
            <Form.Item
              name="apiKey"
              label="API Key"
              rules={[{ required: true, message: '请输入 API Key' }]}
            >
              <Input.Password placeholder="sk-ant-..." visibilityToggle />
            </Form.Item>

            <Form.Item
              name="default_model"
              label="默认模型"
              rules={[{ required: true, message: '请选择模型' }]}
            >
              <Select options={MODEL_OPTIONS} placeholder="选择模型" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="max_tokens"
                  label="Max Tokens"
                  rules={[{ required: true, message: '请输入最大 Token 数' }]}
                >
                  <InputNumber min={256} max={200000} step={256} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="temperature"
                  label="温度"
                  rules={[{ required: true, message: '请设置温度' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Slider min={0} max={1} step={0.1} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </div>
      </div> */}

      {/* 系统设置 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <DesktopOutlined
            style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
          />
          <span className={styles.sectionTitle}>
            {t("Claw.Settings.system.title")}
          </span>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          {/* 开机自启动 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.autoLaunch")}
                </span>
                <div className={styles.serviceDescription}>
                  {t("Claw.Settings.system.autoLaunchDesc", {
                    appName: APP_DISPLAY_NAME,
                  })}
                </div>
              </div>
            </div>
            <Switch
              size="small"
              checked={autolaunchEnabled}
              onChange={handleAutolaunchChange}
              loading={autolaunchLoading}
            />
          </div>

          {/* 主题设置 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.theme")}
                </span>
                <div className={styles.serviceDescription}>
                  {t("Claw.Settings.system.themeDesc")}
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={themeMode}
              onChange={(value) => setThemeMode(value)}
              style={{ width: 100 }}
              options={[
                {
                  value: "system",
                  label: t("Claw.Settings.system.themeSystem"),
                },
                { value: "light", label: t("Claw.Settings.system.themeLight") },
                { value: "dark", label: t("Claw.Settings.system.themeDark") },
              ]}
            />
          </div>

          {/* 语言设置 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.language")}
                </span>
                <div className={styles.serviceDescription}>
                  {t("Claw.Settings.system.languageDesc")}
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={i18nLang}
              onChange={handleLanguageChange}
              loading={langChanging}
              style={{ width: 140 }}
              options={
                langList.length > 0
                  ? langList.map((item) => ({
                      value: item.lang.toLowerCase(),
                      label: item.name,
                    }))
                  : LOCAL_LANG_OPTIONS
              }
            />
          </div>

          {/* 应用数据目录 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.appDataDir")}
                </span>
                <div className={styles.serviceDescription}>
                  ~/{APP_DATA_DIR_NAME}
                </div>
              </div>
            </div>
          </div>

          {/* 日志目录 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.logDir")}
                </span>
                <div
                  className={styles.serviceDescription}
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {logDir || t("Claw.Settings.system.loading")}
                </div>
              </div>
            </div>
            <Button size="small" onClick={handleOpenLogDir}>
              {t("Claw.Settings.system.open")}
            </Button>
          </div>

          {/* 工作空间目录 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>
                  {t("Claw.Settings.system.workspaceDir")}
                </span>
                <div
                  className={styles.serviceDescription}
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {workspaceDir || t("Claw.Settings.system.notSet")}
                </div>
              </div>
            </div>
            <Button
              size="small"
              onClick={handleOpenWorkspaceDir}
              disabled={!workspaceDir}
            >
              {t("Claw.Settings.system.open")}
            </Button>
          </div>
        </div>
      </div>

      {/* 开发工具 (仅开发模式) */}
      {IS_DEV && DevToolsPanel && (
        <div className={styles.section}>
          <Suspense fallback={<Spin size="small" />}>
            <DevToolsPanel />
          </Suspense>
        </div>
      )}

      {/* 语言切换确认弹窗 */}
      <Modal
        open={langConfirmModalVisible}
        title={t("Claw.Settings.languageConfirm.title")}
        onCancel={handleLangCancel}
        footer={[
          <Button key="cancel" onClick={handleLangCancel}>
            {t("Claw.Settings.languageConfirm.cancel")}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={langConfirmLoading}
            onClick={handleLangConfirm}
          >
            {t("Claw.Settings.languageConfirm.ok")}
          </Button>,
        ]}
      >
        <p>{t("Claw.Settings.languageConfirm.content")}</p>
      </Modal>
    </div>
  );
}
