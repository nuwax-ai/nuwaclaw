import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { exportLogArchive } from "./logArchive";

let directory: string;
let logs: string;
let destination: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "log-archive-"));
  logs = path.join(directory, "logs");
  destination = path.join(directory, "export.zip");
  await mkdir(logs);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("log directory ZIP export", () => {
  it("归档全部日志、轮转文件、二进制及子目录，不包含应用的其他数据", async () => {
    await mkdir(path.join(logs, "mcp", "empty"), { recursive: true });
    const content = "日志内容\n".repeat(10_000);
    await writeFile(path.join(logs, "main.2026-11-05.log"), content);
    await writeFile(path.join(logs, "main.old.log"), "older log");
    const binary = Buffer.from([0, 255, 128, 1]);
    await writeFile(path.join(logs, "mcp", "output.bin"), binary);
    await writeFile(path.join(directory, "settings.db"), "private settings");
    await exportLogArchive(logs, destination);
    const zip = new AdmZip(destination);
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort(),
    ).toEqual([
      "logs/",
      "logs/main.2026-11-05.log",
      "logs/main.old.log",
      "logs/mcp/",
      "logs/mcp/empty/",
      "logs/mcp/output.bin",
    ]);
    expect(zip.readAsText("logs/main.2026-11-05.log")).toBe(content);
    expect(zip.readFile("logs/mcp/output.bin")).toEqual(binary);
    expect((await readFile(destination)).length).toBeLessThan(
      Buffer.byteLength(content) / 10,
    );
    expect(await readdir(directory)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/\.tmp$/)]),
    );
  });

  it.skipIf(process.platform === "win32")(
    "保留 latest 链接，但不跟随外部文件或目录链接",
    async () => {
      await writeFile(path.join(logs, "main.log"), "current");
      await writeFile(path.join(directory, "private.txt"), "outside secret");
      await symlink("main.log", path.join(logs, "latest.log"));
      await symlink("../private.txt", path.join(logs, "external.log"));
      await symlink("..", path.join(logs, "loop"));
      await exportLogArchive(logs, destination);
      const zip = new AdmZip(destination);
      expect(zip.readAsText("logs/latest.log")).toBe("main.log");
      expect(zip.readAsText("logs/external.log")).toBe("../private.txt");
      expect(
        zip
          .getEntries()
          .some((entry) => entry.entryName.includes("private.txt")),
      ).toBe(false);
    },
  );

  it("允许空日志目录", async () => {
    await exportLogArchive(logs, destination);
    expect(
      new AdmZip(destination).getEntries().map((entry) => entry.entryName),
    ).toEqual(["logs/"]);
  });

  it("失败不覆盖已有文件，并清理临时包；重试可以成功替换", async () => {
    await writeFile(destination, "original");
    await writeFile(path.join(directory, "not-a-directory"), "invalid source");
    await expect(
      exportLogArchive(path.join(directory, "not-a-directory"), destination),
    ).rejects.toThrow();
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    await exportLogArchive(logs, destination);
    expect(new AdmZip(destination).getEntry("logs/")).not.toBeNull();
  });

  it("拒绝在日志目录及其别名内保存，保护源文件并避免自归档", async () => {
    const source = path.join(logs, "main.log");
    await writeFile(source, "keep");
    await expect(exportLogArchive(logs, source)).rejects.toThrow("outside");
    await mkdir(path.join(logs, "nested"));
    await expect(
      exportLogArchive(logs, path.join(logs, "nested", "export.zip")),
    ).rejects.toThrow("outside");
    if (process.platform !== "win32") {
      const alias = path.join(directory, "alias");
      await symlink(logs, alias);
      await expect(
        exportLogArchive(logs, path.join(alias, "export.zip")),
      ).rejects.toThrow("outside");
    }
    expect(await readFile(source, "utf8")).toBe("keep");
    expect(await readdir(logs)).toEqual(["main.log", "nested"]);
  });
});
