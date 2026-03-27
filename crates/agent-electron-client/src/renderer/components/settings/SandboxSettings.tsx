/**
 * 沙箱设置 UI 组件
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import React, { useState, useEffect } from "react";
import { Switch, Select, Card, Form, Button, Alert } from "antd";
import type { SandboxConfig, SandboxMode } from "@shared/types/sandbox";

const { Option } = Select;

export const SandboxSettings: React.FC = () => {
  const [config, setConfig] = useState<SandboxConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const cfg = await window.electron.invoke("sandbox:get-config");
    setConfig(cfg);
    setLoading(false);
  };

  const handleModeChange = (mode: SandboxMode) => {
    window.electron.invoke("sandbox:set-mode", mode);
    setConfig({ ...config!, mode });
  };

  if (loading || !config) return <div>Loading...</div>;

  return (
    <div className="sandbox-settings">
      <Card title="沙箱设置" bordered={false}>
        <Alert
          message="沙箱功能保护您的系统免受恶意代码影响"
          description="建议保持开启，除非您完全信任执行环境"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form layout="vertical">
          <Form.Item label="沙箱模式">
            <Select
              value={config.mode}
              onChange={handleModeChange}
              style={{ width: "100%" }}
            >
              <Option value="off">
                <div>
                  <strong>关闭</strong>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    直接执行，无保护（不推荐）
                  </div>
                </div>
              </Option>
              <Option value="on-demand">
                <div>
                  <strong>按需开启</strong>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    默认关闭，危险操作时询问
                  </div>
                </div>
              </Option>
              <Option value="non-main">
                <div>
                  <strong>非主会话开启 ⭐ 推荐</strong>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    主会话直接执行，其他会话使用沙箱
                  </div>
                </div>
              </Option>
              <Option value="all">
                <div>
                  <strong>全部开启</strong>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    所有会话都使用沙箱（最安全）
                  </div>
                </div>
              </Option>
            </Select>
          </Form.Item>

          <Form.Item label="网络访问">
            <Switch
              checked={config.network?.enabled}
              onChange={(v) => {
                const newConfig = {
                  ...config,
                  network: { ...config.network, enabled: v },
                };
                window.electron.invoke("sandbox:update-config", {
                  network: { enabled: v },
                });
                setConfig(newConfig);
              }}
            />
            <span style={{ marginLeft: 8 }}>
              {config.network?.enabled ? "已启用" : "已禁用"}
            </span>
          </Form.Item>

          <Form.Item label="审计日志">
            <Switch
              checked={config.preferences?.auditLogging}
              onChange={(v) => {
                window.electron.invoke("sandbox:update-config", {
                  preferences: { ...config.preferences, auditLogging: v },
                });
                setConfig({
                  ...config,
                  preferences: { ...config.preferences!, auditLogging: v },
                });
              }}
            />
            <span style={{ marginLeft: 8 }}>记录所有沙箱操作</span>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Button
            onClick={() => {
              window.electron.invoke("sandbox:reset-config");
              loadConfig();
            }}
          >
            恢复默认配置
          </Button>
        </div>
      </Card>
    </div>
  );
};
