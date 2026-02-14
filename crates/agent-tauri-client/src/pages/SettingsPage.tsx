/**
 * 设置页面
 */

import React, { useState, useEffect, useCallback, Suspense } from "react";
import {
  Card,
  Button,
  Switch,
  Form,
  Row,
  Col,
  Input,
  InputNumber,
  message,
  Modal,
  Alert,
  Spin,
} from "antd";
import { FolderOutlined, SaveOutlined, EditOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import { invoke } from "@tauri-apps/api/core";
import {
  getStep1Config,
  saveStep1Config,
  selectDirectory,
  type Step1Config,
} from "../services/setup";
import { restartAllServices } from "../services/dependencies";
import { IS_DEV, DevToolsPanel } from "../components/dev";

const { Text } = Typography;

export default function SettingsPage() {
  const [form] = Form.useForm<Step1Config>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [originalConfig, setOriginalConfig] = useState<Step1Config | null>(
    null,
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const config = await getStep1Config();
      form.setFieldsValue(config);
      setOriginalConfig(config);
    } catch (error) {
      console.error("加载配置失败:", error);
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  }, [form]);

  const loadAutoLaunchState = useCallback(async () => {
    try {
      const enabled = await invoke<boolean>("autolaunch_get");
      setAutoLaunch(enabled);
    } catch (error) {
      console.error("获取开机自启动状态失败:", error);
    }
  }, []);

  const loadLogDir = useCallback(async () => {
    try {
      const dir = await invoke<string>("log_dir_get");
      setLogDir(dir);
    } catch (error) {
      console.error("获取日志目录失败:", error);
    }
  }, []);

  const handleOpenLogDir = async () => {
    try {
      await invoke<void>("open_log_directory");
    } catch (error) {
      console.error("打开日志目录失败:", error);
      message.error("打开日志目录失败");
    }
  };

  useEffect(() => {
    loadConfig();
    loadAutoLaunchState();
    loadLogDir();
  }, [loadConfig, loadAutoLaunchState, loadLogDir]);

  const handleSelectWorkspace = async () => {
    const dir = await selectDirectory();
    if (dir) {
      form.setFieldValue("workspaceDir", dir);
    }
  };

  const handleCancelEdit = () => {
    if (originalConfig) {
      form.setFieldsValue(originalConfig);
    }
    setEditing(false);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      Modal.confirm({
        title: "保存配置",
        content: "保存后需要重启服务才能生效，确定保存吗？",
        okText: "保存并重启",
        cancelText: "取消",
        onOk: async () => {
          setSaving(true);
          try {
            await saveStep1Config(values);
            setOriginalConfig(values);
            setEditing(false);
            message.loading("正在重启服务...", 0);
            await restartAllServices();
            message.destroy();
            message.success("配置已保存，服务已重启");
          } catch (error) {
            message.destroy();
            message.error("保存配置失败");
          } finally {
            setSaving(false);
          }
        },
      });
    } catch (error) {
      // 表单验证失败
    }
  };

  const handleAutoLaunchChange = async (checked: boolean) => {
    try {
      await invoke("autolaunch_set", { enabled: checked });
      setAutoLaunch(checked);
      message.success(checked ? "已开启开机自启动" : "已关闭开机自启动");
    } catch (error) {
      message.error("设置失败，请在系统设置中手动配置");
      setAutoLaunch(!checked);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div>
      {/* 服务配置 */}
      <div className="section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
            服务配置
          </span>
          {editing ? (
            <div style={{ display: "flex", gap: 6 }}>
              <Button size="small" onClick={handleCancelEdit} disabled={saving}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(true)}
            >
              编辑
            </Button>
          )}
        </div>

        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
            padding: 16,
          }}
        >
          <Form form={form} layout="vertical" disabled={!editing} size="small">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="agentPort"
                  label="Agent 端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="proxyPort"
                  label="代理服务端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="fileServerPort"
                  label="文件服务端口"
                  rules={[{ required: true, message: "请输入端口" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="workspaceDir"
              label="工作区目录"
              rules={[{ required: true, message: "请选择工作区目录" }]}
              style={{ marginBottom: 0 }}
            >
              <Input
                placeholder="点击选择目录"
                readOnly
                addonAfter={
                  editing && (
                    <Button
                      type="text"
                      size="small"
                      icon={<FolderOutlined />}
                      onClick={handleSelectWorkspace}
                      style={{ padding: 0 }}
                    >
                      选择
                    </Button>
                  )
                }
              />
            </Form.Item>
          </Form>

          {!editing && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: "#a1a1aa",
              }}
            >
              修改配置后需要重启服务才能生效
            </div>
          )}
        </div>
      </div>

      {/* 系统设置 */}
      <div className="section" style={{ marginTop: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "#18181b",
            marginBottom: 10,
          }}
        >
          系统
        </div>
        <div
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          {/* 开机自启 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid #f4f4f5",
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: "#18181b" }}>开机自启动</div>
              <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
                系统启动时自动运行
              </div>
            </div>
            <Switch
              size="small"
              checked={autoLaunch}
              onChange={handleAutoLaunchChange}
            />
          </div>

          {/* 日志目录 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: "#18181b" }}>日志目录</div>
              <div
                style={{
                  fontSize: 11,
                  color: "#a1a1aa",
                  marginTop: 1,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {logDir || "加载中..."}
              </div>
            </div>
            <Button
              size="small"
              icon={<FolderOutlined />}
              onClick={handleOpenLogDir}
              disabled={!logDir}
            >
              打开
            </Button>
          </div>
        </div>
      </div>

      {/* 开发工具 */}
      {IS_DEV && DevToolsPanel && (
        <div style={{ marginTop: 20 }}>
          <Suspense
            fallback={
              <div style={{ textAlign: "center", padding: 20 }}>
                <Spin size="small" />
              </div>
            }
          >
            <DevToolsPanel />
          </Suspense>
        </div>
      )}
    </div>
  );
}
