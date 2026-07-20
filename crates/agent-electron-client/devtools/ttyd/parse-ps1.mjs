/**
 * Parse .ps1 files with Windows PowerShell AST and report syntax errors.
 *
 * Usage (from crates/agent-electron-client):
 *   node devtools/ttyd/parse-ps1.mjs
 *   node devtools/ttyd/parse-ps1.mjs path/to/script.ps1 [...]
 *
 * With no args, checks ~/.nuwaclaw/bin/ttyd-shell.ps1 and ttyd-env.ps1.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DATA_DIR_NAME = ".nuwaclaw";

function defaultTtydScripts() {
  const binDir = path.join(os.homedir(), APP_DATA_DIR_NAME, "bin");
  return [
    path.join(binDir, "ttyd-shell.ps1"),
    path.join(binDir, "ttyd-env.ps1"),
  ];
}

const files =
  process.argv.length > 2 ? process.argv.slice(2) : defaultTtydScripts();

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`\n=== ${file} ===`);
    console.log(`SKIP: file not found`);
    continue;
  }

  const ps = `
$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
if ($errors) {
  $errors | ForEach-Object { Write-Output "ERROR: $($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)" }
} else {
  Write-Output 'OK'
}
`;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", ps],
    { encoding: "utf8" },
  );
  console.log(`\n=== ${file} ===`);
  console.log(r.stdout || r.stderr);
}
