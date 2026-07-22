import { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Space,
  Typography,
  Input,
  Segmented,
  message,
  Card,
  Select,
  Switch,
} from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined } from "@ant-design/icons";
import CodeEditor from "@uiw/react-textarea-code-editor";
import type { McpServerEntry, McpServersConfig } from "@shared/types/electron";
import { t } from "../../services/core/i18n";
import {
  isMcpServerIdDuplicate,
  parseEnvText,
  parseServerFromJson,
  resolveMcpEditorPayload,
  serializeEntryToJson,
  serializeEnvToText,
} from "./mcpServerEditorUtils";

const { Text } = Typography;

/** 表单/JSON 变更后防抖写入父组件草稿的间隔（毫秒）。 */
const DRAFT_AUTOSAVE_MS = 400;

interface MCPServerEditorProps {
  mode: "create" | "edit";
  editingServerId?: string;
  initialEntry?: McpServerEntry;
  existingServerIds: string[];
  isDarkMode: boolean;
  fullConfig?: McpServersConfig;
  /** 将有效草稿合并进主界面配置（不持久化，主界面统一保存后生效）。 */
  onDraftChange: (
    serverId: string,
    entry: McpServerEntry,
    previousServerId?: string,
  ) => void;
  /** 新建模式下用户放弃无效草稿时，从主界面配置移除已自动写入的条目。 */
  onDraftRemove?: (serverId: string) => void;
  onBack: () => void;
}

