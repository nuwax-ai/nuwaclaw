import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Space,
  Typography,
  Input,
  Segmented,
  message,
  Card,
  Select,
} from "antd";
import {
  ArrowLeftOutlined,
  SaveOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import type { McpServerEntry, McpServersConfig } from "@shared/types/electron";
import { t } from "../../services/core/i18n";

const { Text } = Typography;

interface MCPServerEditorProps {
  mode: "create" | "edit";
  editingServerId?: string;
  initialEntry?: McpServerEntry;
  existingServerIds: string[];
  isDarkMode: boolean;
  fullConfig?: McpServersConfig;
  onSave: (serverId: string, entry: McpServerEntry) => void;
  onBack: () => void;
}

function serializeEntryToJson(serverId: string, entry: McpServerEntry): string {
  const obj: Record<string, unknown> = {};
  obj[serverId] = entry;
  return JSON.stringify(obj, null, 2);
}

function parseServerFromJson(
  text: string,
):
  | { ok: true; serverId: string; entry: McpServerEntry }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: t("Claw.MCP.message.invalidJson") };
  }

  const obj = parsed as Record<string, unknown>;

  // 格式 B: {"mcpServers": {"server-name": {...}}}
  if (
    obj.mcpServers &&
    typeof obj.mcpServers === "object" &&
    !Array.isArray(obj.mcpServers)
  ) {
    const servers = obj.mcpServers as Record<string, unknown>;
    const keys = Object.keys(servers);
    for (const key of keys) {
      const val = servers[key];
      if (
        val &&
        typeof val === "object" &&
        ("command" in val || "url" in val)
      ) {
        return { ok: true, serverId: key, entry: val as McpServerEntry };
      }
    }
  }

  // 格式 A: {"server-name": {command/url entry}}
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key === "mcpServers" || key === "allowTools" || key === "denyTools")
      continue;
    const val = obj[key];
    if (val && typeof val === "object" && ("command" in val || "url" in val)) {
      return { ok: true, serverId: key, entry: val as McpServerEntry };
    }
  }

  return { ok: false, error: t("Claw.MCP.message.invalidJson") };
}

