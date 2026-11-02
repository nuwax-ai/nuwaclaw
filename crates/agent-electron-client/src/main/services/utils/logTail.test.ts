import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MAX_LOG_TAIL_BYTES, readLogTail } from "./logTail";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  logPath: "",
  error: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(name, handler);
    },
  },
  app: { isPackaged: false, getPath: () => path.dirname(mocks.logPath) },
  dialog: {},
  shell: {},
  systemPreferences: {},
  BrowserWindow: {},
}));
vi.mock("electron-log", () => ({
  default: {
    transports: { file: { getFile: () => ({ path: mocks.logPath }) } },
    error: mocks.error,
  },
}));
vi.mock("../../bootstrap/logConfig", () => ({
  LATEST_LOG_BASENAME: "latest.log",
}));
vi.mock("../autoUpdater", () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateState: vi.fn(),
  openReleasesPage: vi.fn(),
}));
vi.mock("../system/deviceId", () => ({ getDeviceId: vi.fn() }));
vi.mock("../system/macPermissions", () => ({
  openMacPrivacySettings: vi.fn(),
  isMacPrivacyPane: vi.fn(),
}));
vi.mock("../../window/trayManager", () => ({ getTrayManager: vi.fn() }));
vi.mock("../../window/autoLaunchManager", () => ({
  getAutoLaunchManager: vi.fn(),
}));
vi.mock("../i18n", () => ({ t: (key: string) => key }));

let directory: string;
let logPath: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "electron-log-tail-test-"),
  );
  logPath = path.join(directory, "main.log");
  mocks.logPath = logPath;
  mocks.handlers.clear();
  mocks.error.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function createLargeLog(tail: string) {
  const file = await fs.open(logPath, "w+");
  const size = 600 * 1024 * 1024;
  try {
    // 稀疏文件超过原报错的字符串上限，不分配 600 MiB 内容或磁盘块。
    await file.truncate(size);
    await file.write(
      Buffer.from(tail),
      0,
      Buffer.byteLength(tail),
      size - Buffer.byteLength(tail),
    );
  } finally {
    await file.close();
  }
}

