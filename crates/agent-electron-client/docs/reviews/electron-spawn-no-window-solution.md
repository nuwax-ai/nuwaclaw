# Electron 子进程跨平台无窗口启动方案

> 本文档记录了 Nuwax Agent Electron 客户端在子进程启动时的跨平台兼容性问题及解决方案。

## 问题描述

在 Electron 应用中使用 `child_process.spawn()` 启动 Node.js 子进程时，会遇到以下平台特定问题：

| 平台 | 问题 | 影响 |
|------|------|------|
| **Windows** | CMD 控制台窗口闪烁/弹出 | 用户体验差，看起来像恶意软件 |
| **macOS** | 子进程出现在 Dock 栏并跳动 | 用户体验差，显示为独立应用 |
| **Linux** | 可能显示在任务栏 | 取决于桌面环境 |

## 问题根因

### Windows CMD 弹窗

1. npm 安装的包在 `node_modules/.bin/` 目录下生成 `.cmd` 和 `.ps1` 脚本
2. 这些 `.cmd` 文件会调用 `cmd.exe` 执行
3. 即使设置了 `windowsHide: true`，`cmd.exe` 可能忽略父进程的窗口标志
4. 结果：控制台窗口短暂闪烁或持续显示

### macOS Dock 图标

1. 使用 `spawn(process.execPath, ...)` + `ELECTRON_RUN_AS_NODE=1` 启动子进程
2. `process.execPath` 指向 Electron 可执行文件
3. macOS 将其识别为**新的应用实例**
4. 即使以 Node.js 模式运行，仍会出现在 Dock 中

## 社区讨论

这是一个**广泛存在的社区问题**，多个项目和 issue 都有相关讨论：

### 相关 GitHub Issues