function MCPServerEditor({
  mode,
  editingServerId,
  initialEntry,
  existingServerIds,
  isDarkMode,
  fullConfig,
  onSave,
  onBack,
}: MCPServerEditorProps) {
  const [editorTab, setEditorTab] = useState<"form" | "json">("form");
  const [serverType, setServerType] = useState<"stdio" | "remote">("stdio");
  const [serverId, setServerId] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">(
    "streamable-http",
  );
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  const isEdit = mode === "edit";

  useEffect(() => {
    if (isEdit && initialEntry && editingServerId) {
      if ("command" in initialEntry) {
        setServerType("stdio");
        setCommand(initialEntry.command);
        setArgsText(JSON.stringify(initialEntry.args ?? []));
      } else {
        setServerType("remote");
        setUrl(initialEntry.url);
        setTransport(initialEntry.transport ?? "streamable-http");
      }
      setServerId(editingServerId);
      setJsonText(serializeEntryToJson(editingServerId, initialEntry));
    } else {
      setJsonText("");
    }
  }, [isEdit, initialEntry, editingServerId]);

  const parseArgsText = (
    input: string,
  ): { ok: true; args: string[] } | { ok: false; error: string } => {
    const raw = input.trim();
    if (!raw) return { ok: true, args: [] };
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
    const tokens: string[] = [];
    const tokenPattern =
      /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(raw)) !== null) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      tokens.push(value.replace(/\\(["'])/g, "$1"));
    }
    if (tokens.length === 0) {
      return { ok: false, error: t("Claw.MCP.addServer.argsInvalid") };
    }
    return { ok: true, args: tokens };
  };

  const buildEntryFromForm = ():
    | { ok: true; serverId: string; entry: McpServerEntry }
    | { ok: false; error: string } => {
    const id = serverId.trim();
    if (!id) return { ok: false, error: t("Claw.MCP.addServer.idRequired") };

    if (serverType === "stdio") {
      const cmd = command.trim();
      if (!cmd)
        return { ok: false, error: t("Claw.MCP.addServer.commandRequired") };
      const argsParsed = parseArgsText(argsText);
      if (!argsParsed.ok) return argsParsed;
      return {
        ok: true,
        serverId: id,
        entry: {
          command: cmd,
          args: argsParsed.args,
          enabled: initialEntry?.enabled ?? false,
        },
      };
    }

    const u = url.trim();
    if (!u) return { ok: false, error: t("Claw.MCP.addServer.urlRequired") };
    return {
      ok: true,
      serverId: id,
      entry: { url: u, transport, enabled: initialEntry?.enabled ?? false },
    };
  };

  const syncFormToJson = useCallback(() => {
    const result = buildEntryFromForm();
    if (result.ok) {
      setJsonText(serializeEntryToJson(result.serverId, result.entry));
      setJsonError("");
    }
    // buildEntryFromForm is stable; intentional exhaustive deps ok
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverType, serverId, command, argsText, url, transport]);

  const handleTabChange = (val: string) => {
    if (val === "json") {
      syncFormToJson();
    } else {
      // JSON → Form: 尝试解析 JSON 并填充表单字段
      if (!jsonText.trim()) {
        setEditorTab("form");
        return;
      }
      const parsed = parseServerFromJson(jsonText);
      if (!parsed.ok) {
        setJsonError(parsed.error);
        return;
      }
      const { serverId: parsedId, entry } = parsed;
      if ("command" in entry) {
        setServerType("stdio");
        setCommand(entry.command);
        setArgsText(JSON.stringify(entry.args ?? []));
      } else {
        setServerType("remote");
        setUrl(entry.url);
        setTransport(entry.transport ?? "streamable-http");
      }
      if (!isEdit) {
        setServerId(parsedId);
      }
      setJsonError("");
    }
    setEditorTab(val as "form" | "json");
  };

  const handleSave = () => {
    const result = buildEntryFromForm();
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    if (!isEdit && existingServerIds.includes(result.serverId)) {
      message.error(t("Claw.MCP.addServer.idDuplicate"));
      return;
    }
    onSave(result.serverId, result.entry);
  };

  const handleTest = async () => {
    const result = buildEntryFromForm();
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    if (!isEdit && existingServerIds.includes(result.serverId)) {
      message.error(t("Claw.MCP.addServer.idDuplicate"));
      return;
    }

    setTestLoading(true);
    try {
      // 优先用父组件内存中的配置（含其他未持久化的修改），回退到 DB 中的配置
      const baseConfig = fullConfig ??
        (await window.electronAPI?.mcp.getConfig()) ?? { mcpServers: {} };
      const mergedServers = {
        ...(baseConfig.mcpServers ?? {}),
        [result.serverId]: result.entry,
      };
      await window.electronAPI?.mcp.setConfig({
        ...baseConfig,
        mcpServers: mergedServers,
      });

      const discoverResult = await window.electronAPI?.mcp.discoverTools(
        result.serverId,
      );
      if (discoverResult?.success) {
        const toolCount = discoverResult.tools?.length ?? 0;
        message.success(t("Claw.MCP.list.testSuccess", { 0: toolCount }));
      } else {
        message.error(
          t("Claw.MCP.list.testFailed", {
            0: discoverResult?.error || "Unknown error",
          }),
        );
      }
    } catch (e) {
      message.error(t("Claw.MCP.list.testFailed", { 0: String(e) }));
    } finally {
      setTestLoading(false);
    }
  };

  const titleText = isEdit
    ? t("Claw.MCP.editor.editTitle")
    : t("Claw.MCP.editor.createTitle");

  return (
    <Card
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} size="small" onClick={onBack}>
            {t("Claw.MCP.editor.back")}
          </Button>
          <span>{titleText}</span>
        </Space>
      }
      extra={
        <Space>
          <Button
            icon={<CheckCircleOutlined />}
            onClick={handleTest}
            loading={testLoading}
            size="small"
          >
            {t("Claw.MCP.list.test")}
          </Button>
          <Button
            icon={<SaveOutlined />}
            type="primary"
            onClick={handleSave}
            size="small"
          >
            {t("Claw.Common.save")}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Segmented
          value={editorTab}
          onChange={handleTabChange}
          options={[
            { label: t("Claw.MCP.editor.tabForm"), value: "form" },
            { label: t("Claw.MCP.editor.tabJson"), value: "json" },
          ]}
        />

        {editorTab === "form" ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <div>
              <Text style={{ display: "block", marginBottom: 6 }}>
                {t("Claw.MCP.addServer.type")}
              </Text>
              <Segmented
                value={serverType}
                options={[
                  { label: "stdio", value: "stdio" },
                  { label: "remote", value: "remote" },
                ]}
                onChange={(val) => setServerType(val as "stdio" | "remote")}
              />
            </div>

            <div>
              <Text style={{ display: "block", marginBottom: 6 }}>
                {t("Claw.MCP.addServer.serverId")}
              </Text>
              <Input
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                placeholder={t("Claw.MCP.addServer.idPlaceholder")}
                disabled={isEdit}
              />
            </div>

            {serverType === "stdio" ? (
              <>
                <div>
                  <Text style={{ display: "block", marginBottom: 6 }}>
                    Command
                  </Text>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={t("Claw.MCP.addServer.commandPlaceholder")}
                  />
                </div>
                <div>
                  <Text style={{ display: "block", marginBottom: 6 }}>
                    Args
                  </Text>
                  <Input.TextArea
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder={t(
                      "Claw.MCP.addServer.argsPlaceholderAdvanced",
                    )}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Text style={{ display: "block", marginBottom: 6 }}>URL</Text>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("Claw.MCP.addServer.urlPlaceholder")}
                  />
                </div>
                <div>
                  <Text style={{ display: "block", marginBottom: 6 }}>
                    Transport
                  </Text>
                  <Select
                    value={transport}
                    onChange={(val) => setTransport(val)}
                    style={{ width: "100%" }}
                    options={[
                      { label: "Streamable HTTP", value: "streamable-http" },
                      { label: "SSE", value: "sse" },
                    ]}
                  />
                </div>
              </>
            )}
          </Space>
        ) : (
          <div>
            <Text
              type="secondary"
              style={{ marginBottom: 8, display: "block" }}
            >
              {t("Claw.MCP.editor.jsonHint")}
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
                value={jsonText}
                onChange={(value) => {
                  setJsonText(value || "");
                  if (jsonError) setJsonError("");
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
            {jsonError ? (
              <Text type="danger" style={{ marginTop: 8, display: "block" }}>
                {jsonError}
              </Text>
            ) : null}
          </div>
        )}
      </Space>
    </Card>
  );
}

export default MCPServerEditor;
