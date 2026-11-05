import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buttons: new Map<
    string,
    { onClick: () => Promise<void>; loading: boolean }
  >(),
  states: [] as unknown[],
  index: 0,
  exportZip: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useLayoutEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (index >= mocks.states.length) mocks.states.push(initial);
    return [
      mocks.states[index],
      (value: unknown) => {
        mocks.states[index] = value;
      },
    ];
  },
}));
vi.mock("antd", async () => {
  const { default: React } = await import("react");
  const Container = ({ children }: any) => <div>{children}</div>;
  return {
    Button: ({ children, onClick, loading }: any) => {
      mocks.buttons.set(children, { onClick, loading });
      return <button>{children}</button>;
    },
    Select: () => null,
    Switch: () => null,
    Empty: () => null,
    Spin: () => null,
    Tag: Container,
    message: { success: mocks.success, error: mocks.error },
  };
});
vi.mock("@ant-design/icons", () => ({
  DownloadOutlined: () => null,
  ReloadOutlined: () => null,
  VerticalAlignBottomOutlined: () => null,
}));
vi.mock("@renderer/services/core/i18n", () => ({ t: (key: string) => key }));
import LogViewer from "./LogViewer";

function render() {
  mocks.index = 0;
  return renderToStaticMarkup(<LogViewer />);
}
const button = () => mocks.buttons.get("Claw.LogViewer.export")!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.clear();
  mocks.states.length = 0;
  vi.stubGlobal("window", {
    electronAPI: { log: { exportZip: mocks.exportZip } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("log export button", () => {
  it("按钮位于打开目录旁，等待保存和压缩时显示加载，完成后提示成功", async () => {
    let finish!: (result: unknown) => void;
    mocks.exportZip.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const html = render();
    expect(html.indexOf("Claw.LogViewer.export")).toBeGreaterThan(
      html.indexOf("Claw.LogViewer.openDir"),
    );
    const task = button().onClick();
    render();
    expect(button().loading).toBe(true);
    finish({ success: true, filePath: "/downloads/logs.zip" });
    await task;
    render();
    expect(button().loading).toBe(false);
    expect(mocks.exportZip).toHaveBeenCalledWith();
    expect(mocks.success).toHaveBeenCalledWith("Claw.LogViewer.exportSuccess");
  });

  it("取消保存保持安静，返回失败或 IPC 异常时提示重试并恢复按钮", async () => {
    mocks.exportZip.mockResolvedValueOnce({ success: false, canceled: true });
    render();
    await button().onClick();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    mocks.exportZip.mockResolvedValueOnce({
      success: false,
      error: "disk full",
    });
    await button().onClick();
    expect(mocks.error).toHaveBeenCalledWith("Claw.LogViewer.exportFailed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.exportZip.mockRejectedValueOnce(new Error("IPC unavailable"));
    await button().onClick();
    render();
    expect(button().loading).toBe(false);
    expect(mocks.error).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