| Issue | 项目 | 描述 |
|-------|------|------|
| [#480](https://github.com/anthropics/claude-agent-sdk-python/issues/480) | claude-agent-sdk-python | Windows subprocess 终端窗口隐藏 |
| [#2634](https://github.com/electron/electron/issues/2634) | Electron | Electron spawn 子进程问题 |
| [#4179](https://github.com/tauri-apps/tauri/discussions/4179) | Tauri | 启动后隐藏 CMD 窗口 |

### Node.js 官方文档

> `windowsHide <boolean>` - Hide the subprocess console window that would normally be created on Windows systems. **Default: false**
>
> — [Node.js child_process 文档](https://nodejs.org/api/child_process.html)

**注意**：Node.js v11.2.0 将 `windowsHide` 默认值恢复为 `false`，这意味着 GUI 应用需要**显式设置** `windowsHide: true`。

### 常见方案对比

| 方案 | 社区使用度 | 优点 | 缺点 |
|------|-----------|------|------|
| `windowsHide: true` | ⭐⭐⭐⭐⭐ | 简单，官方支持 | 对 `.cmd` 文件可能无效 |
| `cross-spawn` 模块 | ⭐⭐⭐⭐ | 跨平台自动处理 | 仍使用 `.cmd` 文件 |
| 绕过 `.cmd` 直接执行 JS | ⭐⭐⭐ | 彻底解决 | 需要解析入口 |
| `CREATE_NO_WINDOW` (Rust) | ⭐⭐⭐ | Windows API 级别 | 仅限 Rust/Native |

### 为什么 `windowsHide: true` 对 `.cmd` 文件可能无效

```
┌─────────────────────────────────────────────────────────────┐
│  spawn('npm', [...], { windowsHide: true })                 │
│                    │                                        │
│                    ▼                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  npm.cmd (batch file)                               │   │
│  │      │                                              │   │
│  │      ▼  (创建新的 cmd.exe 进程)                      │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  cmd.exe /c "node npm-cli.js"               │   │   │
│  │  │      │                                      │   │   │
│  │  │      │  ⚠️ cmd.exe 可能忽略父进程的          │   │   │
│  │  │      │     windowsHide 标志                 │   │   │
│  │  │      ▼                                      │   │   │
│  │  │  [控制台窗口弹出]                            │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**解决方案**：绕过 `.cmd` 文件，直接执行 JS 入口文件。

## 解决方案

### 最终方案：平台差异化策略

```
┌─────────────┬────────────────────────────────────────────────┐
│   平台      │                    策略                         │
├─────────────┼────────────────────────────────────────────────┤
│  Windows    │ Electron bundled Node + ELECTRON_RUN_AS_NODE=1 │
│             │ + windowsHide: true + 绕过 .cmd 文件            │
├─────────────┼────────────────────────────────────────────────┤
│  macOS      │ 系统 node（从用户 shell PATH 解析）             │
├─────────────┼────────────────────────────────────────────────┤
│  Linux      │ 系统 node（从用户 shell PATH 解析）             │
└─────────────┴────────────────────────────────────────────────┘
```

### 实现代码

#### 1. 核心工具模块 (`spawnNoWindow.ts`)

```typescript
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 解析用户 shell PATH（macOS/Linux）
 *
 * 打包后的 Electron 应用不会继承用户的 shell profile，
 * 所以 node/npm 等工具不会在 PATH 中，需要手动解析。
 */
function resolveUserShellPath(): string | null {
  if (process.platform === 'win32') return null;

  try {
    const shell = process.env.SHELL || '/bin/bash';
    // 使用 login shell (-il) 加载用户的 profile 文件
    const result = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const match = result.match(/__PATH__=(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * 查找系统 node 可执行文件（macOS/Linux）
 *
 * 支持多种 node 安装方式：
 * - Homebrew: /opt/homebrew/bin/node, /usr/local/bin/node
 * - nvm: ~/.nvm/versions/node/...
 * - volta: ~/.volta/bin/node
 * - fnm: ~/.fnm/...
 */
function findSystemNode(): string {
  if (process.platform === 'win32') {
    return process.execPath; // Windows 使用 Electron bundled Node
  }

  const userPath = resolveUserShellPath();

  if (userPath) {
    // 在用户 PATH 中搜索 node
    for (const dir of userPath.split(path.delimiter)) {
      const nodePath = path.join(dir, 'node');
      if (fs.existsSync(nodePath)) return nodePath;
    }
  }

  // 回退：尝试常见安装路径
  const home = process.env.HOME || '';
  const commonPaths = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(home, '.nvm/versions/node/current/bin/node'),
    path.join(home, '.volta/bin/node'),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return 'node'; // 最终回退
}

/**
 * 解析 npm 包的 JS 入口文件
 *
 * 绕过 .cmd 文件，直接执行 JS 文件
 */
function resolveNpmPackageEntry(packageDir: string, binName?: string): string | null {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

  // 从 package.json 的 bin 字段获取入口
  let binPath: string | undefined;
  if (typeof pkg.bin === 'string') {
    binPath = pkg.bin;
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    const name = binName || pkg.name;
    binPath = name ? pkg.bin[name] : Object.values(pkg.bin)[0] as string;
  }

  if (binPath) {
    const entryPath = path.join(packageDir, binPath);
    if (fs.existsSync(entryPath)) return entryPath;
  }

  return null;
}

/**
 * 跨平台无窗口启动 JS 文件
 */
export function spawnJsFile(
  jsFile: string,
  args: string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  let node: string;
  let env: Record<string, string | undefined>;

  if (process.platform === 'win32') {
    // Windows: 使用 Electron bundled Node
    node = process.execPath;
    env = {
      ...process.env,
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1', // 让 Electron 以 Node.js 模式运行
    };
  } else {
    // macOS/Linux: 使用系统 node
    node = findSystemNode();
    env = {
      ...process.env,
      ...options.env,
      PATH: resolveUserShellPath() || process.env.PATH,
    };
  }

  return spawn(node, [jsFile, ...args], {
    ...options,
    env,
    windowsHide: true, // 防止 Windows 控制台窗口
  });
}

/**
 * 启动 npm 包（自动解析入口）
 */
export function spawnNpmPackage(
  packageDir: string,
  args: string[] = [],
  options: SpawnOptions = {},
  binName?: string,
): ChildProcess | null {
  const entryFile = resolveNpmPackageEntry(packageDir, binName);
  if (!entryFile) return null;

  return spawnJsFile(entryFile, args, options);
}
```

#### 2. 使用示例

```typescript
import { spawnJsFile, spawnNpmPackage } from './utils/spawnNoWindow';

// 启动 JS 文件
const child1 = spawnJsFile('/path/to/script.js', ['--port', '8080']);

// 启动 npm 包
const child2 = spawnNpmPackage(
  '/path/to/node_modules/mcp-stdio-proxy',
  ['proxy', '--port', '9000'],
  { env: { CUSTOM_VAR: 'value' } },
  'mcp-proxy' // bin 名称（可选）
);

// 处理输出
child2.stdout?.on('data', (data) => {
  console.log('stdout:', data.toString());
});

child2.stderr?.on('data', (data) => {
  console.error('stderr:', data.toString());
});
```

## 方案对比

| 方案 | Windows 弹窗 | macOS Dock | API 兼容 | 依赖 |
|------|:------------:|:----------:|:--------:|------|
| **系统 node + spawn** | ❌ CMD 弹窗 | ✅ 无 Dock | ✅ spawn | 系统安装 node |
| **Electron + ELECTRON_RUN_AS_NODE** | ✅ 无弹窗 | ❌ 有 Dock | ✅ spawn | 无 |
| **平台差异化（本方案）** | ✅ 无弹窗 | ✅ 无 Dock | ✅ spawn | macOS/Linux 需系统 node |
| **child_process.fork()** | ✅ 无弹窗 | ✅ 无 Dock | ⚠️ IPC | 无 |
| **utilityProcess.fork()** | ✅ 无弹窗 | ✅ 无 Dock | ⚠️ MessagePort | Electron 22+ |

### 为什么选择平台差异化方案

1. **保持 spawn API** - 支持 stdio 流式通信（ACP 协议需要 NDJSON）
2. **兼容原生模块** - fork() 在 Electron 中对原生模块有兼容问题
3. **无需修改 Info.plist** - 不影响主应用的 Dock 行为
4. **参考 LobsterAI** - 已经过生产环境验证

## 替代方案

### 1. Electron utilityProcess（官方推荐）

Electron 22+ 提供的官方 API，使用 Chromium Services API：

```typescript
const { utilityProcess } = require('electron');

const child = utilityProcess.fork('./worker.js', ['--arg'], {
  stdio: 'pipe',
  serviceName: 'MyService'
});

// 使用 MessagePort 通信
child.postMessage({ data: 'hello' });
child.on('message', (msg) => console.log(msg));
```

**限制**：
- 只能在 Electron 主进程使用
- 使用 MessagePort 而非 stdio
- 需要重构现有通信层

### 2. child_process.fork()

```typescript
const { fork } = require('child_process');

const child = fork('./worker.js', ['--arg']);

// 使用 IPC 通信
child.send({ data: 'hello' });
child.on('message', (msg) => console.log(msg));
```

**限制**：
- 使用 IPC 而非 stdio
- 在 Electron 中对原生模块有兼容问题
- 依赖 ELECTRON_RUN_AS_NODE（可能被 Fuse 禁用）

### 3. Info.plist 配置（仅 macOS）

对于纯后台应用，可以在打包时配置：

```json
// electron-builder 配置
{
  "mac": {
    "extendInfo": {
      "LSUIElement": 1  // 不显示 Dock 图标
    }
  }
}
```

**限制**：
- 只影响 macOS
- 会影响整个应用（包括主应用）

## 测试验证

### 测试用例

```typescript
describe('spawnNoWindow', () => {
  describe('Windows 行为', () => {
    it('应使用 ELECTRON_RUN_AS_NODE=1', () => {
      // 模拟 Windows 平台
      Object.defineProperty(process, 'platform', { value: 'win32' });

      spawnJsFile('/path/to/script.js');

      expect(callArgs[0]).toBe(process.execPath);
      expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBe('1');
    });
  });

  describe('macOS/Linux 行为', () => {
    it('应使用系统 node，不设置 ELECTRON_RUN_AS_NODE', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      spawnJsFile('/path/to/script.js');

      expect(callArgs[0]).toBe('/usr/local/bin/node'); // 系统 node
      expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });
  });
});
```

### 验证步骤

1. **Windows 验证**：
   - 运行应用，触发子进程启动
   - 确认无 CMD 窗口弹出

2. **macOS 验证**：
   - 运行应用，触发子进程启动
   - 确认 Dock 中无新图标出现

3. **Linux 验证**：
   - 运行应用，触发子进程启动
   - 确认无意外的任务栏图标

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/main/services/utils/spawnNoWindow.ts` | 核心工具模块 |
| `src/main/services/utils/spawnNoWindow.test.ts` | 单元测试 |
| `src/main/services/packages/mcp.ts` | MCP Proxy 启动（使用此工具） |

---

## 内置 Node.js 24 和 Git 集成（2026-02-27）

### 背景

参考 [LobsterAI 方案](https://github.com/netease-youdao/LobsterAI)：

- Electron 内置的 Node.js **不包含 npm/npx**
- Windows 用户通常没有预装 Node.js
- 需要集成独立的 Node.js 和 Git

### 集成方案

#### 1. 脚本准备

| 脚本 | 功能 |
|------|------|
| `scripts/prepare/prepare-node.js` | 下载 Node.js 24 到 resources/node/ |
| `scripts/prepare/prepare-git.js` | 下载 PortableGit 到 resources/git/（仅 Windows） |

#### 2. 打包配置

```json
// package.json
"extraResources": [
  { "from": "resources/node", "to": "node" },
  { "from": "resources/git", "to": "git" }
]
```

#### 3. PATH 优先级（Windows）

```
1. resources/node/bin        ← 内置 Node.js 24（最高）
2. Electron 内置 Node
3. resources/git/bin       ← 内置 Git
4. 应用内 node_modules
5. uv
6. Windows 系统目录（System32, Wbem, PowerShell）
7. 注册表最新 PATH        ← 用户后安装的工具
```

#### 4. 环境变量

| 变量 | 说明 |
|------|------|
| `NUWAXCODE_NODE_DIR` | nuwaxcode-acp 使用 |
| `CLAUDE_CODE_NODE_DIR` | claude-code-acp-ts 使用 |
| `NUWAXCODE_GIT_BASH_PATH` | nuwaxcode-acp 使用 |
| `CLAUDE_CODE_GIT_BASH_PATH` | claude-code-acp-ts 使用 |
| `MSYS2_PATH_TYPE=inherit` | git-bash 正确继承 PATH |
| `ORIGINAL_PATH` | POSIX 格式 PATH |

#### 5. Windows 特殊优化

- **关键系统变量**：SystemRoot, windir, COMSPEC, SYSTEMDRIVE
- **系统目录 PATH**：System32, System32\Wbem, WindowsPowerShell, OpenSSH
- **注册表读取**：从注册表读取最新 PATH，解决后安装工具不在 PATH 问题
- **Electron Node Shim**：创建 node/npm 桥接脚本

### 相关文件

| 文件 | 说明 |
|------|------|
| `scripts/prepare/prepare-node.js` | Node.js 下载脚本 |
| `scripts/prepare/prepare-git.js` | Git 下载脚本 |
| `src/main/services/system/dependencies.ts` | 环境变量配置 |
| `src/main/services/engines/engineManager.ts` | 引擎启动（使用此工具） |
| `src/main/services/engines/acp/acpClient.ts` | ACP 客户端（使用此工具） |

## 参考资料

### 官方文档

- [Node.js child_process 文档](https://nodejs.org/api/child_process.html) - `windowsHide` 选项说明
- [Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process) - Electron 22+ 推荐方案
- [Electron Dock API](https://www.electronjs.org/docs/latest/api/dock) - macOS Dock 控制
- [Electron Fuses - runAsNode](https://www.electronjs.org/docs/latest/tutorial/fuses) - ELECTRON_RUN_AS_NODE 安全控制

### GitHub Issues

- [electron/electron #2634](https://github.com/electron/electron/issues/2634) - Electron spawn 子进程问题
- [electron/electron #8727](https://github.com/electron/electron/issues/8727) - fork 和原生模块兼容问题
- [anthropics/claude-agent-sdk-python #480](https://github.com/anthropics/claude-agent-sdk-python/issues/480) - Windows subprocess 终端窗口隐藏
- [tauri-apps/tauri #4179](https://github.com/tauri-apps/tauri/discussions/4179) - Tauri 启动后隐藏 CMD 窗口

### 社区方案

- [LobsterAI coworkUtil.ts](https://github.com/LobsterAI/LobsterAI) - shell PATH 解析参考（本方案灵感来源）
- [cross-spawn](https://www.npmjs.com/package/cross-spawn) - 跨平台 spawn 封装（仍使用 .cmd 文件）
- [nano-spawn](https://www.npmjs.com/package/nano-spawn) - 现代 spawn 替代方案

## 更新历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-25 | 1.0 | 初始版本，记录完整解决方案 |
| 2026-02-25 | 1.1 | 添加社区讨论和 GitHub Issues 参考 |

---

*文档维护：Nuwax Agent 开发团队*
