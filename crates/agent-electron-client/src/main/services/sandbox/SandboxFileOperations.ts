/**
 * 沙箱文件操作工具类
 *
 * 从 CommandSandbox 和 DockerSandbox 中抽取的共享文件操作方法，
 * 消除两者之间的代码重复。
 *
 * 所有方法均为 static，不持有状态，可被任意沙箱实现复用。
 *
 * @version 1.0.0
 */

import * as fsp from "fs/promises";
import * as path from "path";
import log from "electron-log";
import type { FileInfo } from "@shared/types/sandbox";
import { FileOperationError, SandboxErrorCode } from "@shared/errors/sandbox";

const TAG = "[SandboxFileOps]";

/**
 * 沙箱文件操作工具集
 *
 * 提供工作区目录创建、清理、文件读写、目录遍历等通用操作。
 * 方法不依赖沙箱实例状态，仅操作底层文件系统。
 */
export class SandboxFileOperations {
  // ============================================================================
  // 工作区目录结构
  // ============================================================================

  /**
   * 创建标准工作区目录结构。
   *
   * 在 workspaceRoot 下创建以下子目录：
   * - projects/
   * - node_modules/
   * - python-env/
   * - bin/
   * - cache/
   *
   * @param workspaceRoot - 工作区根目录路径
   */
  static async createWorkspaceDirectories(
    workspaceRoot: string,
  ): Promise<void> {
    const dirs = [
      workspaceRoot,
      path.join(workspaceRoot, "projects"),
      path.join(workspaceRoot, "node_modules"),
      path.join(workspaceRoot, "python-env"),
      path.join(workspaceRoot, "bin"),
      path.join(workspaceRoot, "cache"),
    ];

    log.debug(TAG, "createWorkspaceDirectories:", workspaceRoot);

    for (const dir of dirs) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  // ============================================================================
  // 目录清理
  // ============================================================================

  /**
   * 递归删除指定目录。
   *
   * 等同于 `rm -rf`，即使目录不存在也不会抛出异常（force: true）。
   *
   * @param dirPath - 要删除的目录路径
   */
  static async cleanupWorkspaceDirectory(dirPath: string): Promise<void> {
    log.debug(TAG, "cleanupWorkspaceDirectory:", dirPath);
    await fsp.rm(dirPath, { recursive: true, force: true });
  }

  // ============================================================================
  // 目录大小计算
  // ============================================================================

  /**
   * 递归计算目录总大小（字节）。
   *
   * 遍历目录下所有文件并累加文件尺寸。遇到不可访问的文件或目录时
   * 不会抛出异常，而是返回已累加的大小。
   *
   * @param dirPath - 目标目录路径
   * @returns 目录总大小（字节）
   */
  static async getDirectorySize(dirPath: string): Promise<number> {
    try {
      let total = 0;
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await SandboxFileOperations.getDirectorySize(full);
        } else {
          const st = await fsp.stat(full);
          total += st.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  // ============================================================================
  // 文件读写
  // ============================================================================

  /**
   * 读取文件内容（UTF-8）。
   *
   * @param filePath - 文件绝对路径
   * @returns 文件内容字符串
   * @throws {FileOperationError} 文件不存在（FILE_NOT_FOUND）或读取失败（FILE_READ_FAILED）
   */
  static async readFileContent(filePath: string): Promise<string> {
    try {
      const content = await fsp.readFile(filePath, "utf-8");
      log.debug(TAG, "readFileContent:", filePath);
      return content;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileOperationError(
          `File not found: ${filePath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          { cause: error as Error },
        );
      }
      throw new FileOperationError(
        `File read failed: ${filePath}`,
        SandboxErrorCode.FILE_READ_FAILED,
        { cause: error as Error },
      );
    }
  }

  /**
   * 写入文件内容（UTF-8），自动创建父目录。
   *
   * @param filePath - 文件绝对路径
   * @param content  - 要写入的内容
   * @throws {FileOperationError} 写入失败（FILE_WRITE_FAILED）
   */
  static async writeFileContent(
    filePath: string,
    content: string,
  ): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content, "utf-8");
      log.debug(TAG, "writeFileContent:", filePath);
    } catch (error) {
      throw new FileOperationError(
        `File write failed: ${filePath}`,
        SandboxErrorCode.FILE_WRITE_FAILED,
        { cause: error as Error },
      );
    }
  }

  // ============================================================================
  // 目录遍历
  // ============================================================================

  /**
   * 读取目录条目并返回文件信息列表。
   *
   * @param dirPath - 目录绝对路径
   * @returns 文件信息数组
   * @throws {FileOperationError} 目录不存在（FILE_NOT_FOUND）或读取失败（DIRECTORY_OPERATION_FAILED）
   */
  static async readDirectoryEntries(dirPath: string): Promise<FileInfo[]> {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const infos = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          const st = await fsp.stat(fullPath);
          const item: FileInfo = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: st.size,
            modifiedAt: st.mtime,
          };
          return item;
        }),
      );
      log.debug(TAG, "readDirectoryEntries:", dirPath, "count:", infos.length);
      return infos;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileOperationError(
          `Directory not found: ${dirPath}`,
          SandboxErrorCode.FILE_NOT_FOUND,
          { cause: error as Error },
        );
      }
      throw new FileOperationError(
        `Directory read failed: ${dirPath}`,
        SandboxErrorCode.DIRECTORY_OPERATION_FAILED,
        { cause: error as Error },
      );
    }
  }

  // ============================================================================
  // 删除
  // ============================================================================

  /**
   * 删除文件或目录（递归）。
   *
   * 对文件和目录均使用 `rm -rf` 语义，不存在时不报错。
   *
   * @param filePath - 文件或目录路径
   * @throws {FileOperationError} 删除失败（FILE_DELETE_FAILED）
   */
  static async deletePath(filePath: string): Promise<void> {
    try {
      await fsp.rm(filePath, { recursive: true, force: true });
      log.debug(TAG, "deletePath:", filePath);
    } catch (error) {
      throw new FileOperationError(
        `File delete failed: ${filePath}`,
        SandboxErrorCode.FILE_DELETE_FAILED,
        { cause: error as Error },
      );
    }
  }
}
