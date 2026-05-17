# Quick smoke checks for nuwaxcode 1.2.1 native sandbox bundle (Windows).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root "resources\nuwaxcode\windows-x64\bin"
$exe = Join-Path $binDir "nuwaxcode.exe"
$exeNew = Join-Path $binDir "nuwaxcode.exe.new"

if (Test-Path $exeNew) {
  Write-Host "NOTE: nuwaxcode.exe.new present — close nuwaclaw and replace nuwaxcode.exe with .new"
  $exe = $exeNew
}

if (-not (Test-Path $exe)) {
  Write-Error "Missing bundled binary: $exe (run: NUWAXCODE_DIST_DIR=... npm run prepare:nuwaxcode)"
}

$ver = & $exe --version 2>&1
Write-Host "bundled --version: $ver"
if ($ver -notmatch "1\.2\.0") {
  Write-Warning "Expected 1.2.1; native sandbox gate uses resources/.version file"
}

$dotVersion = Join-Path (Join-Path $root "resources\nuwaxcode") ".version"
if (Test-Path $dotVersion) {
  Write-Host "resources/.version:" (Get-Content $dotVersion -Raw).Trim()
}

Write-Host "OK: run electron:dev with Strict sandbox and test in-session vs desktop writes."
