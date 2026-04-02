#!/usr/bin/env node
/**
 * windows-mcp 预安装到 resources/windows-mcp/
 *
 * 使用 uv tool install + UV_TOOL_DIR / UV_TOOL_BIN_DIR 将 windows-mcp 安装到本地目录
 * （uv 0.10+ 已移除 tool install --target，需用环境变量指定目录）
 * 避免首次运行时从 PyPI 下载。
 *
 * 前提：
 *   1. uv 已安装 (resources/uv/bin/)
 *   2. Windows 平台 (process.platform === 'win32')
 *
 * 产物：
 *   resources/windows-mcp/bin/
 *     ├── windows-mcp.exe     — 主程序入口
 *     └── ...                 — Python 依赖
 *
 * 打包时 electron-builder extraResources 将 resources/windows-mcp 打包到应用内
 * 运行时 getWindowsMcpBinPath() 返回打包的二进制路径
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot, resolveFromProject } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const resDir = path.join(projectRoot, 'resources', 'windows-mcp');
/** 安装到 resources/windows-mcp/bin/（与 getWindowsMcpBinPath 一致） */
const targetDir = path.join(resDir, 'bin');
/** 工具隔离环境目录（随 resources 一并打包时只需 bin + 依赖在 venv 内；见 UV_TOOL_DIR） */
const toolDataDir = path.join(resDir, '.uv-tool');

function getUvBinPath() {
  const uvBinName = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const uvPath = resolveFromProject('resources', 'uv', 'bin', uvBinName);
  return uvPath;
}

function main() {
  // 1. 仅 Windows 平台执行
  if (process.platform !== 'win32') {
    console.log('[prepare-windows-mcp] Skipped: not Windows platform');
    return;
  }

  // 2. 检查 uv 是否可用
  const uvBin = getUvBinPath();
  if (!fs.existsSync(uvBin)) {
    console.error('[prepare-windows-mcp] uv not found at:', uvBin);
    console.error('[prepare-windows-mcp] Skipping windows-mcp preparation');
    return;
  }

  console.log('[prepare-windows-mcp] Using uv:', uvBin);

  // 3. 清理旧版本（确保每次打包获取最新 windows-mcp latest 版本）
  if (fs.existsSync(resDir)) {
    console.log('[prepare-windows-mcp] Removing old version...');
    fs.rmSync(resDir, { recursive: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // 4. uv tool install：通过环境变量指定安装目录（替代已移除的 --target）
  console.log('[prepare-windows-mcp] Installing windows-mcp to resources/...');
  try {
    execSync(`"${uvBin}" tool install windows-mcp`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        UV_TOOL_DIR: toolDataDir,
        UV_TOOL_BIN_DIR: targetDir,
      },
    });
    console.log('[prepare-windows-mcp] ✓ windows-mcp installed successfully');
  } catch (err) {
    console.error('[prepare-windows-mcp] Failed to install windows-mcp:', err.message);
    process.exit(1);
  }

  // 5. 验证安装
  const windowsMcpExe = path.join(targetDir, 'windows-mcp.exe');
  if (fs.existsSync(windowsMcpExe)) {
    const sizeMB = (fs.statSync(windowsMcpExe).size / 1024 / 1024).toFixed(1);
    console.log(`[prepare-windows-mcp] ✓ windows-mcp.exe (${sizeMB} MB)`);
  } else {
    console.error('[prepare-windows-mcp] Warning: windows-mcp.exe not found after installation');
  }

  console.log(`[prepare-windows-mcp] ✓ resources/windows-mcp/`);
}

main();
