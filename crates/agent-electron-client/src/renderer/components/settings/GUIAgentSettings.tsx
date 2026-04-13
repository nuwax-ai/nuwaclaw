/**
 * GUI Agent 设置组件
 *
 * 配置视觉模型、目标显示器、坐标模式等 GUI Agent 参数。
 * 通过 IPC settings API 读写 SQLite 中的 gui_agent_vision_model 配置。
 *
 * 特性:
 * - 区分 Anthropic 协议和 OpenAI 协议
 * - 支持预设提供商 (Anthropic/OpenAI/Google) 和国内提供商 (智谱/通义/DeepSeek/MiniMax)
 * - 支持完全自定义提供商（自定义名称、Base URL、模型 ID）
 * - 坐标模式默认"自动"，根据模型名自动匹配最佳坐标系
 * - UI 字段与 server 端 GuiAgentConfig 一一对应
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  message,
  Spin,
  Row,
  Col,
  Tooltip,
} from "antd";
import {
  SaveOutlined,
  EditOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type {
  GuiVisionModelConfig,
  GuiDisplayInfo,
} from "@shared/types/computerTypes";
import { t } from "../../services/core/i18n";
import { useI18nLang } from "../../App";

const DEFAULT_CONFIG: GuiVisionModelConfig = {
  provider: "anthropic",
  apiProtocol: "anthropic",
  model: "claude-sonnet-4-20250514",
  displayIndex: 0,
  coordinateMode: "auto",
  maxSteps: 50,
  stepDelayMs: 1500,
  jpegQuality: 75,
};

// 预设提供商列表（含协议和默认 Base URL）
interface PresetProvider {
  value: string;
  label: string;
  protocol: "anthropic" | "openai";
  baseUrl?: string;
}

/** 特殊值：用户选择"自定义"时的 Select value */
const CUSTOM_PROVIDER_VALUE = "__custom__";

// 预设模型列表（按提供商分组）
const PRESET_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-5", label: "GPT-5" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro" },
  ],
  zhipu: [
    { value: "glm-4v-plus", label: "GLM-4V Plus" },
    { value: "glm-4v", label: "GLM-4V" },
  ],
  qwen: [
    { value: "qwen-vl-max", label: "Qwen-VL Max" },
    { value: "qwen2.5-vl-72b-instruct", label: "Qwen2.5-VL 72B" },
  ],
  deepseek: [{ value: "deepseek-chat", label: "DeepSeek Chat" }],
  minimax: [{ value: "MiniMax-VL-01", label: "MiniMax-VL-01" }],
};

/**
 * 根据模型名推断坐标模式（镜像 server 端 modelProfiles.ts 的逻辑）
 */
function inferCoordinateMode(modelName: string): string {
  if (/^claude-/i.test(modelName)) return "image-absolute";
  if (/^gpt-(4o|5)/i.test(modelName)) return "image-absolute";
  if (/^gemini/i.test(modelName)) return "normalized-999";
  if (/^ui-tars/i.test(modelName)) return "normalized-1000";
  if (/^qwen(2\.5)?-vl/i.test(modelName)) return "image-absolute";
  if (/^cogagent/i.test(modelName)) return "image-absolute";
  if (/^(seeclick|showui)/i.test(modelName)) return "normalized-0-1";
  if (/^glm-4v/i.test(modelName)) return "image-absolute";
  return "image-absolute"; // fallback
}

