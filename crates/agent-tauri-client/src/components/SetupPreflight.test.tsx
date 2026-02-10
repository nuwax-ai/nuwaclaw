/**
 * SetupPreflight 组件测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupPreflight from "./SetupPreflight";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

// Ant Design Button 在 CJK 文本间插入空格，需要用 matcher 函数匹配
function findButtonByText(text: string) {
  const buttons = screen.getAllByRole("button");
  return buttons.find((btn) =>
    btn.textContent?.replace(/\s/g, "").includes(text),
  );
}

describe("SetupPreflight", () => {
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该在加载时显示检查中状态", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // 永不 resolve
    render(<SetupPreflight onComplete={mockOnComplete} />);
    expect(screen.getByText("正在检查运行环境...")).toBeInTheDocument();
  });

  it("应该在所有检查通过时显示继续按钮", async () => {
    mockInvoke.mockResolvedValueOnce({
      passed: true,
      checks: [
        {
          id: "port_60000",
          name: "端口 60000",
          category: "Network",
          status: "Pass",
          message: "端口 60000 可用",
          fix_hint: null,
          auto_fixable: false,
        },
      ],
    });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(
        screen.getByText("所有检查已通过，可以继续安装"),
      ).toBeInTheDocument();
    });

    const continueBtn = findButtonByText("继续");
    expect(continueBtn).toBeDefined();
  });

  it("应该在有失败项时显示问题数量", async () => {
    mockInvoke.mockResolvedValueOnce({
      passed: false,
      checks: [
        {
          id: "port_60000",
          name: "端口 60000",
          category: "Network",
          status: "Fail",
          message: "端口 60000 已被占用",
          fix_hint: "请关闭占用端口的进程",
          auto_fixable: false,
        },
        {
          id: "dir_workspace",
          name: "目录: 工作区",
          category: "Directory",
          status: "Pass",
          message: "工作区目录可写",
          fix_hint: null,
          auto_fixable: false,
        },
      ],
    });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByText(/发现 1 个问题/)).toBeInTheDocument();
    });

    // 应显示跳过并继续按钮
    const skipBtn = findButtonByText("跳过并继续");
    expect(skipBtn).toBeDefined();
  });

  it("点击继续按钮应触发 onComplete", async () => {
    mockInvoke.mockResolvedValueOnce({
      passed: true,
      checks: [],
    });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(findButtonByText("继续")).toBeDefined();
    });

    const btn = findButtonByText("继续")!;
    await userEvent.click(btn);
    expect(mockOnComplete).toHaveBeenCalledTimes(1);
  });

  it("应该在出错时显示错误信息", async () => {
    mockInvoke.mockRejectedValueOnce("后端预检失败");

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByText("环境预检失败")).toBeInTheDocument();
    });

    expect(screen.getByText("后端预检失败")).toBeInTheDocument();
  });

  it("点击重新检查应再次调用 preflight_check", async () => {
    mockInvoke
      .mockResolvedValueOnce({ passed: true, checks: [] })
      .mockResolvedValueOnce({ passed: true, checks: [] });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      const recheck = findButtonByText("重新检查");
      expect(recheck).toBeDefined();
    });

    const recheckBtn = findButtonByText("重新检查")!;
    await userEvent.click(recheckBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    expect(mockInvoke).toHaveBeenCalledWith("preflight_check");
  });

  it("应该正确显示各检查项", async () => {
    mockInvoke.mockResolvedValueOnce({
      passed: false,
      checks: [
        {
          id: "port_60000",
          name: "端口 60000 (文件服务)",
          category: "Network",
          status: "Pass",
          message: "端口可用",
          fix_hint: null,
          auto_fixable: false,
        },
        {
          id: "dep_node",
          name: "Node.js",
          category: "Dependency",
          status: "Warn",
          message: "Node.js 未安装",
          fix_hint: "请安装 Node.js",
          auto_fixable: false,
        },
      ],
    });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByText("端口 60000 (文件服务)")).toBeInTheDocument();
      expect(screen.getByText("Node.js")).toBeInTheDocument();
    });

    // 验证类别标签
    expect(screen.getByText("网络")).toBeInTheDocument();
    expect(screen.getByText("依赖")).toBeInTheDocument();

    // 验证 fix_hint 显示（仅非 Pass 项）
    expect(screen.getByText("请安装 Node.js")).toBeInTheDocument();
  });

  it("应该在错误时点击重新检查恢复", async () => {
    mockInvoke
      .mockRejectedValueOnce("网络错误")
      .mockResolvedValueOnce({ passed: true, checks: [] });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByText("环境预检失败")).toBeInTheDocument();
    });

    const recheckBtn = findButtonByText("重新检查")!;
    await userEvent.click(recheckBtn);

    await waitFor(() => {
      expect(findButtonByText("继续")).toBeDefined();
    });
  });

  it("应该在有警告但无失败时显示正确文案", async () => {
    mockInvoke.mockResolvedValueOnce({
      passed: true, // Warn 不阻塞 passed
      checks: [
        {
          id: "dep_uv",
          name: "uv",
          category: "Dependency",
          status: "Warn",
          message: "uv 未安装",
          fix_hint: "请安装 uv",
          auto_fixable: false,
        },
      ],
    });

    render(<SetupPreflight onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(
        screen.getByText("所有检查已通过，可以继续安装"),
      ).toBeInTheDocument();
    });

    // Warn 项仍显示 fix_hint
    expect(screen.getByText("请安装 uv")).toBeInTheDocument();
  });
});
