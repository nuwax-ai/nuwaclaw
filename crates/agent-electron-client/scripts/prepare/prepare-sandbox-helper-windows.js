#!/usr/bin/env node
/**
 * 场景仅限 Windows 客户端沙箱：仅在 win32 宿主上构建 nuwax-sandbox-helper.exe，
 * 供 prepare:all 串联。macOS/Linux 上立即退出 0，不执行 cargo。
 */
const { execSync } = require("child_process");
const path = require("path");

if (process.platform !== "win32") {
  console.log("[prepare-sandbox-helper-win] 非 Windows，跳过 build:sandbox-helper");
  process.exit(0);
}

const script = path.join(__dirname, "build-sandbox-helper.js");
execSync(`node "${script}"`, { stdio: "inherit" });