interface GUIAgentSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function GUIAgentSettings({ isOpen, onClose }: GUIAgentSettingsProps) {
  const [form] = Form.useForm<GuiVisionModelConfig>();
  const { lang } = useI18nLang();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displays, setDisplays] = useState<GuiDisplayInfo[]>([]);
  const [originalConfig, setOriginalConfig] =
    useState<GuiVisionModelConfig>(DEFAULT_CONFIG);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [customProviderName, setCustomProviderName] = useState("");
  const [selectedModel, setSelectedModel] = useState(
    "claude-sonnet-4-20250514",
  );
  const [selectedCoordinateMode, setSelectedCoordinateMode] = useState("auto");

  // ========== i18n 翻译数组（组件内 useMemo，避免顶层 t() 时序问题） ==========

  const PRESET_PROVIDERS = useMemo<PresetProvider[]>(
    () => [
      { value: "anthropic", label: "Anthropic", protocol: "anthropic" },
      { value: "openai", label: "OpenAI", protocol: "openai" },
      { value: "google", label: "Google", protocol: "openai" },
      {
        value: "zhipu",
        label: t("Claw.GUIAgent.provider.zhipu"),
        protocol: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      },
      {
        value: "qwen",
        label: t("Claw.GUIAgent.provider.qwen"),
        protocol: "openai",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
      {
        value: "deepseek",
        label: "DeepSeek",
        protocol: "openai",
        baseUrl: "https://api.deepseek.com/v1",
      },
      {
        value: "minimax",
        label: "MiniMax",
        protocol: "openai",
        baseUrl: "https://api.minimax.chat/v1",
      },
    ],
    [lang],
  );

  const PROVIDER_SELECT_OPTIONS = useMemo(
    () => [
      ...PRESET_PROVIDERS.map((p) => ({ value: p.value, label: p.label })),
      {
        value: CUSTOM_PROVIDER_VALUE,
        label: t("Claw.GUIAgent.provider.custom"),
      },
    ],
    [PRESET_PROVIDERS],
  );

  const COORDINATE_MODE_OPTIONS = useMemo(
    () => [
      { value: "auto", label: t("Claw.GUIAgent.coordinateMode.auto") },
      {
        value: "image-absolute",
        label: t("Claw.GUIAgent.coordinateMode.imageAbsolute"),
      },
      {
        value: "normalized-1000",
        label: t("Claw.GUIAgent.coordinateMode.normalized1000"),
      },
      {
        value: "normalized-999",
        label: t("Claw.GUIAgent.coordinateMode.normalized999"),
      },
      {
        value: "normalized-0-1",
        label: t("Claw.GUIAgent.coordinateMode.normalized0to1"),
      },
    ],
    [lang],
  );

  const API_PROTOCOL_OPTIONS = useMemo(
    () => [
      { value: "anthropic", label: t("Claw.GUIAgent.protocol.anthropic") },
      { value: "openai", label: t("Claw.GUIAgent.protocol.openai") },
    ],
    [lang],
  );

  const coordinateModeLabel = (mode: string): string => {
    const found = COORDINATE_MODE_OPTIONS.find((o) => o.value === mode);
    return found ? found.label : mode;
  };

  const findPresetProvider = (value: string): PresetProvider | undefined => {
    return PRESET_PROVIDERS.find((p) => p.value === value);
  };

  // ========== 状态 ==========

  // 当前是否处于自定义提供商模式
  const isCustomProvider = useMemo(
    () => selectedProvider === CUSTOM_PROVIDER_VALUE,
    [selectedProvider],
  );

  // 实际的 provider 值（保存到配置中的值）
  const effectiveProvider = useMemo(
    () => (isCustomProvider ? customProviderName : selectedProvider),
    [isCustomProvider, customProviderName, selectedProvider],
  );

  // 当前是否有预设模型列表
  const hasPresetModels = useMemo(
    () =>
      !isCustomProvider && (PRESET_MODELS[selectedProvider]?.length ?? 0) > 0,
    [selectedProvider, isCustomProvider],
  );

  // 当前模型推断出的坐标模式
  const inferredMode = useMemo(
    () => inferCoordinateMode(selectedModel),
    [selectedModel],
  );

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadDisplays();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const saved = (await window.electronAPI?.settings.get(
        "gui_agent_vision_model",
      )) as GuiVisionModelConfig | null;
      const config = { ...DEFAULT_CONFIG, ...saved };
      form.setFieldsValue(config);
      setOriginalConfig(config);
      // 判断保存的 provider 是否是预设提供商
      const isPreset = PRESET_PROVIDERS.some(
        (p) => p.value === config.provider,
      );
      if (isPreset) {
        setSelectedProvider(config.provider);
        setCustomProviderName("");
      } else {
        // 非预设 → 进入自定义模式，恢复自定义名称
        setSelectedProvider(CUSTOM_PROVIDER_VALUE);
        setCustomProviderName(config.provider);
      }
      setSelectedModel(config.model);
      setSelectedCoordinateMode(config.coordinateMode);
    } catch (error) {
      console.error("Failed to load GUI Agent config:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDisplays = async () => {
    try {
      const port =
        (
          (await window.electronAPI?.settings.get("step1_config")) as {
            agentPort?: number;
          } | null
        )?.agentPort || 60001;
      const resp = await fetch(
        `http://127.0.0.1:${port}/computer/gui-agent/displays`,
      );
      const result = await resp.json();
      if (result.success && result.data) {
        setDisplays(result.data);
      }
    } catch {
      setDisplays([
        {
          index: 0,
          label: t("Claw.GUIAgent.display.primary"),
          width: window.screen.width,
          height: window.screen.height,
          scaleFactor: window.devicePixelRatio || 1,
          isPrimary: true,
        },
      ]);
    }
  };

  const handleCancel = () => {
    // resetFields 清除校验错误状态（红框、提示），然后恢复原始值
    form.resetFields();
    form.setFieldsValue(originalConfig);
    const isPreset = PRESET_PROVIDERS.some(
      (p) => p.value === originalConfig.provider,
    );
    if (isPreset) {
      setSelectedProvider(originalConfig.provider);
      setCustomProviderName("");
    } else {
      setSelectedProvider(CUSTOM_PROVIDER_VALUE);
      setCustomProviderName(originalConfig.provider);
    }
    setSelectedModel(originalConfig.model);
    setSelectedCoordinateMode(originalConfig.coordinateMode);
    setEditing(false);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // 自定义模式下，用实际输入的 provider 名称替换 __custom__ 占位值
      if (isCustomProvider) {
        if (!customProviderName.trim()) {
          message.error(t("Claw.GUIAgent.error.customProviderNameRequired"));
          return;
        }
        values.provider = customProviderName.trim();
      }
      setSaving(true);
      try {
        await window.electronAPI?.settings.set(
          "gui_agent_vision_model",
          values,
        );
        setOriginalConfig(values);
        setEditing(false);
        message.success(t("Claw.GUIAgent.message.configSaved"));
      } catch (error) {
        message.error(t("Claw.GUIAgent.message.saveFailed"));
      } finally {
        setSaving(false);
      }
    } catch {
      // form validation failed
    }
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);

    if (provider === CUSTOM_PROVIDER_VALUE) {
      // 自定义模式：清空自定义名称、默认 OpenAI 协议、清空 baseUrl 和模型
      setCustomProviderName("");
      form.setFieldValue("provider", CUSTOM_PROVIDER_VALUE);
      form.setFieldValue("apiProtocol", "openai");
      form.setFieldValue("baseUrl", undefined);
      form.setFieldValue("model", "");
      setSelectedModel("");
      return;
    }

    const preset = findPresetProvider(provider);

    // 自动设置 API 协议
    if (preset) {
      form.setFieldValue("apiProtocol", preset.protocol);
      // 预设 baseUrl 自动填充
      form.setFieldValue("baseUrl", preset.baseUrl || undefined);
    } else {
      // 自定义提供商默认 OpenAI 协议
      form.setFieldValue("apiProtocol", "openai");
      form.setFieldValue("baseUrl", undefined);
    }

    // 预设提供商：自动选择第一个模型
    const models = PRESET_MODELS[provider];
    if (models && models.length > 0) {
      form.setFieldValue("model", models[0].value);
      setSelectedModel(models[0].value);
    } else {
      // 清空模型让用户输入
      form.setFieldValue("model", "");
      setSelectedModel("");
    }
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
  };

  const handleCoordinateModeChange = (mode: string) => {
    setSelectedCoordinateMode(mode);
  };

  if (!isOpen) return null;

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {t("Claw.GUIAgent.title")}
        </span>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="small" onClick={handleCancel} disabled={saving}>
              {t("Claw.Common.cancel")}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              {t("Claw.Common.save")}
            </Button>
          </div>
        ) : (
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditing(true)}
          >
            {t("Claw.Common.edit")}
          </Button>
        )}
      </div>

      <Form form={form} layout="vertical" disabled={!editing} size="small">
        {/* Row 1: 提供商 + API 协议 */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="provider"
              label={t("Claw.GUIAgent.form.provider")}
              rules={[
                {
                  required: true,
                  message: t("Claw.GUIAgent.error.providerRequired"),
                },
              ]}
            >
              <Select
                allowClear={false}
                options={PROVIDER_SELECT_OPTIONS}
                onChange={handleProviderChange}
                placeholder={t("Claw.GUIAgent.placeholder.selectProvider")}
              />
            </Form.Item>
            {/* 自定义模式下显示名称输入框 */}
            {isCustomProvider && (
              <Form.Item
                label={t("Claw.GUIAgent.form.customProviderName")}
                rules={[
                  {
                    required: true,
                    message: t("Claw.GUIAgent.error.providerNameRequired"),
                  },
                ]}
                style={{ marginTop: -8 }}
              >
                <Input
                  value={customProviderName}
                  onChange={(e) => setCustomProviderName(e.target.value)}
                  placeholder={t(
                    "Claw.GUIAgent.placeholder.customProviderName",
                  )}
                />
              </Form.Item>
            )}
          </Col>
          <Col span={12}>
            <Form.Item
              name="apiProtocol"
              label={
                <span>
                  {t("Claw.GUIAgent.form.apiProtocol")}{" "}
                  <Tooltip title={t("Claw.GUIAgent.tooltip.apiProtocol")}>
                    <QuestionCircleOutlined
                      style={{ color: "var(--color-text-tertiary)" }}
                    />
                  </Tooltip>
                </span>
              }
              rules={[{ required: true }]}
            >
              <Select options={API_PROTOCOL_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 2: 模型 + Base URL */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="model"
              label={t("Claw.GUIAgent.form.visionModel")}
              rules={[
                {
                  required: true,
                  message: t("Claw.GUIAgent.error.modelRequired"),
                },
              ]}
            >
              {hasPresetModels ? (
                <Select
                  showSearch
                  options={PRESET_MODELS[selectedProvider] || []}
                  onChange={handleModelChange}
                  placeholder={t("Claw.GUIAgent.placeholder.selectModel")}
                  filterOption={(input, option) =>
                    (option?.label ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase()) ||
                    (option?.value ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                />
              ) : (
                <Input
                  placeholder={t("Claw.GUIAgent.placeholder.modelId")}
                  onChange={(e) => handleModelChange(e.target.value)}
                />
              )}
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="baseUrl"
              label={
                <span>
                  {t("Claw.GUIAgent.form.baseUrl")}{" "}
                  <Tooltip title={t("Claw.GUIAgent.tooltip.baseUrl")}>
                    <QuestionCircleOutlined
                      style={{ color: "var(--color-text-tertiary)" }}
                    />
                  </Tooltip>
                </span>
              }
              rules={
                isCustomProvider
                  ? [
                      {
                        required: true,
                        message: t("Claw.GUIAgent.error.baseUrlRequired"),
                      },
                    ]
                  : []
              }
            >
              <Input placeholder={t("Claw.GUIAgent.placeholder.baseUrl")} />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 3: API Key + 显示器 */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="apiKey" label={t("Claw.GUIAgent.form.apiKey")}>
              <Input.Password
                placeholder={t("Claw.GUIAgent.placeholder.apiKey")}
                visibilityToggle
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="displayIndex"
              label={t("Claw.GUIAgent.form.targetDisplay")}
              rules={[{ required: true }]}
            >
              <Select>
                {displays.map((d) => (
                  <Select.Option key={d.index} value={d.index}>
                    {d.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* Row 4: 坐标模式 */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="coordinateMode"
              label={
                <span>
                  {t("Claw.GUIAgent.form.coordinateMode")}{" "}
                  <Tooltip
                    title={
                      selectedCoordinateMode === "auto"
                        ? t(
                            "Claw.GUIAgent.tooltip.coordinateModeAuto",
                            selectedModel,
                            coordinateModeLabel(inferredMode),
                          )
                        : t("Claw.GUIAgent.tooltip.coordinateModeManual")
                    }
                  >
                    <QuestionCircleOutlined
                      style={{ color: "var(--color-text-tertiary)" }}
                    />
                  </Tooltip>
                </span>
              }
              rules={[{ required: true }]}
            >
              <Select
                options={COORDINATE_MODE_OPTIONS}
                onChange={handleCoordinateModeChange}
              />
            </Form.Item>
          </Col>
          <Col span={12} />
        </Row>

        {/* 自动模式下显示推断结果提示 */}
        {selectedCoordinateMode === "auto" && selectedModel && (
          <div
            style={{
              marginTop: -8,
              marginBottom: 12,
              fontSize: 12,
              color: "var(--color-text-tertiary)",
            }}
          >
            {t("Claw.GUIAgent.display.autoMatch")}:{" "}
            {coordinateModeLabel(inferredMode)}
          </div>
        )}

        {/* Row 5: 数值参数 */}
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="maxSteps" label={t("Claw.GUIAgent.form.maxSteps")}>
              <InputNumber min={1} max={200} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="stepDelayMs"
              label={t("Claw.GUIAgent.form.stepDelay")}
            >
              <InputNumber
                min={100}
                max={30000}
                step={100}
                style={{ width: "100%" }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="jpegQuality"
              label={t("Claw.GUIAgent.form.jpegQuality")}
            >
              <InputNumber min={1} max={100} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {!editing && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "var(--color-text-tertiary)",
          }}
        >
          {t("Claw.GUIAgent.description")}
        </div>
      )}
    </div>
  );
}

export default GUIAgentSettings;
