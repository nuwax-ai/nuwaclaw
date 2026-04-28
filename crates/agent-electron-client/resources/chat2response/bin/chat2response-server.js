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

const entryPath = resolveUpstreamEntry();
await import(pathToFileURL(entryPath).href);

