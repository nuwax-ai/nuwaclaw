/**
 * 初始化向导 - 基础设置
 */

import React, { useState, useEffect } from "react";
import {
  Form,
  Input,
  InputNumber,
  Button,
  Typography,
  message,
  Alert,
} from "antd";
import { FolderOutlined, SwapOutlined } from "@ant-design/icons";
import {
  saveStep1Config,
  getStep1Config,
  selectDirectory,
  type Step1Config,
} from "../services/setup";
import { logout, getCurrentAuth } from "../services/auth";
import { DEFAULT_SETUP_STATE } from "../services/store";
import {
  DEFAULT_AGENT_PORT,
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_PROXY_PORT,
} from "../constants";

const { Text } = Typography;

/**
 * 判断是否为绝对路径（跨平台：Unix / Windows 盘符与 UNC）
 * - Unix: 以 / 开头
 * - Windows: 盘符 X: 或 X:\、X:/，或 UNC \\host\share
 */
function isAbsolutePath(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  // Unix 绝对路径
  if (s.startsWith("/")) return true;
  // Windows UNC
  if (s.startsWith("\\\\") || s.startsWith("//")) return true;
  // Windows 盘符：X: 或 X:\ 或 X:/
  if (/^[A-Za-z]:[/\\]?/.test(s)) return true;
  return false;
}

/**
 * 规范化路径字符串：去除首尾空白与引号，去掉末尾多余的分隔符（/ 或 \）
 */
function normalizePathInput(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (trimmed.length <= 1) return trimmed;
  // 去掉末尾的 / 或 \（保留至少一个字符，避免把 "C:\" 清空）
  return trimmed.replace(/[/\\]+$/, "");
}

interface SetupStep1Props {
  onComplete: () => void;
}

type Step1FormValues = Omit<Step1Config, "serverHost">;

export default function SetupStep1({ onComplete }: SetupStep1Props) {
  const [form] = Form.useForm<Step1FormValues>();
  const [loading, setLoading] = useState(false);
  const [selectingDir, setSelectingDir] = useState(false);
  const [statusHint, setStatusHint] = useState<string>("");
  const [statusType, setStatusType] = useState<"info" | "error">("info");

  const showStatus = (text: string, type: "info" | "error" = "info") => {
    setStatusHint(text);
    setStatusType(type);
    setTimeout(() => setStatusHint(""), 1500);
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getStep1Config();
        form.setFieldsValue(config);
      } catch (error) {
        form.setFieldsValue({
          agentPort: DEFAULT_SETUP_STATE.agentPort,
          fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
          proxyPort: DEFAULT_SETUP_STATE.proxyPort,
          workspaceDir: DEFAULT_SETUP_STATE.workspaceDir,
        });
      }
    };
    loadConfig();
  }, [form]);

  const handleSelectDir = async () => {
    setSelectingDir(true);
    try {
      const dir = await selectDirectory();
      if (dir) {
        form.setFieldValue("workspaceDir", dir);
        showStatus("已选择目录");
      }
    } catch (error) {
      message.error("选择目录失败");
    } finally {
      setSelectingDir(false);
    }
  };

  const handleSubmit = async (values: Step1FormValues) => {
    setLoading(true);
    try {
      const currentConfig = await getStep1Config();
      await saveStep1Config({
        ...values,
        // 基础设置页不再编辑域名，沿用当前已保存值
        serverHost: currentConfig.serverHost,
      });
      try {
        const auth = await getCurrentAuth();
        if (auth.isLoggedIn) await logout();
      } catch {
        // logout failure is non-critical during config save
      }
      onComplete();
    } catch (error) {
      message.error("保存配置失败");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    form.setFieldsValue({
      agentPort: DEFAULT_SETUP_STATE.agentPort,
      fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
      proxyPort: DEFAULT_SETUP_STATE.proxyPort,
      workspaceDir: "",
    });
    showStatus("已重置为默认值");
  };

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "#18181b",
          marginBottom: 16,
        }}
      >
        基础设置
      </div>

      {statusHint && (
        <Alert
          message={statusHint}
          type={statusType}
          showIcon
          style={{ marginBottom: 12, padding: "4px 10px", fontSize: 12 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        size="small"
        onFinish={handleSubmit}
        onFinishFailed={(info) => {
          const first = info.errorFields?.[0]?.errors?.[0];
          if (first) showStatus(first, "error");
        }}
        initialValues={{
          agentPort: DEFAULT_SETUP_STATE.agentPort,
          fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
          proxyPort: DEFAULT_SETUP_STATE.proxyPort,
          workspaceDir: "",
        }}
      >
        <div
          style={{
            background: "#f4f4f5",
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: 500 }}>端口配置</Text>
            <Button
              type="link"
              size="small"
              onClick={() => {
                form.setFieldsValue({
                  agentPort: DEFAULT_SETUP_STATE.agentPort,
                  fileServerPort: DEFAULT_SETUP_STATE.fileServerPort,
                  proxyPort: DEFAULT_SETUP_STATE.proxyPort,
                });
                showStatus("已恢复默认端口");
              }}
              style={{ padding: 0, height: "auto", fontSize: 12 }}
            >
              恢复默认
            </Button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Form.Item
              name="agentPort"
              label="Agent"
              rules={[
                { required: true, message: "请输入" },
                { type: "number", min: 1, max: 65535, message: "1-65535" },
              ]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder={String(DEFAULT_AGENT_PORT)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item
              name="fileServerPort"
              label="文件服务"
              rules={[
                { required: true, message: "请输入" },
                { type: "number", min: 1, max: 65535, message: "1-65535" },
              ]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder={String(DEFAULT_FILE_SERVER_PORT)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item
              name="proxyPort"
              label="代理"
              rules={[
                { required: true, message: "请输入" },
                { type: "number", min: 1, max: 65535, message: "1-65535" },
              ]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <InputNumber
                min={1}
                max={65535}
                placeholder={String(DEFAULT_PROXY_PORT)}
                style={{ width: "100%" }}
              />
            </Form.Item>
          </div>
        </div>

        <Form.Item
          name="workspaceDir"
          label="工作区目录"
          rules={[
            { required: true, message: "请选择工作区目录" },
            {
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                if (typeof value === "string" && isAbsolutePath(value))
                  return Promise.resolve();
                return Promise.reject(
                  new Error(
                    "请输入有效的绝对路径（如 /path/to/dir 或 C:\\path\\to\\dir）",
                  ),
                );
              },
            },
          ]}
        >
          <Input
            placeholder="选择本地目录..."
            onBlur={(e) => {
              const raw = e.target.value || "";
              const normalized = normalizePathInput(raw);
              if (normalized !== raw)
                form.setFieldValue("workspaceDir", normalized);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text) {
                form.setFieldValue("workspaceDir", normalizePathInput(text));
                e.preventDefault();
              }
            }}
            addonAfter={
              <Button
                type="link"
                onClick={handleSelectDir}
                loading={selectingDir}
                style={{ padding: 0 }}
              >
                浏览...
              </Button>
            }
          />
        </Form.Item>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid #f4f4f5",
          }}
        >
          <Button onClick={handleReset} icon={<SwapOutlined />} size="small">
            重置
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            下一步
          </Button>
        </div>
      </Form>
    </div>
  );
}
