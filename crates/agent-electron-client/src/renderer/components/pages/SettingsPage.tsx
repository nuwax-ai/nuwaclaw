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
  SafetyCertificateOutlined,
  ReloadOutlined,
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
  MSG_SUCCESS,
  MSG_ERROR,
} from "@shared/constants";
import styles from "../../styles/components/ClientPage.module.css";
import { useTheme, type ThemeMode } from "../../App";
import type {
  SandboxBackend,
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

const SANDBOX_BACKEND_OPTIONS: Array<{
  value: SandboxBackend;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  { value: "docker", label: "Docker" },
  { value: "macos-seatbelt", label: "macOS sandbox-exec" },
  { value: "linux-bwrap", label: "Linux bubblewrap" },
  { value: "windows-sandbox", label: "Windows Sandbox" },
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
  // 使用表单中的 workspaceDir 作为“系统模块”的展示源，确保编辑保存后展示保持实时一致。
  const workspaceDir = Form.useWatch("workspaceDir", form) || "";

  // ========== 加载服务配置 ==========
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const config = await setupService.getStep1Config();
      form.setFieldsValue(config);
      setOriginalConfig(config);
    } catch (error) {
      console.error("加载配置失败:", error);
      message.error(MSG_ERROR.LOAD_FAILED);
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
      console.error("加载 AI 配置失败:", error);
    }
  }, [aiForm]);

  // ========== 加载系统设置 ==========
  const loadSystemSettings = useCallback(async () => {
    try {
      const enabled = await window.electronAPI?.autolaunch?.get();
      setAutolaunchEnabled(enabled ?? false);
    } catch (error) {
      console.error("加载自启动状态失败:", error);
    }
    try {
      const dir = await window.electronAPI?.log?.getDir();
      setLogDir(dir || "");
    } catch (error) {
      console.error("加载日志目录失败:", error);
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
      console.error("加载沙箱配置失败:", error);
    } finally {
      setSandboxLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadAiConfig();
    loadSystemSettings();
    loadSandboxState();

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

  // ========== 服务配置操作 ==========
  const handleSelectWorkspace = async () => {
    const result =
      await window.electronAPI?.dialog.openDirectory("选择工作区目录");
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
        title: "保存配置",
        content: "保存后需要重启服务才能生效，确定保存吗？",
        okText: "保存",
        cancelText: "取消",
        onOk: async () => {
          setSaving(true);
          try {
            const existing = await setupService.getStep1Config();
            await setupService.saveStep1Config({ ...existing, ...values });
            setOriginalConfig(values);
            setEditing(false);
            message.success(MSG_SUCCESS.CONFIG_SAVED);
          } catch (error) {
            message.error(MSG_ERROR.CONFIG_SAVE_FAILED);
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
        message.success(MSG_SUCCESS.AI_CONFIG_SAVED);
      } catch (error) {
        message.error(MSG_ERROR.AI_CONFIG_SAVE_FAILED);
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
        message.success(enabled ? "已开启开机自启动" : "已关闭开机自启动");
      } else {
        message.error(result?.error || "设置失败");
      }
    } catch (error) {
      message.error(MSG_ERROR.OPEN_SETTINGS_FAILED);
    } finally {
      setAutolaunchLoading(false);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      await window.electronAPI?.log?.openDir();
    } catch {
      message.error(MSG_ERROR.OPEN_LOGS_FAILED);
    }
  };

  const handleOpenWorkspaceDir = async () => {
    // 没有有效目录时直接提示，避免触发无意义 IPC 调用。
    if (!workspaceDir) {
      message.warning("未配置工作空间目录");
      return;
    }
    try {
      const result = await window.electronAPI?.shell?.openPath(workspaceDir);
      if (!result?.success) {
        message.error(result?.error || "打开工作空间目录失败");
      }
    } catch {
      message.error("打开工作空间目录失败");
    }
  };

  const handlePatchSandboxPolicy = async (patch: Partial<SandboxPolicy>) => {
    if (!window.electronAPI?.sandbox) return;
    setSandboxSaving(true);
    try {
      const result = await window.electronAPI.sandbox.setPolicy(patch);
      if (result?.success && result.data) {
        setSandboxPolicy(result.data);
        message.success("沙箱策略已更新");
        await loadSandboxState();
      } else {
        message.error(result?.error || "更新沙箱策略失败");
      }
    } catch (error) {
      message.error("更新沙箱策略失败");
    } finally {
      setSandboxSaving(false);
    }
  };

  const handleWindowsSetup = async () => {
    if (!window.electronAPI?.sandbox || !sandboxPolicy) return;
    setSandboxSaving(true);
    try {
      const result = await window.electronAPI.sandbox.setup({
        windows: {
          sandbox: { mode: sandboxPolicy.windows.sandbox.mode },
        },
      });
      if (result?.success && result.data?.success) {
        message.success(result.data.message || "Windows Sandbox setup 完成");
      } else {
        message.error(result?.data?.message || result?.error || "setup 失败");
      }
      await loadSandboxState();
    } catch (error) {
      message.error("Windows Sandbox setup 失败");
    } finally {
      setSandboxSaving(false);
    }
  };

  const winSandboxCap = sandboxCapabilities?.windowsSandbox;
  const windowsHelperReady = winSandboxCap?.available === true;
  const windowsSetupTooltip = windowsHelperReady
    ? ""
    : [
        winSandboxCap?.reason || "helper 未就绪",
        "请先接入 agent-sandbox-runtime 并在 agent-electron-client 下执行 npm run prepare:sandbox-runtime",
        "将 codex-sandbox-helper.exe 置于 resources/sandbox-runtime/bin/",
      ].join("；");

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
            <span className={styles.sectionTitle}>服务配置</span>
          </div>
          {editing ? (
            <div className={styles.servicesHeaderActions}>
              <Button size="small" onClick={handleCancelEdit} disabled={saving}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(true)}
            >
              编辑
            </Button>
          )}
        </div>
        <div className={styles.sectionBody}>
          <Form form={form} layout="vertical" disabled={!editing} size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="fileServerPort"
                  label="文件服务端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="agentPort"
                  label="Agent 端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="guiMcpPort"
                  label="GUI MCP 端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="adminServerPort"
                  label="管理服务端口"
                  rules={[{ required: false, message: "请输入端口" }]}
                  extra="默认 60007，用于重启服务等管理接口"
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="workspaceDir"
              label="工作区目录"
              rules={[{ required: true, message: "请选择工作区目录" }]}
              style={{ marginBottom: 0 }}
            >
              <Input
                placeholder="点击选择目录"
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
                      选择
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
              修改配置后需要重启服务才能生效
            </div>
          )}
        </div>
      </div>

      {/* 沙箱策略 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <SafetyCertificateOutlined
            style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
          />
          <span className={styles.sectionTitle}>沙箱</span>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>启用沙箱</span>
                <div className={styles.serviceDescription}>
                  关闭后命令将直接在工作区执行
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

          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>策略模式</span>
                <div className={styles.serviceDescription}>
                  off / non-main / all
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={sandboxPolicy?.mode || "non-main"}
              style={{ width: 140 }}
              disabled={sandboxSaving || sandboxLoading}
              onChange={(value) =>
                handlePatchSandboxPolicy({
                  mode: value as SandboxPolicy["mode"],
                })
              }
              options={[
                { value: "off", label: "off" },
                { value: "non-main", label: "non-main" },
                { value: "all", label: "all" },
              ]}
            />
          </div>

          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>后端</span>
                <div className={styles.serviceDescription}>
                  当前平台推荐:{" "}
                  {sandboxCapabilities?.recommendedBackend || "unknown"}
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={sandboxPolicy?.backend || "auto"}
              style={{ width: 220 }}
              disabled={sandboxSaving || sandboxLoading}
              onChange={(value) =>
                handlePatchSandboxPolicy({
                  backend: value as SandboxBackend,
                })
              }
              options={SANDBOX_BACKEND_OPTIONS}
            />
          </div>

          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>不可用时策略</span>
                <div className={styles.serviceDescription}>
                  degrade_to_off / fail_closed
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={sandboxPolicy?.fallback || "degrade_to_off"}
              style={{ width: 180 }}
              disabled={sandboxSaving || sandboxLoading}
              onChange={(value) =>
                handlePatchSandboxPolicy({
                  fallback: value as SandboxPolicy["fallback"],
                })
              }
              options={[
                { value: "degrade_to_off", label: "degrade_to_off" },
                { value: "fail_closed", label: "fail_closed" },
              ]}
            />
          </div>

          {sandboxCapabilities?.platform === "win32" && sandboxPolicy && (
            <>
              <div className={styles.serviceRow}>
                <div className={styles.serviceInfo}>
                  <div>
                    <span className={styles.serviceLabel}>Sandbox 模式</span>
                    <div className={styles.serviceDescription}>
                      Windows 默认 read-only
                    </div>
                  </div>
                </div>
                <Select
                  size="small"
                  value={sandboxPolicy.windows.sandbox.mode}
                  style={{ width: 150 }}
                  disabled={sandboxSaving || sandboxLoading}
                  onChange={(value) =>
                    handlePatchSandboxPolicy({
                      windows: {
                        sandbox: {
                          ...sandboxPolicy.windows.sandbox,
                          mode: value as SandboxPolicy["windows"]["sandbox"]["mode"],
                        },
                      },
                    })
                  }
                  options={[
                    { value: "read-only", label: "read-only" },
                    { value: "workspace-write", label: "workspace-write" },
                  ]}
                />
              </div>
              <div className={styles.serviceRow}>
                <div className={styles.serviceInfo}>
                  <div>
                    <span className={styles.serviceLabel}>Windows Setup</span>
                    <div className={styles.serviceDescription}>
                      校验 Sandbox helper 是否已随运行时接入
                    </div>
                  </div>
                </div>
                <Tooltip
                  title={
                    windowsHelperReady
                      ? undefined
                      : windowsSetupTooltip || undefined
                  }
                >
                  <span>
                    <Button
                      size="small"
                      onClick={handleWindowsSetup}
                      loading={sandboxSaving}
                      disabled={
                        sandboxSaving || sandboxLoading || !windowsHelperReady
                      }
                    >
                      执行 setup
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </>
          )}

          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>状态</span>
                <div className={styles.serviceDescription}>
                  {sandboxStatus
                    ? (() => {
                        const { type, available, degraded, reason } =
                          sandboxStatus;
                        const isolation = degraded
                          ? "沙箱隔离未生效（已按策略降级）"
                          : available
                            ? "沙箱隔离可用"
                            : "沙箱隔离不可用";
                        return `后端 ${type} · ${isolation}${
                          reason ? ` · ${reason}` : ""
                        }`;
                      })()
                    : "未加载"}
                </div>
              </div>
            </div>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadSandboxState}
              loading={sandboxLoading}
            >
              刷新
            </Button>
          </div>
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
          <span className={styles.sectionTitle}>系统</span>
        </div>
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          {/* 开机自启动 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>开机自启动</span>
                <div className={styles.serviceDescription}>
                  系统启动时自动运行 {APP_DISPLAY_NAME}
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
                <span className={styles.serviceLabel}>主题</span>
                <div className={styles.serviceDescription}>
                  选择界面配色方案
                </div>
              </div>
            </div>
            <Select
              size="small"
              value={themeMode}
              onChange={(value) => setThemeMode(value)}
              style={{ width: 100 }}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "亮色" },
                { value: "dark", label: "暗色" },
              ]}
            />
          </div>

          {/* 应用数据目录 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>应用数据目录</span>
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
                <span className={styles.serviceLabel}>日志目录</span>
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
                  {logDir || "加载中..."}
                </div>
              </div>
            </div>
            <Button size="small" onClick={handleOpenLogDir}>
              打开
            </Button>
          </div>

          {/* 工作空间目录 */}
          <div className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <div>
                <span className={styles.serviceLabel}>工作空间目录</span>
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
                  {workspaceDir || "未设置"}
                </div>
              </div>
            </div>
            <Button
              size="small"
              onClick={handleOpenWorkspaceDir}
              disabled={!workspaceDir}
            >
              打开
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
    </div>
  );
}
