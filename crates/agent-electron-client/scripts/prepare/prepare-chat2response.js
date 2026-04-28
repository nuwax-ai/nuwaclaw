#!/usr/bin/env node
/**
 * 从 node_modules 复制 chat2response-server 到 resources/
 *
 * 前提：
 *   1. pnpm install 已执行（workspace 链接生效）
 *   2. chat2response-server 依赖已在 monorepo 安装完成
 *
 * 产物：
 *   resources/chat2response/
 *     ├── bin/
 *     ├── node_modules/
 *     └── package.json
 */

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { getProjectRoot } = require("../utils/project-paths");

const projectRoot = getProjectRoot();
const nodeModulesSrcDir = path.join(
  projectRoot,
  "node_modules",
  "chat2response-server",
);
const workspaceSrcDir = path.join(projectRoot, "..", "chat2response-server");
const destDir = path.join(projectRoot, "resources", "chat2response");

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function resolveSourceDir() {
  // 优先使用 node_modules（与 agent-gui-server 保持一致）。
  if (fs.existsSync(path.join(nodeModulesSrcDir, "package.json"))) {
    return { srcDir: nodeModulesSrcDir, sourceType: "node_modules" };
  }
  // 开发兜底：当 workspace 尚未链接到 node_modules 时，直接使用 crates 子项目。
  if (fs.existsSync(path.join(workspaceSrcDir, "package.json"))) {
    return { srcDir: workspaceSrcDir, sourceType: "workspace-fallback" };
  }
  return null;
}

function tsCompileChat2response(dir) {
  if (!fs.existsSync(path.join(dir, "tsconfig.json"))) return;
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  console.log("[prepare-chat2response] 编译 chat2response TypeScript...");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // 安装 devDependencies
  const devDeps = Object.entries(pkg.devDependencies || {}).map(
    ([name, version]) => `${name}@${String(version)}`,
  );
  if (devDeps.length > 0) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    exec(`${npmCmd} install --no-save ${devDeps.join(" ")}`, { cwd: dir });
  }

  // 编译 TypeScript
  exec("npx tsc", { cwd: dir });
  console.log("[prepare-chat2response] ✓ chat2response TypeScript 已编译");
}

function main() {
  const resolved = resolveSourceDir();
  if (!resolved) {
    console.error(
      "[prepare-chat2response] 未找到 chat2response-server（node_modules 与 workspace 均不可用）",
    );
    console.error("[prepare-chat2response] 请先执行 pnpm install");
    process.exit(1);
  }
  const { srcDir, sourceType } = resolved;

  const srcPkg = JSON.parse(
    fs.readFileSync(path.join(srcDir, "package.json"), "utf8"),
  );
  console.log(
    `[prepare-chat2response] 源码版本: ${srcPkg.name}@${srcPkg.version} (${sourceType})`,
  );
  const destPkgPath = path.join(destDir, "package.json");
  const destBinPath = path.join(destDir, "bin", "chat2response-server.js");
  const destRuntimePkgPath = path.join(
    destDir,
    "node_modules",
    "chat2response",
    "package.json",
  );
  const destDistEntry = path.join(
    destDir,
    "node_modules",
    "chat2response",
    "dist",
    "app.js",
  );

  if (
    fs.existsSync(destPkgPath) &&
    fs.existsSync(destBinPath) &&
    fs.existsSync(destRuntimePkgPath) &&
    fs.existsSync(destDistEntry)
  ) {
    try {
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, "utf8"));
      if (destPkg.version === srcPkg.version) {
        console.log(
          `[prepare-chat2response] ${srcPkg.version} 已是最新，跳过复制与安装`,
        );
        return;
      }
    } catch {
      // 目标损坏则继续重建
    }
  }

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  // 复制运行入口目录
  const srcBinDir = path.join(srcDir, "bin");
  if (!fs.existsSync(srcBinDir)) {
    console.error("[prepare-chat2response] bin 目录不存在，请检查 chat2response-server");
    process.exit(1);
  }
  fs.cpSync(srcBinDir, path.join(destDir, "bin"), { recursive: true });

  // 复制 package.json（保留 name/version/bin/main）
  fs.copyFileSync(
    path.join(srcDir, "package.json"),
    path.join(destDir, "package.json"),
  );

  // 安装 runtime 依赖到 resources/chat2response/node_modules
  const deps = Object.entries(srcPkg.dependencies || {}).map(
    ([name, version]) => `${name}@${String(version)}`,
  );
  if (deps.length > 0) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    exec(`${npmCmd} install --no-save ${deps.join(" ")}`, { cwd: destDir });
    if (!fs.existsSync(path.join(destDir, "node_modules"))) {
      console.error(
        "[prepare-chat2response] node_modules 安装结果不存在，请检查依赖安装日志",
      );
      process.exit(1);
    }
  }

  // 编译 chat2response TypeScript → dist/
  tsCompileChat2response(
    path.join(destDir, "node_modules", "chat2response"),
  );

  const licenseSrc = path.join(srcDir, "LICENSE");
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(destDir, "LICENSE"));
  }

  console.log(
    `[prepare-chat2response] ✓ resources/chat2response/ (${srcPkg.version})`,
  );
}

main();
