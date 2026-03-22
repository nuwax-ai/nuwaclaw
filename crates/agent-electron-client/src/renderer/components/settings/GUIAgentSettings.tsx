import React, { useState, useEffect } from "react";
import {
  Card,
  Form,
  Switch,
  InputNumber,
  Select,
  Slider,
  Button,
  Space,
  Badge,
  Typography,
  Divider,
  Input,
  message,
  Tooltip,
} from "antd";
import {
  DesktopOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CopyOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type {
  GuiAgentConfig,
  GuiAgentStatus,
  GuiPermissionInfo,
  GuiPermissionState,
} from "@shared/types/guiAgentTypes";
import { DEFAULT_GUI_AGENT_CONFIG } from "@shared/types/guiAgentTypes";

const { Title, Text } = Typography;

interface GUIAgentSettingsProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const permissionLabel: Record<
  GuiPermissionState,
  { text: string; color: string }
> = {
  granted: { text: "已授权", color: "green" },
  denied: { text: "未授权", color: "red" },
  not_determined: { text: "未请求", color: "orange" },
  not_needed: { text: "无需授权", color: "default" },
  unknown: { text: "未知", color: "default" },
};

function GUIAgentSettings({ isOpen = true }: GUIAgentSettingsProps) {
  const [config, setConfig] = useState<GuiAgentConfig>(
    DEFAULT_GUI_AGENT_CONFIG,
  );
  const [status, setStatus] = useState<GuiAgentStatus>({ running: false });
  const [permissions, setPermissions] = useState<GuiPermissionInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadStatus();
      loadPermissions();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const result = await window.electronAPI?.guiAgent.getConfig();
      if (result) setConfig(result);
    } catch (e) {
      console.error("[GUIAgentSettings] load config error:", e);
    }
  };

  const loadStatus = async () => {
    try {
      const result = await window.electronAPI?.guiAgent.status();
      if (result) setStatus(result);
    } catch (e) {
      console.error("[GUIAgentSettings] load status error:", e);
    }
  };

  const loadPermissions = async () => {
    try {
      const result = await window.electronAPI?.guiAgent.checkPermissions();
      if (result) setPermissions(result);
    } catch (e) {
      console.error("[GUIAgentSettings] load permissions error:", e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electronAPI?.guiAgent.setConfig(config);
      if (result?.success) {
        message.success("配置已保存");
      } else {
        message.error(result?.error || "保存失败");
      }
    } catch (e) {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleStartStop = async () => {
    setLoading(true);
    try {
      if (status.running) {
        const result = await window.electronAPI?.guiAgent.stop();
        if (result?.success) {
          message.success("GUI Agent 已停止");
        } else {
          message.error(result?.error || "停止失败");
        }
      } else {
        const result = await window.electronAPI?.guiAgent.start(config);
        if (result?.success) {
          message.success("GUI Agent 已启动");
        } else {
          message.error(result?.error || "启动失败");
        }
      }
      await loadStatus();
    } catch (e) {
      message.error(`操作失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToken = () => {
    if (status.token) {
      navigator.clipboard.writeText(status.token);
      message.success("Token 已复制");
    }
  };

  const handleRequestPermission = async (
    type: "screenCapture" | "accessibility",
  ) => {
    try {
      const result = await window.electronAPI?.guiAgent.requestPermission(type);
      if (result?.success) {
        message.success("权限请求已发送");
        await loadPermissions();
      } else {
        message.error(result?.error || "请求失败");
      }
    } catch (e) {
      message.error(`请求失败: ${e}`);
    }
  };

  const handleOpenPermissionSettings = async (
    type: "screenCapture" | "accessibility",
  ) => {
    try {
      await window.electronAPI?.guiAgent.openPermissionSettings(type);
    } catch (e) {
      message.error(`打开设置失败: ${e}`);
    }
  };

  const renderPermissionBadge = (state: GuiPermissionState) => {
    const info = permissionLabel[state] || permissionLabel.unknown;
    return <Badge color={info.color} text={info.text} />;
  };

  return (
    <div style={{ padding: 16 }}>
      <Title level={4}>
        <DesktopOutlined /> GUI Agent 设置
      </Title>
      <Text type="secondary">
        启用后，Agent 可通过本地 HTTP 接口进行屏幕截图和键鼠操作
      </Text>

      <Divider />

      {/* 服务状态 */}
      <Card size="small" title="服务状态" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Space>
              <Badge status={status.running ? "success" : "default"} />
              <Text>{status.running ? "运行中" : "已停止"}</Text>
              {status.running && status.port && (
                <Text type="secondary">端口: {status.port}</Text>
              )}
            </Space>
            <Button
              type={status.running ? "default" : "primary"}
              icon={status.running ? <StopOutlined /> : <PlayCircleOutlined />}
              loading={loading}
              onClick={handleStartStop}
              danger={status.running}
            >
              {status.running ? "停止" : "启动"}
            </Button>
          </div>

          {status.running && status.token && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Text type="secondary">Token:</Text>
              <Input.Password
                value={status.token}
                readOnly
                size="small"
                style={{ flex: 1, maxWidth: 360 }}
              />
              <Tooltip title="复制 Token">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={handleCopyToken}
                />
              </Tooltip>
            </div>
          )}

          {status.error && <Text type="danger">{status.error}</Text>}
        </Space>
      </Card>

      {/* 配置 */}
      <Card size="small" title="基本配置" style={{ marginBottom: 16 }}>
        <Form layout="vertical" size="small">
          <Form.Item label="启用 GUI Agent">
            <Switch
              checked={config.enabled}
              onChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </Form.Item>

          <Form.Item label="HTTP 端口">
            <InputNumber
              min={1024}
              max={65535}
              value={config.port}
              onChange={(v) => v && setConfig({ ...config, port: v })}
              style={{ width: 120 }}
            />
          </Form.Item>

          <Form.Item label="速率限制 (ops/s)">
            <InputNumber
              min={1}
              max={100}
              value={config.rateLimit}
              onChange={(v) => v && setConfig({ ...config, rateLimit: v })}
              style={{ width: 120 }}
            />
          </Form.Item>

          <Divider plain>截图设置</Divider>

          <Form.Item label={`缩放比例: ${config.screenshotScale}`}>
            <Slider
              min={0.1}
              max={1.0}
              step={0.1}
              value={config.screenshotScale}
              onChange={(v) => setConfig({ ...config, screenshotScale: v })}
            />
          </Form.Item>

          <Form.Item label="输出格式">
            <Select
              value={config.screenshotFormat}
              onChange={(v) => setConfig({ ...config, screenshotFormat: v })}
              style={{ width: 120 }}
            >
              <Select.Option value="jpeg">JPEG</Select.Option>
              <Select.Option value="png">PNG</Select.Option>
            </Select>
          </Form.Item>

          {config.screenshotFormat === "jpeg" && (
            <Form.Item label={`JPEG 质量: ${config.screenshotQuality}`}>
              <Slider
                min={10}
                max={100}
                step={5}
                value={config.screenshotQuality}
                onChange={(v) => setConfig({ ...config, screenshotQuality: v })}
              />
            </Form.Item>
          )}

          <Form.Item>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 平台权限 */}
      {permissions && (
        <Card
          size="small"
          title={
            <>
              <SafetyCertificateOutlined /> 平台权限
            </>
          }
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Space>
                <Text>屏幕截图</Text>
                {renderPermissionBadge(permissions.screenCapture)}
              </Space>
              {permissions.screenCapture !== "granted" &&
                permissions.screenCapture !== "not_needed" && (
                  <Space>
                    <Button
                      size="small"
                      onClick={() => handleRequestPermission("screenCapture")}
                    >
                      请求授权
                    </Button>
                    <Button
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() =>
                        handleOpenPermissionSettings("screenCapture")
                      }
                    >
                      打开设置
                    </Button>
                  </Space>
                )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Space>
                <Text>辅助功能（键鼠控制）</Text>
                {renderPermissionBadge(permissions.accessibility)}
              </Space>
              {permissions.accessibility !== "granted" &&
                permissions.accessibility !== "not_needed" && (
                  <Space>
                    <Button
                      size="small"
                      onClick={() => handleRequestPermission("accessibility")}
                    >
                      请求授权
                    </Button>
                    <Button
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() =>
                        handleOpenPermissionSettings("accessibility")
                      }
                    >
                      打开设置
                    </Button>
                  </Space>
                )}
            </div>

            {permissions.platform === "linux" && (
              <div>
                <Text type="secondary">
                  显示服务器: {permissions.displayServer || "未知"}
                  {permissions.displayServer === "wayland" &&
                    " (Wayland 下部分功能受限)"}
                </Text>
                {permissions.xdotoolAvailable === false && (
                  <Text type="warning" style={{ display: "block" }}>
                    xdotool 未安装，键鼠控制不可用
                  </Text>
                )}
              </div>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
}

export default GUIAgentSettings;
