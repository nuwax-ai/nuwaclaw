/**
 * MCP Proxy 设置组件 - JSON 可视化编辑器
 *
 * 使用 @uiw/react-json-view 提供可视化 JSON 编辑体验
 */

import { useState, useEffect } from "react";
import {
  Card,
  Button,
  Space,
  Badge,
  Typography,
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
import JsonView from "@uiw/react-json-view/editor";
import { darkTheme } from "@uiw/react-json-view/dark";
import { lightTheme } from "@uiw/react-json-view/light";
import type { McpServersConfig, McpProxyStatus } from "@shared/types/electron";
import { t } from "../../services/core/i18n";

const { Text } = Typography;

interface MCPSettingsProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function MCPSettings({ isOpen = true }: MCPSettingsProps) {
  const [config, setConfig] = useState<McpServersConfig>({ mcpServers: {} });
  const [status, setStatus] = useState<McpProxyStatus>({ running: false });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showExportWarning, setShowExportWarning] = useState(false);

  // 检测系统主题
  const isDarkMode =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

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
      if (savedConfig) {
        setConfig(savedConfig);
      }
      if (currentStatus) setStatus(currentStatus);
    } catch (error) {
      console.error("[MCPSettings] Failed to load:", error);
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

  const handleExportConfirm = async () => {
    try {
      const result = await window.electronAPI?.mcp.exportConfig();
      if (result?.success) {
        message.success(t("Claw.MCP.importExport.exportSuccess"));
      }
    } catch (error) {
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
            setConfig(imported);
            message.success(t("Claw.MCP.importExport.importSuccess"));
          } catch (error) {
            message.error(t("Claw.MCP.importExport.importFailed"));
          }
        };
        reader.readAsText(file);
      };
      input.click();
    } catch (error) {
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
            <Text strong style={{ marginBottom: 8, display: "block" }}>
              {t("Claw.MCP.editor.config")}
            </Text>
            <div
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: 4,
                padding: 16,
                backgroundColor: isDarkMode ? "#1f1f1f" : "#fafafa",
              }}
            >
              <JsonView
                value={config}
                style={isDarkMode ? darkTheme : lightTheme}
                onChange={(newValue) => {
                  setConfig(newValue as McpServersConfig);
                }}
              />
            </div>
          </div>

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
    </div>
  );
}

export default MCPSettings;
