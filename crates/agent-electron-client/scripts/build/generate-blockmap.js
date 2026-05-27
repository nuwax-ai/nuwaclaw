#!/usr/bin/env node
/**
 * Generate electron-updater blockmap for an installer (NSIS exe, AppImage, zip, etc.).
 *
 * Usage: node generate-blockmap.js <path-to-installer>
 * Output: <installer>.blockmap in the same directory
 *
 * Requires npm install in crates/agent-electron-client (app-builder-bin).
 */

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

function findAppBuilder() {
  const cwd = path.resolve(__dirname, "../..");
  const candidates = [
    path.join(
      cwd,
      "node_modules",
      "app-builder-bin",
      "win",
      "x64",
      "app-builder.exe",
    ),
    path.join(
      cwd,
      "node_modules",
      "app-builder-bin",
      "win",
      "ia32",
      "app-builder.exe",
    ),
    path.join(
      cwd,
      "node_modules",
      "app-builder-bin",
      "mac",
      "app-builder_amd64",
    ),
    path.join(
      cwd,
      "node_modules",
      "app-builder-bin",
      "linux",
      "x64",
      "app-builder",
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node generate-blockmap.js <path-to-installer>");
    process.exit(1);
  }

  const installerPath = path.resolve(input);
  if (!fs.existsSync(installerPath)) {
    console.error(`Error: installer not found: ${installerPath}`);
    process.exit(1);
  }

  const appBuilder = findAppBuilder();
  if (!appBuilder) {
    console.error(
      "Error: app-builder not found. Run npm install in crates/agent-electron-client.",
    );
    process.exit(1);
  }

  const blockmapPath = `${installerPath}.blockmap`;
  console.log(`[generate-blockmap] ${appBuilder}`);
  console.log(`[generate-blockmap] input:  ${installerPath}`);
  console.log(`[generate-blockmap] output: ${blockmapPath}`);

  execFileSync(appBuilder, ["blockmap", "--input", installerPath], {
    stdio: "inherit",
  });

  if (!fs.existsSync(blockmapPath)) {
    console.error(`Error: blockmap was not created: ${blockmapPath}`);
    process.exit(1);
  }

  const size = fs.statSync(blockmapPath).size;
  console.log(`[generate-blockmap] OK (${size} bytes)`);
}

main();
