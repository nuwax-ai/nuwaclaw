import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { HandlerContext } from "@shared/types/ipc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  save: vi.fn(),
  archive: vi.fn(),
  error: vi.fn(),
  packaged: false,
  url: "file:///app/index.html",
}));
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) =>
      name === "home" ? "/fixture/home" : "/downloads",
    get isPackaged() {
      return mocks.packaged;
    },
  },
  dialog: { showSaveDialog: mocks.save },
  ipcMain: {
    handle: (name: string, handler: any) => mocks.handlers.set(name, handler),
  },
}));
vi.mock("electron-log", () => ({ default: { error: mocks.error } }));
vi.mock("../services/utils/logArchive", () => ({
  exportLogArchive: mocks.archive,
}));
vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

import { APP_DATA_DIR_NAME, APP_NAME_IDENTIFIER } from "@shared/constants";
import { registerLogExportHandler } from "./logExportHandler";

const frame = {};
const webContents = { mainFrame: frame, getURL: () => mocks.url };
const host = { webContents };
const ctx = { getMainWindow: () => host } as unknown as HandlerContext;
const event = { sender: webContents, senderFrame: frame };
const run = (sender = event, ...args: unknown[]) =>
  mocks.handlers.get("log:exportZip")!(sender, ...args);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.url = "file:///app/index.html";
  mocks.packaged = false;
  mocks.save.mockResolvedValue({
    canceled: false,
    filePath: "/downloads/feedback.zip",
  });
  mocks.archive.mockResolvedValue(undefined);
  registerLogExportHandler(ctx);
});

describe("shell log ZIP export IPC", () => {
  it("只能由壳主框架导出；网页、子框架和远程导航均不能触发保存", async () => {
    for (const untrusted of [
      { sender: {} as typeof webContents, senderFrame: frame },
      { sender: webContents, senderFrame: {} },
    ])
      expect(await run(untrusted)).toMatchObject({
        success: false,
        error: "Host renderer required",
      });
    mocks.url = "https://business.example";
    expect(await run()).toMatchObject({
      success: false,
      error: "Host renderer required",
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("开发模式允许 loopback；正式模式拒绝 loopback", async () => {
    mocks.url = "http://127.0.0.1:60173";
    expect(await run()).toMatchObject({ success: true });
    mocks.packaged = true;
    expect(await run()).toMatchObject({
      success: false,
      error: "Host renderer required",
    });
  });

  it("主进程固定当前产品的 logs，忽略调用者的路径并提供 ZIP 默认文件名", async () => {
    expect(await run(event, "/other-product/logs")).toEqual({
      success: true,
      filePath: "/downloads/feedback.zip",
    });
    expect(mocks.archive).toHaveBeenCalledWith(
      path.join("/fixture/home", APP_DATA_DIR_NAME, "logs"),
      "/downloads/feedback.zip",
    );
    const [parent, options] = mocks.save.mock.calls[0];
    expect(parent).toBe(host);
    expect(path.basename(options.defaultPath)).toMatch(
      new RegExp(`^${APP_NAME_IDENTIFIER}-logs-.*[.]zip$`),
    );
    expect(options.filters).toEqual([{ name: "ZIP", extensions: ["zip"] }]);
  });

  it("取消保存不创建压缩包，缺少扩展名时自动补 .zip", async () => {
    mocks.save.mockResolvedValueOnce({ canceled: true });
    expect(await run()).toEqual({ success: false, canceled: true });
    expect(mocks.archive).not.toHaveBeenCalled();
    mocks.save.mockResolvedValueOnce({
      canceled: false,
      filePath: "/downloads/feedback",
    });
    expect(await run()).toEqual({
      success: true,
      filePath: "/downloads/feedback.zip",
    });
  });

  it("保存窗口期间发生不可信导航时不读取日志", async () => {
    mocks.save.mockImplementationOnce(async () => {
      mocks.url = "https://untrusted.example";
      return { canceled: false, filePath: "/downloads/feedback.zip" };
    });
    expect(await run()).toMatchObject({
      success: false,
      error: "Host renderer required",
    });
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("阻止并发导出，失败后可重新尝试", async () => {
    let finish!: (value: unknown) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = run();
    expect(await run()).toMatchObject({
      success: false,
      error: "Log export already in progress",
    });
    finish({ canceled: true });
    await first;
    mocks.archive.mockRejectedValueOnce(new Error("Disk full"));
    expect(await run()).toMatchObject({
      success: false,
      error: "Error: Disk full",
    });
    expect(mocks.error).toHaveBeenCalled();
    expect(await run()).toMatchObject({ success: true });
  });
});
