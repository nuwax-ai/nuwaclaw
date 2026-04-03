/**
 * 开发工具面板
 *
 * 仅在开发模式下加载，提供：
 * - 重置初始化状态（重新显示设置向导）
 * - 清除登录状态
 * - 清除全部数据并刷新
 * - 查看应用存储数据
 * - MCP Proxy 服务管理（仅开发可见，不对正式用户开放）
 * - SetupDependencies UI 测试
 */

import { useState } from "react";
import { Button, Modal, Tag, message } from "antd";
import {
  ReloadOutlined,
  DeleteOutlined,
  ClearOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import { setupService } from "../../services/core/setup";
import { t } from "../../services/core/i18n";
import MCPSettings from "../settings/MCPSettings";
import SetupDependenciesTest from "./SetupDependenciesTest";
import SetupWizardTest from "./SetupWizardTest";

export default function DevToolsPanel() {
  const [storeData, setStoreData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [storeModalVisible, setStoreModalVisible] = useState(false);
  const [setupDepsTestVisible, setSetupDepsTestVisible] = useState(false);
  const [setupWizardTestVisible, setSetupWizardTestVisible] = useState(false);

  // 重置初始化
  const handleResetSetup = async () => {
    try {
      await setupService.resetSetup();
      message.success(t("Claw.DevTools.resetInitSuccess"));
    } catch {
      message.error(t("Claw.DevTools.resetFailed"));
    }
  };

  // 清除登录
  const handleClearAuth = async () => {
    try {
      await window.electronAPI?.settings.set("auth.username", null);
      await window.electronAPI?.settings.set("auth.password", null);
      await window.electronAPI?.settings.set("auth.config_key", null);
      await window.electronAPI?.settings.set("auth.user_info", null);
      await window.electronAPI?.settings.set("auth.online_status", null);
      message.success(t("Claw.DevTools.clearAuthSuccess"));
    } catch {
      message.error(t("Claw.DevTools.clearFailed"));
    }
  };

  // 清除全部并刷新
  const handleClearAll = () => {
    Modal.confirm({
      title: t("Claw.DevTools.clearAllData"),
      content: t("Claw.DevTools.clearAllDataConfirm"),
      okText: t("Claw.DevTools.clearAndReload"),
      okType: "danger",
      cancelText: t("Claw.Common.cancel"),
      onOk: async () => {
        try {
          await setupService.resetSetup();
          await window.electronAPI?.settings.set("auth.username", null);
          await window.electronAPI?.settings.set("auth.password", null);
          await window.electronAPI?.settings.set("auth.config_key", null);
          await window.electronAPI?.settings.set("auth.user_info", null);
          await window.electronAPI?.settings.set("auth.online_status", null);
          message.success(t("Claw.DevTools.clearedReloading"));
          setTimeout(() => window.location.reload(), 500);
        } catch {
          message.error(t("Claw.DevTools.clearFailed"));
        }
      },
    });
  };

  // 查看存储数据
  const handleViewStore = async () => {
    try {
      const keys = [
        "setup_state",
        "step1_config",
        "anthropic_api_key",
        "app_settings",
        "agent_config",
        "mcp_config",
        "lanproxy_config",
        "auth.username",
        "auth.password",
        "auth.config_key",
        "auth.saved_key",
        "auth.user_info",
        "auth.online_status",
        "lanproxy.server_host",
        "lanproxy.server_port",
      ];

      const data: Record<string, unknown> = {};
      for (const key of keys) {
        const value = await window.electronAPI?.settings.get(key);
        if (value !== null && value !== undefined) {
          // 敏感字段脱敏
          if (key === "auth.password" || key === "anthropic_api_key") {
            data[key] = "******";
          } else {
            data[key] = value;
          }
        }
      }
      setStoreData(data);
      setStoreModalVisible(true);
    } catch {
      message.error(t("Claw.DevTools.readStoreFailed"));
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
          {t("Claw.DevTools.title")}
        </span>
        <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>
          DEV
        </Tag>
      </div>

      <div
        style={{
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        {/* 重置初始化 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: "#18181b" }}>
              {t("Claw.DevTools.resetInit")}
            </div>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
              {t("Claw.DevTools.resetInitHint")}
            </div>
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleResetSetup}
          >
            {t("Claw.DevTools.reset")}
          </Button>
        </div>

        {/* 清除登录 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: "#18181b" }}>
              {t("Claw.DevTools.clearLogin")}
            </div>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
              {t("Claw.DevTools.clearLoginHint")}
            </div>
          </div>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={handleClearAuth}
          >
            {t("Claw.DevTools.clear")}
          </Button>
        </div>

        {/* 清除全部并刷新 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: "#18181b" }}>
              {t("Claw.DevTools.clearAll")}
            </div>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
              {t("Claw.DevTools.clearAllHint")}
            </div>
          </div>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={handleClearAll}
          >
            {t("Claw.DevTools.clearAllBtn")}
          </Button>
        </div>

        {/* 查看存储数据 */}
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <div>
            <div style={{ fontSize: 13, color: "#18181b" }}>
              {t("Claw.DevTools.storeData")}
            </div>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
              {t("Claw.DevTools.storeDataHint")}
            </div>
          </div>
          <Button
            size="small"
            icon={<DatabaseOutlined />}
            onClick={handleViewStore}
          >
            {t("Claw.DevTools.view")}
          </Button>
        </div>
      </div>

      {/* MCP Proxy 服务管理：仅开发模式展示，不对正式用户开放 */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
            {t("Claw.DevTools.mcpProxyService")}
          </span>
          <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>
            DEV
          </Tag>
        </div>
        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <MCPSettings />
        </div>
      </div>

      {/* 存储数据弹窗 */}
      <Modal
        title={t("Claw.DevTools.storeData")}
        open={storeModalVisible}
        onCancel={() => setStoreModalVisible(false)}
        footer={null}
        width={520}
      >
        {storeData && (
          <pre
            style={{
              fontSize: 11,
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 6,
              maxHeight: 400,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {JSON.stringify(storeData, null, 2)}
          </pre>
        )}
      </Modal>

      {/* SetupDependencies UI 测试入口 */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
            {t("Claw.DevTools.uiTest")}
          </span>
          <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
            TEST
          </Tag>
        </div>
        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ ...rowStyle }}>
            <div>
              <div style={{ fontSize: 13, color: "#18181b" }}>
                {t("Claw.DevTools.setupDepsWizard")}
              </div>
              <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
                {t("Claw.DevTools.setupDepsWizardHint")}
              </div>
            </div>
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => setSetupDepsTestVisible(true)}
            >
              {t("Claw.DevTools.test")}
            </Button>
          </div>
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <div>
              <div style={{ fontSize: 13, color: "#18181b" }}>
                {t("Claw.DevTools.fullInitFlow")}
              </div>
              <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
                {t("Claw.DevTools.fullInitFlowHint")}
              </div>
            </div>
            <Button
              size="small"
              type="primary"
              icon={<ExperimentOutlined />}
              onClick={() => setSetupWizardTestVisible(true)}
            >
              {t("Claw.DevTools.test")}
            </Button>
          </div>
        </div>
      </div>

      {/* SetupDependencies 测试弹窗 */}
      <Modal
        title={t("Claw.DevTools.setupDepsUiTest")}
        open={setupDepsTestVisible}
        onCancel={() => setSetupDepsTestVisible(false)}
        footer={null}
        width={680}
        styles={{
          body: {
            maxHeight: "70vh",
            overflow: "auto",
            padding: 0,
          },
        }}
      >
        <SetupDependenciesTest />
      </Modal>

      {/* SetupWizardTest 测试弹窗 */}
      <Modal
        title={t("Claw.DevTools.setupWizardFlowTest")}
        open={setupWizardTestVisible}
        onCancel={() => setSetupWizardTestVisible(false)}
        footer={null}
        width={800}
        styles={{
          body: {
            maxHeight: "80vh",
            overflow: "auto",
            padding: 0,
          },
        }}
      >
        <SetupWizardTest />
      </Modal>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid #f4f4f5",
};
