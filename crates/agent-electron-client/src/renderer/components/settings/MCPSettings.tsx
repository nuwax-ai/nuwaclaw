/**
 * MCP Proxy 设置组件 - JSON 文本编辑器
 *
 * 使用稳定的文本编辑 + 解析校验，避免第三方可视化编辑器导致的不可编辑问题。
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Button,
  Space,
  Badge,
  Typography,
  Segmented,
  List,
  Switch,
  Tag,
  Tooltip,
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
  CheckCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import CodeEditor from "@uiw/react-textarea-code-editor";
import type {
  McpServersConfig,
  McpProxyStatus,
  McpServerEntry,
} from "@shared/types/electron";
import { isGuiMcpManagedServerId } from "@shared/guiMcp";
import { t } from "../../services/core/i18n";
import MCPServerEditor from "./MCPServerEditor";
import { applyMcpServerDraft } from "./mcpServerEditorUtils";

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
  const [pageMode, setPageMode] = useState<"list" | "editor">("list");
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingServerId, setEditingServerId] = useState("");
  const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
  const [testingServerId, setTestingServerId] = useState<string | null>(null);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  // 上次保存/加载的基线文本：撤销时恢复到此值。仅由 loadAll 与保存成功后更新。
  const [savedConfigText, setSavedConfigText] = useState("{}");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
        // 基线始终刷新为服务端已保存状态（按"手动启用"策略规范化）。
        const text = formatConfigForEditor(normalizeConfig(savedConfig, false));
        setSavedConfigText(text);
        // 编辑器仅在无未保存编辑时覆盖，防止丢失用户正在编辑的内容。
        if (!hasUnsavedEdits) {
          setConfigText(text);
          setConfigTextError("");
        }
      }
      if (currentStatus) setStatus(currentStatus);
    } catch (error) {
      console.error("[MCPSettings] Failed to load:", error);
    } finally {
      setLoading(false);
    }
  }, [formatConfigForEditor, normalizeConfig, hasUnsavedEdits]);

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
      // 用计算出的 canonical 文本捕获基线（syncConfigFromText 已异步重排 configText，
      // 此处闭包内的 configText 仍是旧值，不能直接读）。
      setSavedConfigText(formatConfigForEditor(nextConfig));
      setHasUnsavedEdits(false);
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
      setSavedConfigText(formatConfigForEditor(nextConfig));
      setHasUnsavedEdits(false);
      const result = await window.electronAPI?.mcp.start();
      if (result?.success) {
        message.success(t("Claw.MCP.message.proxyReady"));
      } else {
        message.error(t("Claw.MCP.message.checkFailed", { 0: result?.error }));
      }
    } catch (error) {
      message.error(
        t("Claw.MCP.message.error", {
          0: error instanceof Error ? error.message : String(error),
        }),
      );
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
      setSavedConfigText(formatConfigForEditor(nextConfig));
      setHasUnsavedEdits(false);
      const result = await window.electronAPI?.mcp.restart();
      if (result?.success) {
        message.success(t("Claw.MCP.message.proxyReady"));
      } else {
        message.error(t("Claw.MCP.message.checkFailed", { 0: result?.error }));
      }
    } catch (error) {
      message.error(
        t("Claw.MCP.message.error", {
          0: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      await refreshStatus();
      setActionLoading(false);
    }
  };

  const handleResetConfig = () => {
    // 撤销未保存改动：恢复到上次保存的基线。仅动前端 state，不调用 IPC。
    setConfigText(savedConfigText);
    setConfigTextError("");
    setHasUnsavedEdits(false);
    setPageMode("list"); // 退出单 server 编辑器（如在）
    setShowResetConfirm(false);
    message.info(t("Claw.MCP.message.resetDone"));
  };

  // 精确脏状态：归一化后深比较当前配置与已保存基线。
  // 优于手动标志 hasUnsavedEdits（改动一次即永久 true，改回原样也不会回落）。
  // 解析失败（如 JSON 编辑中途）时回退到标志，保守显示为未保存。
  const isDirty = useMemo(() => {
    let currentObj: unknown;
    let savedObj: unknown;
    try {
      currentObj = JSON.parse(configText);
    } catch {
      return hasUnsavedEdits;
    }
    try {
      savedObj = JSON.parse(savedConfigText);
    } catch {
      return hasUnsavedEdits;
    }
    return (
      JSON.stringify(normalizeConfig(currentObj as McpServersConfig, false)) !==
      JSON.stringify(normalizeConfig(savedObj as McpServersConfig, false))
    );
  }, [configText, savedConfigText, hasUnsavedEdits, normalizeConfig]);

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
            setHasUnsavedEdits(true);
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

  const warnIfGuiManaged = (serverId: string): boolean => {
    if (isGuiMcpManagedServerId(serverId)) {
      message.warning(t("Claw.MCP.list.guiAgentManaged"));
      return true;
    }
    return false;
  };

  const handleToggleServerEnabled = (serverId: string, enabled: boolean) => {
    if (isGuiMcpManagedServerId(serverId) && !enabled) {
      message.warning(t("Claw.MCP.list.guiAgentManaged"));
      return;
    }
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
    setHasUnsavedEdits(true);
  };

  const handleDisableAllServers = () => {
    const latest = getCurrentConfigForUi();
    if (!latest) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    const nextServers: Record<string, McpServerEntry> = {};
    for (const [serverId, entry] of Object.entries(latest.mcpServers)) {
      // gui-agent 由设置页 GUI MCP 开关托管，不参与「全部停用」
      if (isGuiMcpManagedServerId(serverId)) {
        nextServers[serverId] = { ...entry, enabled: true };
        continue;
      }
      nextServers[serverId] = { ...entry, enabled: false };
    }
    updateConfigFromUi({ ...latest, mcpServers: nextServers });
    setHasUnsavedEdits(true);
    message.success(t("Claw.MCP.list.disableAllSuccess"));
  };

  const handleDeleteServer = (serverId: string) => {
    if (warnIfGuiManaged(serverId)) return;
    const latest = getCurrentConfigForUi();
    if (!latest) {
      message.error(t("Claw.MCP.message.invalidJson"));
      return;
    }
    setDeletingServerId(serverId);
    const nextServers = { ...latest.mcpServers };
    delete nextServers[serverId];
    updateConfigFromUi({ ...latest, mcpServers: nextServers });
    setHasUnsavedEdits(true);
    message.success(t("Claw.MCP.message.serverRemoved"));
    setDeletingServerId(null);
  };

  const handleTestServer = async (serverId: string) => {
    if (testingServerId) return;
    setTestingServerId(serverId);
    try {
      const latest = getCurrentConfigForUi();
      const result = await window.electronAPI?.mcp.discoverTools(
        serverId,
        latest ?? undefined,
      );
      if (result?.success) {
        const toolCount = result.tools?.length ?? 0;
        message.success(t("Claw.MCP.list.testSuccess", { 0: toolCount }));
      } else {
        message.error(
          t("Claw.MCP.list.testFailed", {
            0: result?.error || "Unknown error",
          }),
        );
      }
    } catch (e) {
      message.error(t("Claw.MCP.list.testFailed", { 0: String(e) }));
    } finally {
      setTestingServerId(null);
    }
  };

  const handleOpenEditorCreate = () => {
    setEditorMode("create");
    setEditingServerId("");
    setPageMode("editor");
  };

  const handleOpenEditorEdit = (serverId: string) => {
    if (warnIfGuiManaged(serverId)) return;
    setEditorMode("edit");
    setEditingServerId(serverId);
    setPageMode("editor");
  };

  const handleEditorDraftChange = (
    serverId: string,
    entry: McpServerEntry,
    previousServerId?: string,
  ) => {
    const latest = getCurrentConfigForUi();
    if (!latest) {
      return;
    }
    const nextConfig = applyMcpServerDraft(
      latest,
      serverId,
      entry,
      previousServerId,
    ) as McpServersConfig;
    updateConfigFromUi(nextConfig);
    if (
      editorMode === "edit" &&
      previousServerId &&
      previousServerId !== serverId
    ) {
      setEditingServerId(serverId);
    }
    setHasUnsavedEdits(true);
  };

  const handleEditorDraftRemove = (serverId: string) => {
    const latest = getCurrentConfigForUi();
    if (!latest?.mcpServers?.[serverId]) {
      return;
    }
    const nextServers = { ...latest.mcpServers };
    delete nextServers[serverId];
    updateConfigFromUi({ ...latest, mcpServers: nextServers });
    setHasUnsavedEdits(true);
  };

  const handleEditorBack = () => {
    setPageMode("list");
  };

  if (pageMode === "editor") {
    const editingEntry =
      editorMode === "edit" && editingServerId
        ? currentServers[editingServerId]
        : undefined;
    return (
      <div style={{ padding: 24 }}>
        <MCPServerEditor
          key={editorMode === "edit" ? editingServerId : "__create__"}
          mode={editorMode}
          editingServerId={editorMode === "edit" ? editingServerId : undefined}
          initialEntry={editingEntry}
          existingServerIds={Object.keys(currentServers)}
          isDarkMode={isDarkMode}
          fullConfig={currentConfig ?? undefined}
          onDraftChange={handleEditorDraftChange}
          onDraftRemove={handleEditorDraftRemove}
          onBack={handleEditorBack}
        />
      </div>
    );
  }

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
            {isDirty && (
              <Tag color="orange" style={{ marginInlineEnd: 4 }}>
                ● {t("Claw.MCP.unsavedChanges")}
              </Tag>
            )}
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
            <Tooltip title={t("Claw.MCP.action.resetTooltip")}>
              <Button
                icon={<UndoOutlined />}
                onClick={() => setShowResetConfirm(true)}
                disabled={!isDirty}
                size="small"
              >
                {t("Claw.MCP.action.reset")}
              </Button>
            </Tooltip>
            <Button
              icon={<SaveOutlined />}
              onClick={handleSaveConfig}
              type={isDirty ? "primary" : "default"}
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
                    onClick={handleOpenEditorCreate}
                  >
                    {t("Claw.MCP.list.addServer")}
                  </Button>
                </Space>
              </Space>
              <div
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 8,
                  backgroundColor: "var(--color-bg-container, #fff)",
                  padding: 12,
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
                      const isManagedGui = isGuiMcpManagedServerId(serverId);
                      const isStdio = "command" in entry;
                      const summary = isStdio
                        ? `${entry.command} ${(entry.args ?? []).join(" ")}`
                        : entry.url;
                      return (
                        <List.Item
                          actions={[
                            <Switch
                              key="enabled"
                              checked={isManagedGui ? true : !!entry.enabled}
                              disabled={isManagedGui}
                              checkedChildren={t("Claw.MCP.switch.enable")}
                              unCheckedChildren={t("Claw.MCP.switch.disable")}
                              onChange={(checked) =>
                                handleToggleServerEnabled(serverId, checked)
                              }
                            />,
                            <>
                              <Button
                                key="test"
                                size="small"
                                type="text"
                                icon={<CheckCircleOutlined />}
                                loading={testingServerId === serverId}
                                disabled={
                                  !!testingServerId &&
                                  testingServerId !== serverId
                                }
                                onClick={() => handleTestServer(serverId)}
                              />
                              <Button
                                key="edit"
                                size="small"
                                type="text"
                                icon={<EditOutlined />}
                                disabled={isManagedGui}
                                onClick={() => handleOpenEditorEdit(serverId)}
                              />
                              <Button
                                key="delete"
                                size="small"
                                danger
                                type="text"
                                loading={deletingServerId === serverId}
                                disabled={isManagedGui}
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteServer(serverId)}
                              />
                            </>,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <Text strong>{serverId}</Text>
                                <Tag color={isStdio ? "blue" : "purple"}>
                                  {isStdio ? "stdio" : "remote"}
                                </Tag>
                                {isManagedGui ? (
                                  <Tag color="gold">
                                    {t("Claw.MCP.list.guiAgentManagedTag")}
                                  </Tag>
                                ) : null}
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
                data-color-mode={isDarkMode ? "dark" : "light"}
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 8,
                  overflow: "auto",
                  position: "relative",
                  height: 400,
                }}
              >
                <CodeEditor
                  value={configText}
                  language="json"
                  onChange={(e) => {
                    setConfigText(e.target.value);
                    setHasUnsavedEdits(true);
                    if (configTextError) {
                      setConfigTextError("");
                    }
                  }}
                  padding={12}
                  style={{
                    fontSize: 13,
                    backgroundColor: isDarkMode ? "#1e1e1e" : "#fff",
                    fontFamily: "Monaco, Menlo, 'Courier New', monospace",
                    minHeight: "100%",
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
                  color: "var(--color-text)",
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

      {/* 撤销未保存改动确认 Modal */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: "#faad14" }} />
            {t("Claw.MCP.resetConfirm.title")}
          </Space>
        }
        open={showResetConfirm}
        onOk={handleResetConfig}
        onCancel={() => setShowResetConfirm(false)}
        okText={t("Claw.Common.confirm")}
        cancelText={t("Claw.Common.cancel")}
      >
        <Alert
          message={t("Claw.MCP.resetConfirm.content")}
          type="warning"
          showIcon
        />
      </Modal>
    </div>
  );
}

export default MCPSettings;
