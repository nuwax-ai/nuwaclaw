/**
 * MCP Proxy 设置组件 - JSON 文本编辑器
 *
 * 使用稳定的文本编辑 + 解析校验，避免第三方可视化编辑器导致的不可编辑问题。
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Button,
  Space,
  Badge,
  Typography,
  Input,
  Segmented,
  List,
  Switch,
  Tag,
  Empty,
  message,
  Alert,
  Spin,
  Modal,
} from "antd";
import {
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ApiOutlined,
  ExportOutlined,
  ImportOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import type {
  McpServersConfig,
  McpProxyStatus,
  McpServerEntry,
} from "@shared/types/electron";
import { t } from "../../services/core/i18n";

const { Text } = Typography;

interface MCPSettingsProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function MCPSettings({ isOpen = true }: MCPSettingsProps) {
  const [isDarkMode, setIsDarkMode] = useState(
    document.body.getAttribute("data-theme") === "dark",
  );
  const [viewMode, setViewMode] = useState<"list" | "json">("list");
  const [configText, setConfigText] = useState("{}");
  const [configTextError, setConfigTextError] = useState<string>("");
  const [status, setStatus] = useState<McpProxyStatus>({ running: false });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [showCreateServerModal, setShowCreateServerModal] = useState(false);
  const [newServerType, setNewServerType] = useState<"stdio" | "remote">(
    "stdio",
  );
  const [newServerId, setNewServerId] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgsText, setNewServerArgsText] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");

  // 监听主题变化
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.body.getAttribute("data-theme") === "dark");
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  const formatConfigForEditor = useCallback(
    (value: McpServersConfig): string => {
      return JSON.stringify(value, null, 2);
    },
    [],
  );

  const normalizeServerEntry = useCallback(
    (entry: McpServerEntry, defaultEnabled: boolean): McpServerEntry => {
      return {
        ...entry,
        // 手动启用策略：缺省 enabled 时按 false 处理，必须手动打开才生效。
        enabled: entry.enabled === undefined ? defaultEnabled : entry.enabled,
      };
    },
    [],
  );

  const normalizeConfig = useCallback(
    (config: McpServersConfig, defaultEnabled: boolean): McpServersConfig => {
      const normalizedServers: Record<string, McpServerEntry> = {};
      const sourceServers =
        config && typeof config.mcpServers === "object" && config.mcpServers
          ? config.mcpServers
          : {};
      for (const [serverId, entry] of Object.entries(sourceServers)) {
        if (!entry || typeof entry !== "object") continue;
        normalizedServers[serverId] = normalizeServerEntry(
          entry,
          defaultEnabled,
        );
      }
      return {
        ...config,
        mcpServers: normalizedServers,
      };
    },
    [normalizeServerEntry],
  );

  const applyConfigToEditor = useCallback(
    (config: McpServersConfig, defaultEnabled: boolean) => {
      const normalized = normalizeConfig(config, defaultEnabled);
      setConfigText(formatConfigForEditor(normalized));
      setConfigTextError("");
    },
    [formatConfigForEditor, normalizeConfig],
  );

  const parseConfigText = (
    text: string,
  ): { ok: true; value: McpServersConfig } | { ok: false; error: string } => {
    try {
      const parsed = JSON.parse(text) as McpServersConfig;
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, error: t("Claw.MCP.message.invalidJson") };
      }
      return { ok: true, value: parsed };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  };

  // 将文本编辑区解析为配置对象并可选地写回格式化文本。
  // 这样可以保证：1) 编辑时有明确报错；2) 保存前结构一定是有效 JSON。
  const syncConfigFromText = (
    formatText = false,
    defaultEnabled = false,
    setErrorState = true,
  ): McpServersConfig | null => {
    const parsed = parseConfigText(configText);
    if (!parsed.ok) {
      if (setErrorState) {
        setConfigTextError(parsed.error);
      }
      return null;
    }
    const normalized = normalizeConfig(parsed.value, defaultEnabled);
    if (setErrorState) {
      setConfigTextError("");
    }
    if (formatText) {
      setConfigText(formatConfigForEditor(normalized));
    }
    return normalized;
  };

  const getCurrentConfigForUi = (): McpServersConfig | null => {
    // UI 渲染阶段仅做无副作用解析，避免在 render 期间触发 setState。
    return syncConfigFromText(false, false, false);
  };

  const updateConfigFromUi = (nextConfig: McpServersConfig) => {
    applyConfigToEditor(nextConfig, false);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [savedConfig, currentStatus] = await Promise.all([
        window.electronAPI?.mcp.getConfig(),
        window.electronAPI?.mcp.status(),
      ]);
      if (savedConfig) {
        // 加载时即按“手动启用”策略规范化，便于列表模式直观管理开关状态。
        applyConfigToEditor(savedConfig, false);
      }
      if (currentStatus) setStatus(currentStatus);
    } catch (error) {
      console.error("[MCPSettings] Failed to load:", error);
    } finally {
      setLoading(false);
    }
  }, [applyConfigToEditor]);

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [isOpen, loadAll]);

  const refreshStatus = async () => {
    try {
      const currentStatus = await window.electronAPI?.mcp.status();
      if (currentStatus) setStatus(currentStatus);
    } catch {
      // 状态刷新失败不打断主流程，保持当前 UI 状态。
    }
  };

  const handleSaveConfig = async () => {
    const nextConfig = syncConfigFromText(true, false);
    if (!nextConfig) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    try {
      await window.electronAPI?.mcp.setConfig(nextConfig);
      message.success(t("Claw.MCP.message.configSaved"));
    } catch {
      message.error(t("Claw.Common.saveFailed"));
    }
  };

  const handleStart = async () => {
    const nextConfig = syncConfigFromText(true, false);
    if (!nextConfig) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    setActionLoading(true);
    try {
      await window.electronAPI?.mcp.setConfig(nextConfig);
      const result = await window.electronAPI?.mcp.start();
      if (result?.success) {
        message.success(t("Claw.MCP.message.proxyReady"));
      } else {
        message.error(t("Claw.MCP.message.checkFailed", { 0: result?.error }));
      }
    } catch (error) {
      message.error(t("Claw.MCP.message.error", { 0: error }));
    } finally {
      await refreshStatus();
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    const nextConfig = syncConfigFromText(true, false);
    if (!nextConfig) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    setActionLoading(true);
    try {
      await window.electronAPI?.mcp.setConfig(nextConfig);
      const result = await window.electronAPI?.mcp.restart();
      if (result?.success) {
        message.success(t("Claw.MCP.message.proxyReady"));
      } else {
        message.error(t("Claw.MCP.message.checkFailed", { 0: result?.error }));
      }
    } catch (error) {
      message.error(t("Claw.MCP.message.error", { 0: error }));
    } finally {
      await refreshStatus();
      setActionLoading(false);
    }
  };

  const handleExportConfirm = async () => {
    try {
      const result = await window.electronAPI?.mcp.exportConfig();
      if (result?.success) {
        message.success(t("Claw.MCP.importExport.exportSuccess"));
      }
    } catch {
      message.error(t("Claw.MCP.importExport.exportFailed"));
    } finally {
      setShowExportWarning(false);
    }
  };

  const handleExport = () => {
    setShowExportWarning(true);
  };

  const handleImport = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const text = event.target?.result as string;
            const imported = JSON.parse(text);
            applyConfigToEditor(imported, false);
            message.success(t("Claw.MCP.importExport.importSuccess"));
          } catch {
            message.error(t("Claw.MCP.importExport.importFailed"));
          }
        };
        reader.readAsText(file);
      };
      input.click();
    } catch {
      message.error(t("Claw.MCP.importExport.importFailed"));
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  const currentConfig = getCurrentConfigForUi();
  const currentServers = currentConfig?.mcpServers ?? {};
  const serverEntries = Object.entries(currentServers);
  const enabledCount = serverEntries.filter(
    ([, entry]) => !!entry.enabled,
  ).length;

  const handleToggleServerEnabled = (serverId: string, enabled: boolean) => {
    const latest = getCurrentConfigForUi();
    if (!latest) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    const target = latest.mcpServers[serverId];
    if (!target) return;
    const nextConfig: McpServersConfig = {
      ...latest,
      mcpServers: {
        ...latest.mcpServers,
        [serverId]: {
          ...target,
          enabled,
        },
      },
    };
    updateConfigFromUi(nextConfig);
  };

  const handleDisableAllServers = () => {
    const latest = getCurrentConfigForUi();
    if (!latest) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    const nextServers: Record<string, McpServerEntry> = {};
    for (const [serverId, entry] of Object.entries(latest.mcpServers)) {
      nextServers[serverId] = { ...entry, enabled: false };
    }
    updateConfigFromUi({ ...latest, mcpServers: nextServers });
    message.success(t("Claw.MCP.list.disableAllSuccess"));
  };

  const resetCreateServerForm = () => {
    setNewServerType("stdio");
    setNewServerId("");
    setNewServerCommand("");
    setNewServerArgsText("");
    setNewServerUrl("");
  };

  const parseArgsText = (
    input: string,
  ): { ok: true; args: string[] } | { ok: false; error: string } => {
    const raw = input.trim();
    if (!raw) return { ok: true, args: [] };

    // 优先支持 JSON 数组，避免空格/逗号参数被错误拆分。
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item === "string")
        ) {
          return { ok: true, args: parsed };
        }
        return { ok: false, error: t("Claw.MCP.addServer.argsInvalid") };
      } catch {
        return { ok: false, error: t("Claw.MCP.addServer.argsInvalid") };
      }
    }

    // 回退到类 shell 分词：支持单/双引号包裹，减少参数被错误拆分。
    const tokens: string[] = [];
    const tokenPattern =
      /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    let matchedAny = false;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(raw)) !== null) {
      matchedAny = true;
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      tokens.push(value.replace(/\\(["'])/g, "$1"));
    }
    if (!matchedAny) {
      return { ok: false, error: t("Claw.MCP.addServer.argsInvalid") };
    }
    return { ok: true, args: tokens };
  };

  const handleCreateServer = () => {
    const latest = getCurrentConfigForUi();
    if (!latest) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    const serverId = newServerId.trim();
    if (!serverId) {
      message.error(t("Claw.MCP.addServer.idRequired"));
      return;
    }
    if (latest.mcpServers[serverId]) {
      message.error(t("Claw.MCP.addServer.idDuplicate"));
      return;
    }

    let newEntry: McpServerEntry;
    if (newServerType === "stdio") {
      const command = newServerCommand.trim();
      if (!command) {
        message.error(t("Claw.MCP.addServer.commandRequired"));
        return;
      }
      const argsParsed = parseArgsText(newServerArgsText);
      if (!argsParsed.ok) {
        message.error(argsParsed.error);
        return;
      }
      newEntry = {
        command,
        args: argsParsed.args,
        enabled: false,
      };
    } else {
      const url = newServerUrl.trim();
      if (!url) {
        message.error(t("Claw.MCP.addServer.urlRequired"));
        return;
      }
      newEntry = {
        url,
        transport: "streamable-http",
        enabled: false,
      };
    }

    const nextConfig: McpServersConfig = {
      ...latest,
      mcpServers: {
        ...latest.mcpServers,
        [serverId]: newEntry,
      },
    };
    updateConfigFromUi(nextConfig);
    setShowCreateServerModal(false);
    resetCreateServerForm();
    message.success(t("Claw.MCP.addServer.addSuccess"));
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>{t("Claw.MCP.title")}</span>
            <Badge
              status={status.running ? "success" : "default"}
              text={
                status.running
                  ? t("Claw.MCP.status.running")
                  : t("Claw.MCP.status.stopped")
              }
            />
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ImportOutlined />}
              onClick={handleImport}
              size="small"
            >
              {t("Claw.MCP.importExport.import")}
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={handleExport}
              size="small"
            >
              {t("Claw.MCP.importExport.export")}
            </Button>
            <Button
              icon={<SaveOutlined />}
              onClick={handleSaveConfig}
              type="primary"
              size="small"
            >
              {t("Claw.Common.save")}
            </Button>
            {status.running ? (
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRestart}
                loading={actionLoading}
                size="small"
              >
                {t("Claw.MCP.action.restart")}
              </Button>
            ) : (
              <Button
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                loading={actionLoading}
                size="small"
              >
                {t("Claw.MCP.action.start")}
              </Button>
            )}
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Alert
            message={t("Claw.MCP.editor.title")}
            description={t("Claw.MCP.editor.description")}
            type="info"
            showIcon
          />

          <div>
            <Space
              style={{ width: "100%", justifyContent: "space-between" }}
              wrap
            >
              <Segmented
                value={viewMode}
                onChange={(val) => setViewMode(val as "list" | "json")}
                options={[
                  { label: t("Claw.MCP.view.list"), value: "list" },
                  { label: t("Claw.MCP.view.json"), value: "json" },
                ]}
              />
              <Text type="secondary">
                {t("Claw.MCP.list.enabledSummary", {
                  0: enabledCount,
                  1: serverEntries.length,
                })}
              </Text>
            </Space>
          </div>

          {viewMode === "list" ? (
            <div>
              <Space
                style={{
                  width: "100%",
                  marginBottom: 8,
                  justifyContent: "space-between",
                }}
                wrap
              >
                <Text strong style={{ display: "block" }}>
                  {t("Claw.MCP.list.title")}
                </Text>
                <Space>
                  <Button size="small" onClick={handleDisableAllServers}>
                    {t("Claw.MCP.list.disableAll")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => setShowCreateServerModal(true)}
                  >
                    {t("Claw.MCP.list.addServer")}
                  </Button>
                </Space>
              </Space>
              <div
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 4,
                  backgroundColor: "var(--color-bg-container, #fff)",
                }}
              >
                {serverEntries.length === 0 ? (
                  <div style={{ padding: 24 }}>
                    <Empty
                      description={t("Claw.MCP.serverManagement.noServers")}
                    />
                  </div>
                ) : (
                  <List
                    dataSource={serverEntries}
                    renderItem={([serverId, entry]) => {
                      const isStdio = "command" in entry;
                      const summary = isStdio
                        ? `${entry.command} ${(entry.args ?? []).join(" ")}`
                        : entry.url;
                      return (
                        <List.Item
                          actions={[
                            <Switch
                              key="enabled"
                              checked={!!entry.enabled}
                              checkedChildren={t("Claw.MCP.switch.enable")}
                              unCheckedChildren={t("Claw.MCP.switch.disable")}
                              onChange={(checked) =>
                                handleToggleServerEnabled(serverId, checked)
                              }
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <Text strong>{serverId}</Text>
                                <Tag color={isStdio ? "blue" : "purple"}>
                                  {isStdio ? "stdio" : "remote"}
                                </Tag>
                              </Space>
                            }
                            description={
                              <Text
                                type="secondary"
                                style={{
                                  display: "inline-block",
                                  maxWidth: 680,
                                }}
                                ellipsis={{ tooltip: summary }}
                              >
                                {summary}
                              </Text>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div>
              <Text strong style={{ marginBottom: 8, display: "block" }}>
                {t("Claw.MCP.editor.config")}
              </Text>
              <div
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <Editor
                  height="400px"
                  language="json"
                  theme={isDarkMode ? "vs-dark" : "vs"}
                  value={configText}
                  onChange={(value) => {
                    setConfigText(value || "");
                    if (configTextError) {
                      setConfigTextError("");
                    }
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    formatOnPaste: true,
                    formatOnType: true,
                  }}
                />
              </div>
              {configTextError ? (
                <Text type="danger" style={{ marginTop: 8, display: "block" }}>
                  {configTextError}
                </Text>
              ) : null}
              <div style={{ marginTop: 8 }}>
                <Button
                  size="small"
                  onClick={() => {
                    const parsed = syncConfigFromText(true, false);
                    if (!parsed) {
                      message.error(t("Claw.MCP.message.invalidJson"));
                    }
                  }}
                >
                  {t("Claw.MCP.editor.format")}
                </Button>
              </div>
            </div>
          )}

          <Alert
            message={t("Claw.MCP.editor.exampleTitle")}
            description={
              <pre
                style={{
                  margin: 0,
                  fontFamily: "Monaco, Menlo, 'Courier New', monospace",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {`{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/files"],
      "enabled": true
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
      },
      "enabled": true
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
      "enabled": false
    }
  }
}`}
              </pre>
            }
            type="success"
          />
        </Space>
      </Card>

      {/* 导出警告 Modal */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: "#faad14" }} />
            {t("Claw.MCP.importExport.exportWarningTitle")}
          </Space>
        }
        open={showExportWarning}
        onOk={handleExportConfirm}
        onCancel={() => setShowExportWarning(false)}
        okText={t("Claw.Common.confirm")}
        cancelText={t("Claw.Common.cancel")}
      >
        <Alert
          message={t("Claw.MCP.importExport.exportWarningContent")}
          type="warning"
          showIcon
        />
      </Modal>

      <Modal
        title={t("Claw.MCP.addServer.modalTitle")}
        open={showCreateServerModal}
        onOk={handleCreateServer}
        onCancel={() => {
          setShowCreateServerModal(false);
          resetCreateServerForm();
        }}
        okText={t("Claw.MCP.addServer.add")}
        cancelText={t("Claw.Common.cancel")}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text style={{ display: "block", marginBottom: 6 }}>
              {t("Claw.MCP.addServer.type")}
            </Text>
            <Segmented
              value={newServerType}
              options={[
                { label: "stdio", value: "stdio" },
                { label: "remote", value: "remote" },
              ]}
              onChange={(val) => setNewServerType(val as "stdio" | "remote")}
            />
          </div>

          <div>
            <Text style={{ display: "block", marginBottom: 6 }}>
              {t("Claw.MCP.addServer.serverId")}
            </Text>
            <Input
              value={newServerId}
              onChange={(e) => setNewServerId(e.target.value)}
              placeholder={t("Claw.MCP.addServer.idPlaceholder")}
            />
          </div>

          {newServerType === "stdio" ? (
            <>
              <div>
                <Text style={{ display: "block", marginBottom: 6 }}>
                  Command
                </Text>
                <Input
                  value={newServerCommand}
                  onChange={(e) => setNewServerCommand(e.target.value)}
                  placeholder={t("Claw.MCP.addServer.commandPlaceholder")}
                />
              </div>
              <div>
                <Text style={{ display: "block", marginBottom: 6 }}>Args</Text>
                <Input.TextArea
                  value={newServerArgsText}
                  onChange={(e) => setNewServerArgsText(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder={t("Claw.MCP.addServer.argsPlaceholderAdvanced")}
                />
              </div>
            </>
          ) : (
            <div>
              <Text style={{ display: "block", marginBottom: 6 }}>URL</Text>
              <Input
                value={newServerUrl}
                onChange={(e) => setNewServerUrl(e.target.value)}
                placeholder={t("Claw.MCP.addServer.urlPlaceholder")}
              />
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}

export default MCPSettings;
