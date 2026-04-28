#!/usr/bin/env node
/**
 * NuwaClaw 本地维护入口：
 * - 将 chat2response 作为独立 workspace 项目管理；
 * - 运行时再转发到三方包的真实入口；
 * - 便于后续在这里集中做参数兼容/日志增强，而不改客户端主逻辑。
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const isHelpMode = argv.includes("--help") || argv.includes("-h");

function printHelp() {
  console.log(`chat2response-server (NuwaClaw wrapper)

Usage:
  chat2response-server [upstream chat2response args...]

Notes:
  - This command forwards runtime to upstream 'chat2response' package.
  - In NuwaClaw packaged runtime, dependencies are prepared into resources/chat2response.
`);
}

function resolveUpstreamEntry() {
  const pkgJsonPath = require.resolve("chat2response/package.json");
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

  const binField = pkg.bin;
  let relEntry = "";
  if (typeof binField === "string") {
    relEntry = binField;
  } else if (binField && typeof binField === "object") {
    relEntry = binField.chat2response || Object.values(binField)[0] || "";
  }
  if (!relEntry && typeof pkg.main === "string") {
    relEntry = pkg.main;
  }
  if (!relEntry) {
    relEntry = "index.js";
  }

  const absEntry = path.join(pkgDir, relEntry);
  if (!fs.existsSync(absEntry)) {
    throw new Error(
      `chat2response entry not found: ${absEntry}. Please check chat2response package structure.`,
    );
  }
  return absEntry;
}

if (isHelpMode) {
  printHelp();
}

try {
  const entryPath = resolveUpstreamEntry();
  await import(pathToFileURL(entryPath).href);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const isMissingUpstream = message.includes("chat2response/package.json");
  if (isMissingUpstream && isHelpMode) {
    console.log(
      "[chat2response-server] upstream dependency is not installed in current cwd. This is acceptable for wrapper smoke checks.",
    );
    process.exit(0);
  }
  console.error(`[chat2response-server] startup failed: ${message}`);
  process.exit(1);
}

