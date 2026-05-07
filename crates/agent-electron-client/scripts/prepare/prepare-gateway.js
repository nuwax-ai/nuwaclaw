#!/usr/bin/env node
/**
 * 从 node_modules 复制 gateway-server 到 resources/
 *
 * 前提：
 *   1. pnpm install 已执行（workspace 链接生效）
 *   2. gateway-server 依赖已在 monorepo 安装完成
 *
 * 产物：
 *   resources/gateway/
 *     ├── bin/
 *     ├── lib/
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
  "gateway-server",
);
const workspaceSrcDir = path.join(projectRoot, "..", "gateway-server");
const destDir = path.join(projectRoot, "resources", "gateway");

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function resolveSourceDir() {
  if (fs.existsSync(path.join(nodeModulesSrcDir, "package.json"))) {
    return { srcDir: nodeModulesSrcDir, sourceType: "node_modules" };
  }
  if (fs.existsSync(path.join(workspaceSrcDir, "package.json"))) {
    return { srcDir: workspaceSrcDir, sourceType: "workspace-fallback" };
  }
  return null;
}

function tsCompileChat2response(dir) {
  if (!fs.existsSync(path.join(dir, "tsconfig.json"))) return;
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  console.log("[prepare-gateway] compiling chat2response TypeScript...");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  const devDeps = Object.entries(pkg.devDependencies || {}).map(
    ([name, version]) => `${name}@${String(version)}`,
  );
  if (devDeps.length > 0) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    exec(`${npmCmd} install --no-save ${devDeps.join(" ")}`, { cwd: dir });
  }

  exec("npx tsc", { cwd: dir });
  console.log("[prepare-gateway] chat2response TypeScript compiled");
}

function main() {
  const resolved = resolveSourceDir();
  if (!resolved) {
    console.error(
      "[prepare-gateway] gateway-server not found (node_modules and workspace both unavailable)",
    );
    console.error("[prepare-gateway] run pnpm install first");
    process.exit(1);
  }
  const { srcDir, sourceType } = resolved;

  const srcPkg = JSON.parse(
    fs.readFileSync(path.join(srcDir, "package.json"), "utf8"),
  );
  console.log(
    `[prepare-gateway] source: ${srcPkg.name}@${srcPkg.version} (${sourceType})`,
  );
  const destPkgPath = path.join(destDir, "package.json");
  const destBinPath = path.join(destDir, "bin", "gateway-server.js");
  const destLibPath = path.join(destDir, "lib", "server.js");
  const destRuntimePkgPath = path.join(
    destDir,
    "node_modules",
    "chat2response",
    "package.json",
  );

  if (
    fs.existsSync(destPkgPath) &&
    fs.existsSync(destBinPath) &&
    fs.existsSync(destLibPath) &&
    fs.existsSync(destRuntimePkgPath)
  ) {
    try {
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, "utf8"));
      if (destPkg.version === srcPkg.version) {
        console.log(
          `[prepare-gateway] ${srcPkg.version} already up to date, skipping`,
        );
        return;
      }
    } catch {
      // dest corrupted, rebuild
    }
  }

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  // copy bin/
  const srcBinDir = path.join(srcDir, "bin");
  if (fs.existsSync(srcBinDir)) {
    fs.cpSync(srcBinDir, path.join(destDir, "bin"), { recursive: true });
  }

  // copy lib/
  const srcLibDir = path.join(srcDir, "lib");
  if (fs.existsSync(srcLibDir)) {
    fs.cpSync(srcLibDir, path.join(destDir, "lib"), { recursive: true });
  }

  // copy package.json
  fs.copyFileSync(
    path.join(srcDir, "package.json"),
    path.join(destDir, "package.json"),
  );

  // install runtime deps
  const deps = Object.entries(srcPkg.dependencies || {}).map(
    ([name, version]) => `${name}@${String(version)}`,
  );
  if (deps.length > 0) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    exec(`${npmCmd} install --no-save ${deps.join(" ")}`, { cwd: destDir });
    if (!fs.existsSync(path.join(destDir, "node_modules"))) {
      console.error(
        "[prepare-gateway] node_modules install result missing, check dependency install log",
      );
      process.exit(1);
    }
  }

  // compile chat2response TypeScript if needed
  tsCompileChat2response(
    path.join(destDir, "node_modules", "chat2response"),
  );

  const licenseSrc = path.join(srcDir, "LICENSE");
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(destDir, "LICENSE"));
  }

  console.log(
    `[prepare-gateway] done: resources/gateway/ (${srcPkg.version})`,
  );
}

main();