describe("readLogTail", () => {
  it.each(["a\nb\nc\n", "a\nb\nc", "a\n\nb\n\nc\n\n"])(
    "读取最新非空行并保持分页顺序：%j",
    async (content) => {
      await fs.writeFile(logPath, content);
      expect(await readLogTail(logPath, 2)).toEqual(["b", "c"]);
      expect(await readLogTail(logPath, 2, 1)).toEqual(["a", "b"]);
      expect(await readLogTail(logPath, 2, 3)).toEqual([]);
      expect(await readLogTail(logPath, 2, 10)).toEqual([]);
    },
  );

  it("保持 Windows CRLF 行内容及未以换行结尾的最后一行", async () => {
    await fs.writeFile(logPath, "第一行\r\n第二行\r\n第三行");
    expect(await readLogTail(logPath, 2)).toEqual(["第二行\r", "第三行"]);
  });

  it("返回跨多个读取块的完整中文行", async () => {
    const lines = Array.from(
      { length: 3000 },
      (_, i) => `${i}:中文日志🚀${"x".repeat(64)}`,
    );
    await fs.writeFile(logPath, lines.join("\n") + "\n");
    expect(await readLogTail(logPath, 2000)).toEqual(lines.slice(-2000));
    expect(await readLogTail(logPath, 2000, 2000)).toEqual(
      lines.slice(0, 1000),
    );
  });

  it("默认、条数上限及异常分页参数均保持有限结果", async () => {
    const lines = Array.from({ length: 10020 }, (_, i) => `line-${i}`);
    await fs.writeFile(logPath, lines.join("\n"));
    expect(await readLogTail(logPath)).toEqual(lines.slice(-2000));
    expect(await readLogTail(logPath, 100000)).toEqual(lines.slice(-10000));
    expect(await readLogTail(logPath, NaN, Infinity)).toEqual(
      lines.slice(-2000),
    );
    expect(await readLogTail(logPath, -1, -1)).toEqual(lines.slice(-1));
    expect(await readLogTail(logPath, 2.9, 1.9)).toEqual(lines.slice(-3, -1));
  });

  it("空文件和不存在的文件返回空列表", async () => {
    expect(await readLogTail(logPath)).toEqual([]);
    await fs.writeFile(logPath, "");
    expect(await readLogTail(logPath)).toEqual([]);
  });

  it("600 MiB 文件仍只扫描有限尾部并关闭句柄", async () => {
    await createLargeLog("\nolder\nlatest\n");
    const file = await fs.open(logPath, "r");
    const read = vi.spyOn(file, "read");
    const close = vi.spyOn(file, "close");
    vi.mocked(fs.open).mockResolvedValueOnce(file);
    expect(await readLogTail(logPath, 2000)).toEqual(["older", "latest"]);
    const bytesRequested = read.mock.calls.reduce(
      (sum, call) => sum + (call[2] as number),
      0,
    );
    expect(bytesRequested).toBeLessThanOrEqual(MAX_LOG_TAIL_BYTES);
    expect(close).toHaveBeenCalledOnce();
  });

  it("取得一页后停止读取，无需扫描全部字节预算", async () => {
    const lines = Array.from({ length: 100000 }, (_, i) => `line-${i}`);
    await fs.writeFile(logPath, lines.join("\n"));
    const file = await fs.open(logPath, "r");
    const read = vi.spyOn(file, "read");
    vi.mocked(fs.open).mockResolvedValueOnce(file);
    expect(await readLogTail(logPath, 2)).toEqual(lines.slice(-2));
    expect(read).toHaveBeenCalledOnce();
  });

  it("字节预算从中文半字符截入时丢弃半行，只返回完整尾部", async () => {
    await fs.writeFile(
      logPath,
      "中".repeat(Math.ceil(MAX_LOG_TAIL_BYTES / 3) + 10) + "\n完整日志🚀\n",
    );
    expect(await readLogTail(logPath)).toEqual(["完整日志🚀"]);
  });

  it("单行超过预算时不返回被截断的内容", async () => {
    await fs.writeFile(logPath, "x".repeat(MAX_LOG_TAIL_BYTES + 1));
    expect(await readLogTail(logPath)).toEqual([]);
  });

  it("文件读取中被截短时返回空列表并关闭句柄", async () => {
    await fs.writeFile(logPath, "older\nlatest\n");
    const file = await fs.open(logPath, "r");
    vi.spyOn(file, "read").mockResolvedValueOnce({
      bytesRead: 0,
      buffer: Buffer.alloc(0),
    });
    const close = vi.spyOn(file, "close");
    vi.mocked(fs.open).mockResolvedValueOnce(file);
    expect(await readLogTail(logPath)).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("读取失败仍关闭句柄，并保留错误给 IPC 处理", async () => {
    await fs.writeFile(logPath, "latest\n");
    const file = await fs.open(logPath, "r");
    vi.spyOn(file, "read").mockRejectedValueOnce(new Error("read failed"));
    const close = vi.spyOn(file, "close");
    vi.mocked(fs.open).mockResolvedValueOnce(file);
    await expect(readLogTail(logPath)).rejects.toThrow("read failed");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("log:list IPC", () => {
  async function list(count?: number, offset?: number) {
    const { registerAppHandlers } = await import("../../ipc/appHandlers");
    registerAppHandlers({ getMainWindow: () => null } as Parameters<
      typeof registerAppHandlers
    >[0]);
    return mocks.handlers.get("log:list")!(null, count, offset);
  }

  it("超大日志经真实 IPC 入口返回时间戳、级别及多行错误信息", async () => {
    await createLargeLog(
      "\n[2026-09-29 16:59:34.783] [error] failed\n    at handler.ts:42\n",
    );
    expect(await list(2)).toEqual([
      {
        timestamp: "2026-09-29 16:59:34.783",
        level: "error",
        message: "failed",
      },
      { timestamp: "", level: "info", message: "    at handler.ts:42" },
    ]);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("优先读取 latest.log，并继续支持历史分页", async () => {
    await fs.writeFile(logPath, "fallback\n");
    await fs.writeFile(
      path.join(directory, "latest.log"),
      "old\nnew\nlatest\n",
    );
    expect(await list(2, 1)).toEqual([
      { timestamp: "", level: "info", message: "old" },
      { timestamp: "", level: "info", message: "new" },
    ]);
  });
});
