/**
 * 初始化向导完整流程测试页面
 *
 * 测试覆盖：
 * 1. 依赖检测/安装进度
 * 2. 基础配置（端口、工作区目录）
 * 3. 账号登录
 *
 * 通过 Mock API 模拟各阶段效果，无需真实环境
 */

import { useState, useMemo } from "react";
import { Button, Select, Space, Card, Divider, Radio, Switch, message } from "antd";
import SetupWizard from "../setup/SetupWizard";
import type { MockDependenciesApi } from "../setup/SetupDependencies";

// ==================== 测试场景预设 ====================
type TestScenario = "full-install" | "deps-ready" | "already-logged-in" | "error-flow";

const SCENARIO_CONFIG: Record<TestScenario, {
  label: string;
  description: string;
  depsPhase: "checking" | "installing" | "completed" | "error" | "system-deps-missing";
}> = {
  "full-install": {
    label: "完整安装流程",
    description: "从依赖检测到安装完成的全流程",
    depsPhase: "installing",
  },
  "deps-ready": {
    label: "依赖已就绪",
    description: "跳过依赖安装，直接进入配置",
    depsPhase: "completed",
  },
  "already-logged-in": {
    label: "已登录状态",
    description: "显示已登录的快捷流程",
    depsPhase: "completed",
  },
  "error-flow": {
    label: "安装失败",
    description: "模拟安装失败场景",
    depsPhase: "error",
  },
};

// ==================== Mock 数据 ====================
const MOCK_DEPS_INSTALLING = [
  { name: "uv", displayName: "uv", type: "system" as const, description: "Python 包管理器", status: "installed" as const, version: "0.5.0" },
  { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local" as const, description: "ACP 协议实现", status: "installing" as const },
  { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local" as const, description: "Nuwaxcode 引擎", status: "missing" as const },
  { name: "nuwax-file-server", displayName: "File Server", type: "npm-local" as const, description: "本地文件服务", status: "missing" as const },
  { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local" as const, description: "MCP 聚合代理", status: "missing" as const },
];

const MOCK_DEPS_COMPLETED = [
  { name: "uv", displayName: "uv", type: "system" as const, description: "Python 包管理器", status: "installed" as const, version: "0.5.0" },
  { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local" as const, description: "ACP 协议实现", status: "installed" as const, version: "1.0.0" },
  { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local" as const, description: "Nuwaxcode 引擎", status: "installed" as const, version: "1.0.0" },
  { name: "nuwax-file-server", displayName: "File Server", type: "npm-local" as const, description: "本地文件服务", status: "installed" as const, version: "1.0.0" },
  { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local" as const, description: "MCP 聚合代理", status: "installed" as const, version: "1.0.0" },
];

const MOCK_DEPS_ERROR = [
  { name: "uv", displayName: "uv", type: "system" as const, description: "Python 包管理器", status: "installed" as const, version: "0.5.0" },
  { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local" as const, description: "ACP 协议实现", status: "installed" as const, version: "1.0.0" },
  { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local" as const, description: "Nuwaxcode 引擎", status: "error" as const, errorMessage: "网络超时，安装失败" },
  { name: "nuwax-file-server", displayName: "File Server", type: "npm-local" as const, description: "本地文件服务", status: "missing" as const },
  { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local" as const, description: "MCP 聚合代理", status: "missing" as const },
];

export default function SetupWizardTest() {
  const [scenario, setScenario] = useState<TestScenario>("full-install");
  const [key, setKey] = useState(0);
  const [showReal, setShowReal] = useState(false);
  const [simulateSlow, setSimulateSlow] = useState(false);

  // 根据 scenario 创建 mock API
  const mockApi = useMemo((): MockDependenciesApi | undefined => {
    if (showReal) return undefined; // 使用真实 API

    const delay = simulateSlow ? 1500 : 300;

    const getDepsForPhase = () => {
      switch (SCENARIO_CONFIG[scenario].depsPhase) {
        case "installing": return MOCK_DEPS_INSTALLING;
        case "error": return MOCK_DEPS_ERROR;
        case "completed": return MOCK_DEPS_COMPLETED;
        default: return [];
      }
    };

    return {
      checkAll: async () => {
        await new Promise((r) => setTimeout(r, delay));
        return {
          success: true,
          results: getDepsForPhase().map((d) => ({
            ...d,
            minVersion: d.version,
            installVersion: "latest",
          })),
        };
      },
      checkUv: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { success: true, installed: true, bundled: true, version: "0.5.0" };
      },
      installPackage: async (name: string) => {
        await new Promise((r) => setTimeout(r, simulateSlow ? 2000 : 500));
        if (name === "nuwaxcode" && scenario === "error-flow") {
          return { success: false, error: "网络超时，安装失败" };
        }
        return { success: true, version: "1.0.0" };
      },
      openExternal: async () => {},
    };
  }, [scenario, showReal, simulateSlow]);

  // 场景切换时重置组件
  const handleScenarioChange = (value: TestScenario) => {
    setScenario(value);
    setKey((k) => k + 1);
  };

  const handleComplete = () => {
    message.success("向导完成！");
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <Card title="初始化向导完整流程测试" size="small">
        <Space direction="vertical" style={{ width: "100%" }} gap="middle">
          {/* 场景选择 */}
          <div>
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 500 }}>测试场景：</div>
            <Radio.Group
              value={scenario}
              onChange={(e) => handleScenarioChange(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            >
              {Object.entries(SCENARIO_CONFIG).map(([key, config]) => (
                <Radio.Button key={key} value={key}>
                  {config.label}
                </Radio.Button>
              ))}
            </Radio.Group>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>
              {SCENARIO_CONFIG[scenario].description}
            </div>
          </div>

          {/* 选项 */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Switch
                size="small"
                checked={simulateSlow}
                onChange={setSimulateSlow}
              />
              <span style={{ fontSize: 12 }}>慢速模拟</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Switch
                size="small"
                checked={showReal}
                onChange={(v) => {
                  setShowReal(v);
                  setKey((k) => k + 1);
                }}
              />
              <span style={{ fontSize: 12 }}>使用真实 API</span>
            </div>
          </div>

          {/* 快捷操作 */}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              size="small"
              onClick={() => {
                // 重置 setup 状态
                window.electronAPI?.settings.set("setup_state", null);
                message.info("已重置，刷新页面可重新进入向导");
              }}
            >
              重置向导状态
            </Button>
            <Button
              size="small"
              onClick={() => setKey((k) => k + 1)}
            >
              重新挂载
            </Button>
          </div>
        </Space>
      </Card>

      <Divider style={{ margin: "16px 0" }} />

      {/* 向导组件容器 */}
      <div
        style={{
          height: 600,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--color-bg-layout)",
        }}
      >
        <SetupWizard
          key={key}
          onComplete={handleComplete}
          mockApi={showReal ? undefined : mockApi}
          skipDependencyCheck={scenario === "deps-ready" || scenario === "already-logged-in"}
          mockLoggedIn={scenario === "already-logged-in"}
        />
      </div>

      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8, textAlign: "center" }}>
        提示：选择「依赖已就绪」场景可跳过依赖安装，直接测试配置和登录步骤
      </div>
    </div>
  );
}
