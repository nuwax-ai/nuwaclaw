import path from "node:path";
import { createWriteStream } from "node:fs";
import {
  lstat,
  opendir,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";

/** 流式压缩日志目录；成功后才替换目标文件，符号链接只归档链接本身。 */
export async function exportLogArchive(
  source: string,
  destination: string,
): Promise<void> {
  const root = await realpath(source);
  const parent = await realpath(path.dirname(destination));
  destination = path.join(parent, path.basename(destination));
  const relative = path.relative(root, destination);
  // 防止覆盖源日志，以及把正在写入的 ZIP 或历史导出包再次打进日志包。
  if (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  ) {
    throw new Error("Save the log archive outside the logs directory");
  }

  const temporary = path.join(
    parent,
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  const completion = pipeline(archive, output);
  // 输出错误可能早于目录遍历结束，立即接住拒绝，随后统一收尾。
  void completion.catch(() => undefined);
  archive.on("warning", (error: Error) => archive.destroy(error));

  const visit = async (directory: string, name: string): Promise<void> => {
    const info = await lstat(directory);
    archive.append(Buffer.alloc(0), {
      name: `${name}/`,
      mode: info.mode,
      date: info.mtime,
    });
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const entryName = `${name}/${entry.name}`;
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        archive.symlink(entryName, await readlink(absolute), stat.mode);
      } else if (stat.isDirectory()) {
        await visit(absolute, entryName);
      } else if (stat.isFile()) {
        archive.file(absolute, {
          name: entryName,
          mode: stat.mode,
          date: stat.mtime,
        });
      }
    }
  };

  try {
    await visit(root, "logs");
    await Promise.all([archive.finalize(), completion]);
    await rename(temporary, destination);
  } catch (error) {
    archive.destroy(
      error instanceof Error ? error : new Error("Log archive failed"),
    );
    output.destroy();
    await completion.catch(() => undefined);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
