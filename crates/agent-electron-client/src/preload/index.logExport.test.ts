import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: null as any, invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      if (name === "electronAPI") mocks.api = api;
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn(),
  },
}));
import "./index";

describe("log export preload bridge", () => {
  it("只调用导出 IPC，不向主进程传入页面提供的目录", async () => {
    const result = { success: true, filePath: "/downloads/logs.zip" };
    mocks.invoke.mockResolvedValueOnce(result);
    expect(await mocks.api.log.exportZip("/other-product/logs")).toEqual(
      result,
    );
    expect(mocks.invoke).toHaveBeenCalledWith("log:exportZip");
  });
});
