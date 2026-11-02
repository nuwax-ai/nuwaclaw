#!/usr/bin/env node
/**
 * Smoke-check sandboxed MCP bundles (post prepare:sandboxed-mcp).
 * Exits 0 when bundles exist and parse without ERR_MODULE_NOT_FOUND.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const bundles = [
  path.join(
    root,
    "resources",
    "sandboxed-bash-mcp",
    "dist",
    "sandboxed-bash-mcp.bundle.mjs",
  ),
  path.join(
    root,
    "resources",
    "sandboxed-fs-mcp",
    "dist",
    "sandboxed-fs-mcp.bundle.mjs",
  ),
];

function fail(msg) {
  console.error(`[verify-sandboxed-mcp-bundle] ${msg}`);
  process.exit(1);
}

for (const file of bundles) {
  if (!fs.existsSync(file)) {
    fail(`missing bundle: ${file}\nRun: npm run prepare:sandboxed-mcp`);
  }
  const stat = fs.statSync(file);
  if (stat.size < 10_000) {
    fail(`bundle too small (${stat.size} bytes): ${file}`);
  }
}

async function checkLoads(bundlePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", `import('${bundlePath.replace(/\\/g, "/")}')`],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout loading ${bundlePath}`));
    }, 15_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && /ERR_MODULE_NOT_FOUND/.test(stderr)) {
        reject(new Error(stderr.trim()));
        return;
      }
      // Import may fail at runtime (missing env); module resolution must succeed.
      if (/ERR_MODULE_NOT_FOUND/.test(stderr)) {
        reject(new Error(stderr.trim()));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
}

console.log("[verify-sandboxed-mcp-bundle] checking bundles...");
for (const file of bundles) {
  try {
    await checkLoads(file);
    console.log(`  ok ${path.relative(root, file)}`);
  } catch (err) {
    fail(String(err));
  }
}
console.log("[verify-sandboxed-mcp-bundle] all checks passed");
