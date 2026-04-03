/**
 * MCP Proxy 设置组件
 *
 * 使用 nuwax-mcp-stdio-proxy 聚合代理模式管理 MCP 服务。
 * 支持 stdio（命令行）和远程（HTTP/SSE）两种 MCP Server 类型。
 * 所有操作通过 window.electronAPI.mcp.* IPC 通道。
 */

import { useState, useEffect } from "react";
import {
  Card,
  Button,
  Space,
  Badge,
  Input,
  Radio,
  Select,
  Typography,
  Divider,
  Tag,
  message,
  Popconfirm,
} from "antd";
import {
  PlayCircleOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  ApiOutlined,
  GlobalOutlined,
  CodeOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import type {
  McpServersConfig,
  McpProxyStatus,
  McpServerEntry,
} from "@shared/types/electron";
import { t } from "../../services/core/i18n";

const { Text } = Typography;

/** 判断是否为远程类型 entry */
function isRemote(
  entry: McpServerEntry,
): entry is Extract<McpServerEntry, { url: string }> {
  return "url" in entry;
}

interface MCPSettingsProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function MCPSettings({ isOpen = true, onClose }: MCPSettingsProps) {
  const [config, setConfig] = useState<McpServersConfig>({ mcpServers: {} });
  const [status, setStatus] = useState<McpProxyStatus>({ running: false });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // 新增 server 表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServerId, setNewServerId] = useState("");
  const [newServerType, setNewServerType] = useState<"stdio" | "remote">(
    "stdio",
  );
  // stdio fields
  const [newServerCommand, setNewServerCommand] = useState("npx");
  const [newServerArgs, setNewServerArgs] = useState("");
  // remote fields
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerTransport, setNewServerTransport] = useState<
    "auto" | "streamable-http" | "sse"
  >("auto");
  const [newServerAuthToken, setNewServerAuthToken] = useState("");

  // 工具过滤模式
  const filterMode: "none" | "allow" | "deny" =
    config.allowTools && config.allowTools.length > 0
      ? "allow"
      : config.denyTools && config.denyTools.length > 0
        ? "deny"
        : "none";

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [isOpen]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [savedConfig, currentStatus] = await Promise.all([
        window.electronAPI?.mcp.getConfig(),
        window.electronAPI?.mcp.status(),
      ]);
      if (savedConfig) setConfig(savedConfig);
      if (currentStatus) setStatus(currentStatus);
    } catch (error) {
      console.error("[MCPSettings] 加载失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const currentStatus = await window.electronAPI?.mcp.status();
      if (currentStatus) setStatus(currentStatus);
    } catch {}
  };

  const handleSaveConfig = async () => {
    try {
      await window.electronAPI?.mcp.setConfig(config);
      message.success(t("Claw.MCP.message.configSaved"));
    } catch (error) {
      message.error(t("Claw.Common.saveFailed"));
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      // 先保存配置
      await window.electronAPI?.mcp.setConfig(config);

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
    setActionLoading(true);
    try {
      await window.electronAPI?.mcp.setConfig(config);

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

  const resetAddForm = () => {
    setNewServerId("");
    setNewServerType("stdio");
    setNewServerCommand("npx");
    setNewServerArgs("");
    setNewServerUrl("");
    setNewServerTransport("auto");
    setNewServerAuthToken("");
    setShowAddForm(false);
  };

  const handleAddServer = () => {
    if (!newServerId.trim()) {
      message.warning(t("Claw.MCP.addServer.idRequired"));
      return;
    }

    const id = newServerId.trim().toLowerCase().replace(/\s+/g, "-");

    if (newServerType === "remote") {
      if (!newServerUrl.trim()) {
        message.warning(t("Claw.MCP.addServer.urlRequired"));
        return;
      }
      const entry: McpServerEntry = {
        url: newServerUrl.trim(),
        ...(newServerTransport !== "auto"
          ? { transport: newServerTransport }
          : {}),
        ...(newServerAuthToken.trim()
          ? { authToken: newServerAuthToken.trim() }
          : {}),
      };
      setConfig({
        ...config,
        mcpServers: { ...config.mcpServers, [id]: entry },
      });
    } else {
      if (!newServerArgs.trim()) {
        message.warning(t("Claw.MCP.addServer.argsRequired"));
        return;
      }
      const args = newServerArgs.split(" ").filter(Boolean);
      setConfig({
        ...config,
        mcpServers: {
          ...config.mcpServers,
          [id]: { command: newServerCommand, args },
        },
      });
    }

    resetAddForm();
    message.info(t("Claw.MCP.message.serverAdded"));
  };

  const handleRemoveServer = (id: string) => {
    const { [id]: _, ...rest } = config.mcpServers;
    setConfig({ ...config, mcpServers: rest });
    message.info(t("Claw.MCP.message.serverRemoved"));
  };

  const handleUpdateServerArgs = (id: string, argsStr: string) => {
    const entry = config.mcpServers[id];
    if (isRemote(entry)) return;
    const args = argsStr.split(" ").filter(Boolean);
    setConfig({
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [id]: { ...entry, args },
      },
    });
  };

  const handleUpdateServerUrl = (id: string, url: string) => {
    const entry = config.mcpServers[id];
    if (!isRemote(entry)) return;
    setConfig({
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [id]: { ...entry, url },
      },
    });
  };

  const handleFilterModeChange = (mode: "none" | "allow" | "deny") => {
    if (mode === "none") {
      setConfig({ ...config, allowTools: undefined, denyTools: undefined });
    } else if (mode === "allow") {
      setConfig({
        ...config,
        allowTools: config.allowTools || [],
        denyTools: undefined,
      });
    } else {
      setConfig({
        ...config,
        allowTools: undefined,
        denyTools: config.denyTools || [],
      });
    }
  };

  const handleFilterToolsChange = (value: string) => {
    const tools = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (filterMode === "allow") {
      setConfig({ ...config, allowTools: tools });
    } else if (filterMode === "deny") {
      setConfig({ ...config, denyTools: tools });
    }
  };

  if (!isOpen) return null;

  const serverEntries = Object.entries(config.mcpServers || {});

  return (
    <Card
      title={
        <Space>
          <ApiOutlined />
          {t("Claw.MCP.title")}
        </Space>
      }
      extra={
        onClose ? (
          <Button size="small" onClick={onClose}>
            {t("Claw.Common.close")}
          </Button>
        ) : undefined
      }
      style={onClose ? { margin: 16 } : undefined}
      loading={loading}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        {/* Status & Controls */}
        <Card size="small" style={{ background: "#f5f5f5" }}>
          <Space wrap>
            <Badge
              status={status.running ? "success" : "default"}
              text={
                status.running
                  ? t("Claw.MCP.status.ready")
                  : t("Claw.MCP.status.notReady")
              }
            />
            <Text type="secondary">
              {status.serverCount ?? 0} {t("Claw.MCP.status.serverCount")}
            </Text>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={actionLoading}
              size="small"
            >
              {t("Claw.MCP.checkAvailability")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRestart}
              loading={actionLoading}
              size="small"
            >
              {t("Claw.Common.refresh")}
            </Button>
          </Space>
        </Card>

        <Divider orientation="left" style={{ margin: "8px 0" }}>
          {t("Claw.MCP.serverManagement.title")}
        </Divider>

        {/* Server List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {serverEntries.length === 0 && (
            <Text type="secondary" style={{ textAlign: "center", padding: 16 }}>
              {t("Claw.MCP.serverManagement.noServers")}
            </Text>
          )}

          {serverEntries.map(([id, entry]) => (
            <Card key={id} size="small" style={{ border: "1px solid #e4e4e7" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={4}>
                    <Text strong>{id}</Text>
                    {isRemote(entry) ? (
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        <GlobalOutlined style={{ marginRight: 2 }} />
                        {entry.transport === "sse"
                          ? t("Claw.MCP.transport.sse")
                          : t("Claw.MCP.transport.http")}
                      </Tag>
                    ) : (
                      <Tag style={{ fontSize: 11 }}>
                        <CodeOutlined style={{ marginRight: 2 }} />
                        {t("Claw.MCP.transport.stdio")}
                      </Tag>
                    )}
                  </Space>
                  {isRemote(entry) ? (
                    <>
                      <div style={{ marginTop: 4 }}>
                        <Text
                          type="secondary"
                          style={{ fontSize: 12, wordBreak: "break-all" }}
                        >
                          {entry.url}
                        </Text>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Input
                          size="small"
                          addonBefore={t("Claw.MCP.addServer.url")}
                          value={entry.url}
                          onChange={(e) =>
                            handleUpdateServerUrl(id, e.target.value)
                          }
                          placeholder="https://example.com/mcp"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ marginTop: 4 }}>
                        <Text
                          type="secondary"
                          style={{ fontSize: 12, wordBreak: "break-all" }}
                        >
                          {entry.command} {entry.args.join(" ")}
                        </Text>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Input
                          size="small"
                          addonBefore={entry.command}
                          value={entry.args.join(" ")}
                          onChange={(e) =>
                            handleUpdateServerArgs(id, e.target.value)
                          }
                          placeholder={t("Claw.MCP.addServer.argsPlaceholder")}
                        />
                      </div>
                    </>
                  )}
                </div>
                <Popconfirm
                  title={t("Claw.MCP.serverManagement.confirmRemove")}
                  onConfirm={() => handleRemoveServer(id)}
                  okText={t("Claw.Common.confirm")}
                  cancelText={t("Claw.Common.cancel")}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>

        {/* Add Server Form */}
        {showAddForm ? (
          <Card size="small" style={{ border: "1px dashed #d4d4d8" }}>
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Input
                size="small"
                placeholder={t("Claw.MCP.addServer.idPlaceholder")}
                value={newServerId}
                onChange={(e) => setNewServerId(e.target.value)}
              />
              <Radio.Group
                size="small"
                value={newServerType}
                onChange={(e) => setNewServerType(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="stdio">
                  <CodeOutlined /> {t("Claw.MCP.addServer.stdio")}
                </Radio.Button>
                <Radio.Button value="remote">
                  <GlobalOutlined /> {t("Claw.MCP.addServer.remote")}
                </Radio.Button>
              </Radio.Group>

              {newServerType === "stdio" ? (
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    size="small"
                    style={{ width: 80 }}
                    value={newServerCommand}
                    onChange={(e) => setNewServerCommand(e.target.value)}
                    placeholder={t("Claw.MCP.addServer.commandPlaceholder")}
                  />
                  <Input
                    size="small"
                    value={newServerArgs}
                    onChange={(e) => setNewServerArgs(e.target.value)}
                    placeholder={t("Claw.MCP.addServer.argsPlaceholderFull")}
                  />
                </Space.Compact>
              ) : (
                <>
                  <Input
                    size="small"
                    value={newServerUrl}
                    onChange={(e) => setNewServerUrl(e.target.value)}
                    placeholder={t("Claw.MCP.addServer.urlPlaceholder")}
                    addonBefore={t("Claw.MCP.addServer.url")}
                  />
                  <Space.Compact style={{ width: "100%" }}>
                    <Select
                      size="small"
                      style={{ width: 160 }}
                      value={newServerTransport}
                      onChange={setNewServerTransport}
                      options={[
                        { value: "auto", label: t("Claw.MCP.transport.auto") },
                        {
                          value: "streamable-http",
                          label: t("Claw.MCP.transport.streamableHttp"),
                        },
                        { value: "sse", label: t("Claw.MCP.transport.sse") },
                      ]}
                    />
                    <Input
                      size="small"
                      value={newServerAuthToken}
                      onChange={(e) => setNewServerAuthToken(e.target.value)}
                      placeholder={t("Claw.MCP.addServer.authTokenPlaceholder")}
                    />
                  </Space.Compact>
                </>
              )}

              <Space>
                <Button size="small" type="primary" onClick={handleAddServer}>
                  {t("Claw.Common.add")}
                </Button>
                <Button size="small" onClick={resetAddForm}>
                  {t("Claw.Common.cancel")}
                </Button>
              </Space>
            </Space>
          </Card>
        ) : (
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setShowAddForm(true)}
            block
            size="small"
          >
            {t("Claw.MCP.addServer.button")}
          </Button>
        )}

        {/* Tool Filter */}
        <Divider orientation="left" style={{ margin: "8px 0" }}>
          <FilterOutlined /> {t("Claw.MCP.toolFilter.title")}
        </Divider>

        <Card size="small" style={{ border: "1px solid #e4e4e7" }}>
          <Space direction="vertical" style={{ width: "100%" }} size="small">
            <Radio.Group
              size="small"
              value={filterMode}
              onChange={(e) => handleFilterModeChange(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="none">
                {t("Claw.MCP.toolFilter.none")}
              </Radio.Button>
              <Radio.Button value="allow">
                {t("Claw.MCP.toolFilter.allowList")}
              </Radio.Button>
              <Radio.Button value="deny">
                {t("Claw.MCP.toolFilter.denyList")}
              </Radio.Button>
            </Radio.Group>

            {filterMode !== "none" && (
              <Input.TextArea
                size="small"
                rows={2}
                value={
                  (filterMode === "allow"
                    ? config.allowTools
                    : config.denyTools
                  )?.join(", ") || ""
                }
                onChange={(e) => handleFilterToolsChange(e.target.value)}
                placeholder={
                  filterMode === "allow"
                    ? t("Claw.MCP.toolFilter.allowPlaceholder")
                    : t("Claw.MCP.toolFilter.denyPlaceholder")
                }
              />
            )}

            <Text type="secondary" style={{ fontSize: 11 }}>
              {filterMode === "none"
                ? t("Claw.MCP.toolFilter.hintNone")
                : filterMode === "allow"
                  ? t("Claw.MCP.toolFilter.hintAllow")
                  : t("Claw.MCP.toolFilter.hintDeny")}
            </Text>
          </Space>
        </Card>

        {/* Save */}
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSaveConfig}
          block
        >
          {t("Claw.MCP.saveConfig")}
        </Button>

        <Text
          type="secondary"
          style={{ fontSize: 11, textAlign: "center", display: "block" }}
        >
          {t("Claw.MCP.saveConfigHint")}
        </Text>
      </Space>
    </Card>
  );
}

export default MCPSettings;
