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
  Switch,
  message,
} from "antd";
import {
  CloudServerOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { DEFAULT_ANTHROPIC_API_URL, DEFAULT_AI_MODEL } from "@shared/constants";
import { aiService } from "../../services/core/ai";
import { t } from "../../services/core/i18n";

const { Title, Text } = Typography;

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
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

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

  if (!isOpen) return null;

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

          <Form.Item label={t("Claw.Agent.apiKey")}>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
          </Form.Item>

          <Form.Item label={t("Claw.Agent.apiBaseUrl")}>
            <Input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={DEFAULT_ANTHROPIC_API_URL}
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item label={t("Claw.Agent.model")}>
            <Select value={model} onChange={setModel}>
              <Select.Option value="claude-opus-4-20250514">
                Claude Opus 4
              </Select.Option>
              <Select.Option value="claude-sonnet-4-20250514">
                Claude Sonnet 4
              </Select.Option>
              <Select.Option value="claude-haiku-3-20240307">
                Claude Haiku 3
              </Select.Option>
            </Select>
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
