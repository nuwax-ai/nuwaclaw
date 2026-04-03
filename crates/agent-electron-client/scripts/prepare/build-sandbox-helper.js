#!/usr/bin/env node
/**
 * 构建 Windows 专用 Sandbox helper（nuwax-sandbox-helper.exe）。
 * 产物仅被 Windows 版 Electron 客户端加载；建议在 Windows 宿主上执行，或在 macOS/Linux 上使用 --win 交叉编译。
 *
 * Usage:
 *   npm run build:sandbox-helper          # Windows 宿主：本机构建
 *   npm run build:sandbox-helper -- --win  # 非 Windows：交叉编译 Windows x64
 *
 * Output: resources/sandbox-helper/nuwax-sandbox-helper.exe
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getProjectRoot, resolveFromProject } = require("../utils/project-paths");

const projectRoot = getProjectRoot();
/**
 * crate 位于 monorepo crates/ 下，与 agent-electron-client 同级。
 * getProjectRoot() 返回 crates/agent-electron-client，故 crate 路径为
 * path.resolve(projectRoot, '..', 'windows-sandbox-helper')。
 */
const crateDir = path.resolve(projectRoot, "..", "windows-sandbox-helper");
const outputDir = resolveFromProject("resources", "sandbox-helper");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const isWinTarget = args.includes("--win");

  // Check if Rust is available
  try {
    execSync("rustc --version", { stdio: "pipe" });
  } catch {
    console.warn(
      "[build-sandbox-helper] Rust 未安装，跳过（Windows Sandbox helper 仅在 Windows 上需要）",
    );
    return;
  }

  // Check if we're on Windows or targeting Windows
  const onWindows = process.platform === "win32";
  if (!onWindows && !isWinTarget) {
    console.warn(
      "[build-sandbox-helper] 非 Windows 环境；如需交叉编译请使用: npm run build:sandbox-helper -- --win",
    );
    return;
  }

  if (!fs.existsSync(path.join(crateDir, "Cargo.toml"))) {
    console.error(
      `[build-sandbox-helper] 未找到 crate 目录: ${crateDir}（请确认 monorepo 中存在 crates/windows-sandbox-helper）`,
    );
    process.exit(1);
  }

  ensureDir(outputDir);

  const buildArgs = ["cargo", "build", "--release", "--bin", "nuwax-sandbox-helper"];

  if (isWinTarget) {
    if (process.platform === "win32") {
      console.warn("[build-sandbox-helper] --win 在 Windows 上无效（已是 Windows）");
    } else {
      // Cross-compile for Windows x64
      const target = "x86_64-pc-windows-msvc";
      console.log(`[build-sandbox-helper] 交叉编译 Windows x64（target: ${target}）`);
      buildArgs.push("--target", target);
    }
  }

  console.log(`[build-sandbox-helper] 构建: ${buildArgs.join(" ")}`);
  console.log(`[build-sandbox-helper] crate: ${crateDir}`);

  try {
    execSync(buildArgs.join(" "), {
      cwd: crateDir,
      stdio: "inherit",
    });

    // Determine source path
    let srcPath;
    if (isWinTarget && process.platform !== "win32") {
      srcPath = path.join(
        crateDir,
        "target",
        "x86_64-pc-windows-msvc",
        "release",
        "nuwax-sandbox-helper.exe",
      );
    } else {
      srcPath = path.join(crateDir, "target", "release", "nuwax-sandbox-helper.exe");
    }

    if (!fs.existsSync(srcPath)) {
      if (isWinTarget && process.platform !== "win32") {
        srcPath = path.join(
          crateDir,
          "target",
          "x86_64-pc-windows-msvc",
          "debug",
          "nuwax-sandbox-helper.exe",
        );
      } else {
        srcPath = path.join(crateDir, "target", "debug", "nuwax-sandbox-helper.exe");
      }
    }

    if (!fs.existsSync(srcPath)) {
      throw new Error(`构建产物未找到: ${srcPath}`);
    }

    const destPath = path.join(outputDir, "nuwax-sandbox-helper.exe");
    fs.copyFileSync(srcPath, destPath);

    const stats = fs.statSync(destPath);
    console.log(
      `[build-sandbox-helper] 完成: ${destPath} (${(stats.size / 1024).toFixed(1)} KB)`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("build产物未找到")) {
      throw error;
    }
    console.error(
      "[build-sandbox-helper] 构建失败（可能是因为非 Windows 平台）:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
