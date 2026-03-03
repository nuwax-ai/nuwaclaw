/**
 * 主进程：启动前端口解析与占用检查（聚合入口）
 *
 * 依赖 shared/startupPorts 的解析逻辑；端口占用检查优先统一走 bash（与 scripts/tools/check-port.sh 一致），
 * Windows 下使用 prepare-git 集成的 Git Bash，无 bash 时回退到 cmd+netstat。
 */

import { execSync, spawnSync } from 'child_process';
import { readSetting } from '../db';
import {
  resolvePortsFromSettings,
  getPortsToCheck,
  type StartupPorts,
} from '@shared/startupPorts';
import { isWindows } from './system/shellEnv';
import { getBundledGitBashPath } from './system/dependencies';

/** 与 scripts/tools/check-port.sh 保持一致的内嵌脚本（打包后无脚本文件时使用），脚本内端口通过 $1 传入 */
const CHECK_PORT_SCRIPT = `
port="$1"
[[ -z "$port" ]] && exit 2
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == cygwin* ]]; then
  out=$(cmd //c "netstat -ano 2>nul | findstr \\":$1 \\"" 2>/dev/null)
else
  out=$(lsof -t -i ":$1" 2>/dev/null)
fi
[[ -n "$out" ]] && { pid=$(echo "$out" | head -1 | awk '{print $NF}'); [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] && echo "$pid"; exit 0; }
exit 1
`.trim();

// ==================== 解析当前配置端口 ====================

/**
 * 从当前应用配置（SQLite readSetting）解析出所有启动相关端口（聚合入口）
 */
export function getConfiguredPorts(): StartupPorts {
  return resolvePortsFromSettings(readSetting);
}

/**
 * 返回需要做占用检查的端口列表（名称 + 端口）
 * @param includeVite 是否包含 Vite 端口（开发模式为 true）
 */
export function getPortList(includeVite: boolean): Array<{ name: string; label: string; port: number }> {
  const ports = getConfiguredPorts();
  return getPortsToCheck(ports, includeVite);
}

// ==================== 端口占用检查（聚合逻辑） ====================

export type PortCheckItem = {
  name: string;
  label: string;
  port: number;
  inUse: boolean;
  pid?: number;
};

/**
 * 检查给定端口列表中哪些已被占用（聚合逻辑：统一 lsof/netstat）
 * @param portList 由 getPortList() 得到
 */
export function checkPortsInUse(
  portList: Array<{ name: string; label: string; port: number }>
): PortCheckItem[] {
  return portList.map((item) => {
    const { inUse, pid } = isPortInUse(item.port);
    return { ...item, inUse, pid };
  });
}

/**
 * 检查单个端口是否被占用，返回是否占用及占用进程 PID（若有）
 * 优先统一走 bash（与 scripts/tools/check-port.sh 一致）：Windows 用 prepare-git 集成的 Git Bash，Unix 用系统 bash。
 * Windows 无集成 bash 时回退到 cmd+netstat。
 */
function isPortInUse(port: number): { inUse: boolean; pid?: number } {
  const portStr = String(port);

  // 1) Windows：若有集成 Git Bash 则统一用 bash 执行脚本
  if (isWindows()) {
    const bashPath = getBundledGitBashPath();
    if (bashPath) {
      const result = spawnSync(bashPath, ['-c', CHECK_PORT_SCRIPT, '_', portStr], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status === 0 && result.stdout) {
        const text = (result.stdout && typeof result.stdout === 'string' ? result.stdout : String(result.stdout)).trim();
        const pid = text && /^\d+$/.test(text) ? parseInt(text, 10) : undefined;
        return { inUse: true, pid };
      }
      return { inUse: false };
    }
    // 回退：无 bash 时用 cmd+netstat
    try {
      const out = execSync(`netstat -ano 2>nul | findstr ":${portStr} "`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.env.ComSpec || 'cmd.exe',
      });
      const text = (out && typeof out === 'string' ? out : String(out)).trim();
      const inUse = text.length > 0;
      let pid: number | undefined;
      if (inUse) {
        const firstLine = text.split(/\r?\n/)[0] || '';
        const lastCol = firstLine.split(/\s+/).filter(Boolean).pop();
        if (lastCol && /^\d+$/.test(lastCol)) pid = parseInt(lastCol, 10);
      }
      return { inUse, pid };
    } catch {
      return { inUse: false };
    }
  }

  // 2) macOS / Linux：统一用 bash 执行脚本（与 Windows 一致）
  const result = spawnSync('bash', ['-c', CHECK_PORT_SCRIPT, '_', portStr], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status === 0 && result.stdout) {
    const text = (result.stdout && typeof result.stdout === 'string' ? result.stdout : String(result.stdout)).trim();
    const pid = text && /^\d+$/.test(text) ? parseInt(text, 10) : undefined;
    return { inUse: true, pid };
  }
  return { inUse: false };
}

/**
 * 一站式：解析配置端口并检查占用，返回带 inUse/pid 的列表（供 UI 或日志）
 * @param includeVite 是否包含 Vite
 */
export function getConfiguredPortsWithStatus(includeVite: boolean): PortCheckItem[] {
  const list = getPortList(includeVite);
  return checkPortsInUse(list);
}
