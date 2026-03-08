/**
 * SetupDependencies UI 测试页面
 *
 * 仅开发环境使用，用于测试初始化安装向导的各个阶段 UI 效果
 * 通过 mockApi props 注入 Mock 数据，不修改全局对象
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { Button, Select, Space, Card, Divider } from "antd";
import SetupDependencies, {
  type InstallPhase,
  type DisplayDependencyItem,
  type MockDependenciesApi,
} from "../setup/SetupDependencies";

// ==================== Mock 预设 ====================
const MOCK_PRESETS: Record<string, { phase: InstallPhase; deps: DisplayDependencyItem[] }> = {
  checking: {
    phase: "checking",
    deps: [],
  },
  systemMissing: {
    phase: "system-deps-missing",
    deps: [
      {
        name: "uv",
        displayName: "uv",
        type: "system",
        description: "Python 包管理器",
        status: "missing",
        requiredVersion: ">= 0.5.0",
        installUrl: "https://docs.astral.sh/uv/getting-started/installation/",
      },
    ],
  },
  installing: {
    phase: "installing",
    deps: [
      { name: "uv", displayName: "uv", type: "system", description: "Python 包管理器", status: "installed", version: "0.5.0" },
      { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local", description: "Claude Code ACP 协议实现", status: "installing" },
      { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local", description: "Nuwaxcode ACP 协议实现", status: "missing" },
      { name: "nuwax-file-server", displayName: "File Server", type: "npm-local", description: "本地文件服务", status: "missing" },
      { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local", description: "MCP 协议聚合代理", status: "missing" },
    ],
  },
  completed: {
    phase: "completed",
    deps: [
      { name: "uv", displayName: "uv", type: "system", description: "Python 包管理器", status: "installed", version: "0.5.0" },
      { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local", description: "Claude Code ACP 协议实现", status: "installed", version: "1.0.0" },
      { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local", description: "Nuwaxcode ACP 协议实现", status: "installed", version: "1.0.0" },
      { name: "nuwax-file-server", displayName: "File Server", type: "npm-local", description: "本地文件服务", status: "installed", version: "1.0.0" },
      { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local", description: "MCP 协议聚合代理", status: "installed", version: "1.0.0" },
    ],
  },
  error: {
    phase: "error",
    deps: [
      { name: "uv", displayName: "uv", type: "system", description: "Python 包管理器", status: "installed", version: "0.5.0" },
      { name: "claude-code-acp-ts", displayName: "Claude Code ACP", type: "npm-local", description: "Claude Code ACP 协议实现", status: "installed", version: "1.0.0" },
      { name: "nuwaxcode", displayName: "Nuwaxcode", type: "npm-local", description: "Nuwaxcode ACP 协议实现", status: "error", errorMessage: "网络超时，安装失败" },
      { name: "nuwax-file-server", displayName: "File Server", type: "npm-local", description: "本地文件服务", status: "missing" },
      { name: "nuwax-mcp-stdio-proxy", displayName: "MCP Proxy", type: "npm-local", description: "MCP 协议聚合代理", status: "missing" },
    ],
  },
};

export default function SetupDependenciesTest() {
  const [preset, setPreset] = useState<string>("installing");
  const [autoPlay, setAutoPlay] = useState(false);
  const [key, setKey] = useState(0); // 用于强制重新挂载组件
  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);

  const presetOptions = [
    { label: "检测中", value: "checking" },
    { label: "系统依赖缺失", value: "systemMissing" },
    { label: "安装中", value: "installing" },
    { label: "安装完成", value: "completed" },
    { label: "安装失败", value: "error" },
  ];

  // 创建 mock API（使用 useMemo 避免不必要的重建）
  const mockApi: MockDependenciesApi = useMemo(() => ({
    checkAll: async () => {
      const presetData = MOCK_PRESETS[preset];
      return {
        success: true,
        results: presetData?.deps.map((d) => ({
          name: d.name,
          displayName: d.displayName,
          type: d.type,
          description: d.description,
          status: d.status,
          version: d.version,
          minVersion: d.requiredVersion?.replace(">= ", ""),
          errorMessage: d.errorMessage,
          installVersion: d.installVersion,
        })) || [],
      };
    },
    checkUv: async () => {
      const presetData = MOCK_PRESETS[preset];
      const uv = presetData?.deps.find((d) => d.name === "uv");
      return {
        success: true,
        installed: uv?.status === "installed",
        version: uv?.version,
        bundled: true,
      };
    },
    installPackage: async (name: string, options?: { version?: string }) => {
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));
      if (name === "nuwaxcode" && Math.random() > 0.7) {
        return { success: false, error: "网络超时，安装失败" };
      }
      return { success: true, version: options?.version || "1.0.0" };
    },
    openExternal: async () => {},
  }), [preset]);

  // 自动播放
  useEffect(() => {
    if (autoPlay) {
      const phases = ["checking", "installing", "completed"];
      let index = phases.indexOf(preset);

      autoPlayRef.current = setInterval(() => {
        index = (index + 1) % phases.length;
        setPreset(phases[index]);
        setKey((k) => k + 1); // 强制重新挂载组件
      }, 2500);

      return () => {
        if (autoPlayRef.current) {
          clearInterval(autoPlayRef.current);
        }
      };
    }
  }, [autoPlay, preset]);

  const currentPhase = MOCK_PRESETS[preset]?.phase;

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <Card title="SetupDependencies UI 测试" size="small">
        <Space wrap>
          <span style={{ fontSize: 12 }}>阶段：</span>
          <Select
            size="small"
            value={preset}
            onChange={(value) => {
              setPreset(value);
              setKey((k) => k + 1); // 切换时重新挂载
            }}
            options={presetOptions}
            style={{ width: 160 }}
            disabled={autoPlay}
          />
          <Button
            size="small"
            type={autoPlay ? "primary" : "default"}
            onClick={() => setAutoPlay(!autoPlay)}
          >
            {autoPlay ? "停止" : "自动播放"}
          </Button>
        </Space>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>
          当前: <b>{currentPhase}</b>
        </div>
      </Card>

      <Divider style={{ margin: "16px 0" }} />

      {/* 被测组件 - 使用 key 强制重新挂载 */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: 16,
          background: "var(--color-bg-container)",
        }}
      >
        <SetupDependencies
          key={key}
          mockApi={mockApi}
          onComplete={() => {
            console.log("[Test] onComplete called");
          }}
        />
      </div>
    </div>
  );
}