function MCPServerEditor({
  mode,
  editingServerId,
  initialEntry,
  existingServerIds,
  isDarkMode,
  fullConfig,
  onDraftChange,
  onDraftRemove,
  onBack,
}: MCPServerEditorProps) {
  const [editorTab, setEditorTab] = useState<"form" | "json">("form");
  const [serverType, setServerType] = useState<"stdio" | "remote">("stdio");
  const [serverId, setServerId] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  // stdio 专用：JSON 对象文本，对应 entry.env（如 NUWAX_OPENUI_BASE_URL）
  const [envText, setEnvText] = useState("");
  // stdio 专用：是否走 PersistentMcpBridge（与 chrome-devtools / nuwax-openui 同路径）
  const [persistent, setPersistent] = useState(false);
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">(
    "streamable-http",
  );
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  // 用于序列化比较 initialEntry，防止因父组件重渲染产生的新引用而重置表单
  const lastInitialEntryRef = useRef<string>("");
  // 记录本次会话已写入父组件草稿的 serverId（新建改名 / 放弃时清理）
  const lastSyncedServerIdRef = useRef<string>("");
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  const isEdit = mode === "edit";

  useEffect(() => {
    if (isEdit && editingServerId) {
      const serialized = initialEntry ? JSON.stringify(initialEntry) : "";
      if (serialized !== lastInitialEntryRef.current) {
        lastInitialEntryRef.current = serialized;
        if (initialEntry) {
          if ("command" in initialEntry) {
            setServerType("stdio");
            setCommand(initialEntry.command);
            setArgsText(JSON.stringify(initialEntry.args ?? []));
            setEnvText(serializeEnvToText(initialEntry.env));
            setPersistent(!!initialEntry.persistent);
          } else {
            setServerType("remote");
            setUrl(initialEntry.url);
            setTransport(initialEntry.transport ?? "streamable-http");
            setEnvText("");
            setPersistent(false);
          }
          setServerId(editingServerId);
          setJsonText(serializeEntryToJson(editingServerId, initialEntry));
          lastSyncedServerIdRef.current = editingServerId;
        }
      }
    } else if (!isEdit) {
      setJsonText("");
      setEnvText("");
      setPersistent(false);
      lastInitialEntryRef.current = "";
      lastSyncedServerIdRef.current = "";
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

  const buildEntryFromForm = useCallback(():
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
      const envParsed = parseEnvText(envText);
      if (!envParsed.ok) return envParsed;
      return {
        ok: true,
        serverId: id,
        entry: {
          command: cmd,
          args: argsParsed.args,
          enabled: initialEntry?.enabled ?? false,
          // 仅在有有效键值时写入，对应如 NUWAX_OPENUI_BASE_URL
          ...(envParsed.env ? { env: envParsed.env } : {}),
          // persistent: 进 PersistentMcpBridge，再由 mcp-proxy 以 {url} 接入（同 chrome-devtools）
          ...(persistent ? { persistent: true } : {}),
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
  }, [
    serverId,
    serverType,
    command,
    argsText,
    envText,
    persistent,
    url,
    transport,
    initialEntry?.enabled,
  ]);

  const resolveEditorPayload = useCallback(
    () =>
      resolveMcpEditorPayload({
        editorTab,
        jsonText,
        isEdit,
        editingServerId,
        formPayload: buildEntryFromForm,
      }),
    [editorTab, jsonText, isEdit, editingServerId, buildEntryFromForm],
  );

  const getDuplicateExcludeIds = useCallback((): string[] => {
    const exclude = new Set<string>();
    if (editingServerId) exclude.add(editingServerId);
    if (lastSyncedServerIdRef.current)
      exclude.add(lastSyncedServerIdRef.current);
    return [...exclude];
  }, [editingServerId]);

  const reportPayloadError = (error: string) => {
    message.error(error);
    if (editorTab === "json") {
      setJsonError(error);
    }
  };

  const syncFormToJson = useCallback(() => {
    const result = buildEntryFromForm();
    if (result.ok) {
      setJsonText(serializeEntryToJson(result.serverId, result.entry));
      setJsonError("");
    }
  }, [buildEntryFromForm]);

  /** 将当前有效表单/JSON 合并进主界面草稿（不弹成功提示、不离开编辑页）。 */
  const pushDraftToParent = useCallback(() => {
    const result = resolveEditorPayload();
    if (!result.ok) return false;

    if (
      isMcpServerIdDuplicate(
        result.serverId,
        existingServerIds,
        getDuplicateExcludeIds(),
      )
    ) {
      return false;
    }

    const previousServerId =
      lastSyncedServerIdRef.current || editingServerId || undefined;
    onDraftChangeRef.current(
      result.serverId,
      result.entry,
      previousServerId !== result.serverId ? previousServerId : undefined,
    );
    lastSyncedServerIdRef.current = result.serverId;
    setJsonError("");
    return true;
  }, [
    resolveEditorPayload,
    existingServerIds,
    getDuplicateExcludeIds,
    editingServerId,
  ]);

  // 单条编辑详情：防抖自动保存到主界面草稿，主界面「保存」才持久化
  useEffect(() => {
    const timer = window.setTimeout(() => {
      pushDraftToParent();
    }, DRAFT_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [
    editorTab,
    serverType,
    serverId,
    command,
    argsText,
    envText,
    persistent,
    url,
    transport,
    jsonText,
    pushDraftToParent,
  ]);

  const handleTabChange = (val: string) => {
    if (val === "json") {
      syncFormToJson();
    } else {
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
        setEnvText(serializeEnvToText(entry.env));
        setPersistent(!!entry.persistent);
      } else {
        setServerType("remote");
        setUrl(entry.url);
        setTransport(entry.transport ?? "streamable-http");
        setEnvText("");
        setPersistent(false);
      }
      setServerId(parsedId);
      setJsonError("");
    }
    setEditorTab(val as "form" | "json");
  };

  const handleBack = () => {
    const synced = pushDraftToParent();
    if (!synced && !isEdit && lastSyncedServerIdRef.current && onDraftRemove) {
      onDraftRemove(lastSyncedServerIdRef.current);
    }
    onBack();
  };

  const handleTest = async () => {
    const result = resolveEditorPayload();
    if (!result.ok) {
      reportPayloadError(result.error);
      return;
    }
    if (
      isMcpServerIdDuplicate(
        result.serverId,
        existingServerIds,
        getDuplicateExcludeIds(),
      )
    ) {
      message.error(t("Claw.MCP.addServer.idDuplicate"));
      return;
    }

    // 测试前先把草稿写入内存配置，但不持久化到 DB
    pushDraftToParent();

    setTestLoading(true);
    try {
      const baseConfig = fullConfig ??
        (await window.electronAPI?.mcp.getConfig()) ?? { mcpServers: {} };
      const draftConfig: McpServersConfig = {
        ...baseConfig,
        mcpServers: {
          ...(baseConfig.mcpServers ?? {}),
          [result.serverId]: result.entry,
        },
      };

      const discoverResult = await window.electronAPI?.mcp.discoverTools(
        result.serverId,
        draftConfig,
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
          <Button
            icon={<ArrowLeftOutlined />}
            size="small"
            onClick={handleBack}
          >
            {t("Claw.MCP.editor.back")}
          </Button>
          <span>{titleText}</span>
        </Space>
      }
      extra={
        <Button
          icon={<CheckCircleOutlined />}
          onClick={handleTest}
          loading={testLoading}
          size="small"
        >
          {t("Claw.MCP.list.test")}
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Text type="secondary">{t("Claw.MCP.editor.draftHint")}</Text>

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
                <div>
                  <Text style={{ display: "block", marginBottom: 6 }}>
                    {t("Claw.MCP.addServer.env")}
                  </Text>
                  <Input.TextArea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder={t("Claw.MCP.addServer.envPlaceholder")}
                  />
                </div>
                <div>
                  <Space align="center">
                    <Switch
                      checked={persistent}
                      onChange={setPersistent}
                      size="small"
                    />
                    <Text>{t("Claw.MCP.addServer.persistent")}</Text>
                  </Space>
                  <Text
                    type="secondary"
                    style={{ display: "block", marginTop: 4, fontSize: 12 }}
                  >
                    {t("Claw.MCP.addServer.persistentHint")}
                  </Text>
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
              data-color-mode={isDarkMode ? "dark" : "light"}
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: 4,
                overflow: "auto",
                height: 400,
              }}
            >
              <CodeEditor
                value={jsonText}
                language="json"
                onChange={(e) => {
                  setJsonText(e.target.value);
                  if (jsonError) setJsonError("");
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
