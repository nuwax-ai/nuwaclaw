import React, { useState, useEffect } from "react";
import {
  Card,
  Input,
  Select,
  Button,
  Space,
  Divider,
  Typography,
  Badge,
  Form,
  message,
  Spin,
} from "antd";
import {
  CloudServerOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { DEFAULT_ANTHROPIC_API_URL, DEFAULT_AI_MODEL } from "@shared/constants";
import { t } from "../../services/core/i18n";

const { Title, Text } = Typography;

const OLLAMA_DEFAULT_BASE = "http://localhost:11434/v1";
const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";

type ProviderPreset = "anthropic" | "openai" | "ollama" | "custom";

interface AgentSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function AgentSettings({ isOpen, onClose }: AgentSettingsProps) {
  const [agentType, setAgentType] = useState("claude-code");
  const [binPath, setBinPath] = useState("claude");
  const [backendPort, setBackendPort] = useState(60001);
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_ANTHROPIC_API_URL);
  const [apiProtocol, setApiProtocol] = useState<ProviderPreset>("anthropic");
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  // Ollama — 自动发现的本地模型列表
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaDiscovering, setOllamaDiscovering] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkStatus();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const saved = await window.electronAPI?.settings.get("agent_config");
      if (saved) {
        const config = saved as any;
        setAgentType(config.type || "claude-code");
        setBinPath(config.binPath || "claude");
        setBackendPort(config.backendPort || 60001);
        setApiKey(config.apiKey || "");
        setApiBaseUrl(config.apiBaseUrl || DEFAULT_ANTHROPIC_API_URL);
        setApiProtocol(config.apiProtocol || "anthropic");
        setModel(config.model || DEFAULT_AI_MODEL);
      }
    } catch (error) {
      console.error(t("Claw.Agent.loadConfigFailed"), error);
    }
  };

  const checkStatus = async () => {
    try {
      const status = await window.electronAPI?.agent.serviceStatus();
      setRunning(status?.running || false);
    } catch (error) {
      console.error(t("Claw.Agent.checkStatusFailed"), error);
    }
  };

  const handleSave = async () => {
    const config = {
      type: agentType,
      binPath,
      backendPort,
      apiKey,
      apiBaseUrl,
      apiProtocol,
      model,
    };
    await window.electronAPI?.settings.set("agent_config", config);
    message.success(t("Claw.Agent.configSaved"));
  };

  const handleStartStop = async () => {
    setLoading(true);
    try {
      if (running) {
        await window.electronAPI?.agent.destroy();
        message.success(t("Claw.Agent.stopped"));
      } else {
        const step1 = (await window.electronAPI?.settings.get(
          "step1_config",
        )) as { workspaceDir?: string } | null;
        const result = await window.electronAPI?.agent.init({
          engine: agentType === "claude-code" ? "claude-code" : "nuwaxcode",
          apiKey,
          baseUrl: apiBaseUrl,
          model,
          workspaceDir: step1?.workspaceDir || "",
          port: backendPort,
          engineBinaryPath: binPath || undefined,
        });
        if (result?.success) {
          message.success(t("Claw.Agent.started"));
        } else {
          message.error(
            t("Claw.Agent.startFailedWithReason", {
              reason: result?.error ?? "",
            }),
          );
        }
      }
    } catch (error) {
      message.error(
        t("Claw.Agent.operationError", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await checkStatus();
    setLoading(false);
  };

  /**
   * T1.5 — Ollama 本地模型自动发现
   * 调用 GET http://localhost:11434/api/tags 获取已安装的模型列表
   */
  const discoverOllamaModels = async () => {
    setOllamaDiscovering(true);
    try {
      const resp = await fetch(OLLAMA_TAGS_URL, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { models?: { name: string }[] };
      const names = (data.models ?? []).map((m) => m.name);
      if (names.length === 0) {
        message.warning(t("Claw.Agent.ollamaNoModels"));
      } else {
        setOllamaModels(names);
        // 自动选中第一个
        if (!names.includes(model)) setModel(names[0]);
        message.success(t("Claw.Agent.ollamaModelsFound", names.length));
      }
    } catch (e) {
      message.error(t("Claw.Agent.ollamaDiscoverFailed"));
    }
    setOllamaDiscovering(false);
  };

  /** 切换 provider preset 时自动填充 baseUrl / apiProtocol */
  const handleProviderChange = (preset: ProviderPreset) => {
    setApiProtocol(preset);
    if (preset === "anthropic") {
      setApiBaseUrl(DEFAULT_ANTHROPIC_API_URL);
    } else if (preset === "ollama") {
      setApiBaseUrl(OLLAMA_DEFAULT_BASE);
      setApiKey("ollama");
      // 自动发现本地模型
      void discoverOllamaModels();
    } else if (preset === "openai") {
      setApiBaseUrl("https://api.openai.com/v1");
    }
    // custom: 不改 baseUrl，让用户自填
  };

  if (!isOpen) return null;

  const isOllama = apiProtocol === "ollama";
  // 模型选项：Ollama 时用发现的列表，否则用默认列表
  const modelOptions =
    isOllama && ollamaModels.length > 0
      ? ollamaModels
      : [
          "claude-opus-4-20250514",
          "claude-sonnet-4-20250514",
          "claude-haiku-3-20240307",
        ];

  return (
    <Card
      title={
        <Space>
          <CloudServerOutlined />
          {t("Claw.Agent.engineSettings")}
        </Space>
      }
      style={{ margin: 16 }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        {/* Status Panel */}
        <Card size="small" style={{ background: "#f5f5f5" }}>
          <Space>
            <Badge
              status={running ? "success" : "default"}
              text={
                running
                  ? t("Claw.Agent.running")
                  : t("Claw.Agent.stoppedStatus")
              }
            />
            <Button
              type={running ? "default" : "primary"}
              icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
              danger={running}
              onClick={handleStartStop}
              loading={loading}
            >
              {running ? t("Claw.Agent.stop") : t("Claw.Agent.start")}
            </Button>
          </Space>
        </Card>

        <Divider orientation="left">{t("Claw.Agent.engineType")}</Divider>

        <Form layout="vertical">
          <Form.Item label={t("Claw.Agent.type")}>
            <Select
              value={agentType}
              onChange={(v) => {
                setAgentType(v);
                setBinPath(v === "claude-code" ? "claude-code" : "nuwaxcode");
              }}
            >
              <Select.Option value="claude-code">
                <Space>
                  <span>Claude Code (ACP)</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("Claw.Agent.claudeCodeAcpDesc")}
                  </Text>
                </Space>
              </Select.Option>
              <Select.Option value="nuwaxcode">
                <Space>
                  <span>nuwaxcode (ACP)</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("Claw.Agent.nuwaxcodeDesc")}
                  </Text>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Divider orientation="left">{t("Claw.Agent.portConfig")}</Divider>

          <Form.Item label={t("Claw.Agent.backendPort")}>
            <Input
              type="number"
              value={backendPort}
              onChange={(e) => setBackendPort(parseInt(e.target.value))}
              placeholder="60001"
            />
            <Text type="secondary">{t("Claw.Agent.backendPortHint")}</Text>
          </Form.Item>

          <Divider orientation="left">{t("Claw.Agent.apiConfig")}</Divider>

          <Form.Item label={t("Claw.Agent.executablePath")}>
            <Input
              value={binPath}
              onChange={(e) => setBinPath(e.target.value)}
              placeholder={
                agentType === "nuwaxcode" ? "nuwaxcode" : "claude-code-acp-ts"
              }
            />
          </Form.Item>

          {/* T1.5 — Provider preset 选择器 */}
          <Form.Item label={t("Claw.Agent.provider")}>
            <Select value={apiProtocol} onChange={handleProviderChange}>
              <Select.Option value="anthropic">
                Anthropic (Claude)
              </Select.Option>
              <Select.Option value="openai">OpenAI Compatible</Select.Option>
              <Select.Option value="ollama">Ollama (Local LLM)</Select.Option>
              <Select.Option value="custom">
                {t("Claw.Agent.providerCustom")}
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={t("Claw.Agent.apiKey")}>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isOllama ? "ollama" : "sk-ant-..."}
            />
          </Form.Item>

          <Form.Item label={t("Claw.Agent.apiBaseUrl")}>
            <Input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={
                isOllama ? OLLAMA_DEFAULT_BASE : DEFAULT_ANTHROPIC_API_URL
              }
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item label={t("Claw.Agent.model")}>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                value={model}
                onChange={setModel}
                style={{ flex: 1 }}
                showSearch
                options={modelOptions.map((m) => ({ value: m, label: m }))}
              />
              {isOllama && (
                <Button
                  icon={
                    ollamaDiscovering ? (
                      <Spin size="small" />
                    ) : (
                      <SearchOutlined />
                    )
                  }
                  onClick={discoverOllamaModels}
                  disabled={ollamaDiscovering}
                  title={t("Claw.Agent.ollamaDiscover")}
                />
              )}
            </Space.Compact>
            {isOllama && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("Claw.Agent.ollamaHint")}
              </Text>
            )}
          </Form.Item>

          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            {t("Claw.Agent.saveConfig")}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}

export default AgentSettings;
