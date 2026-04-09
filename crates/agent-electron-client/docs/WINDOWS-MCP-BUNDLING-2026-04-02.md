# Windows-MCP 打包集成文档

本文档说明如何将 windows-mcp 预打包到 Electron 客户端中，避免用户首次使用时从 PyPI 下载。

## 背景

windows-mcp 是 Python MCP 服务器，提供 Windows 桌面自动化能力。原实现通过 `uv tool run windows-mcp` 动态从 PyPI 下载安装，首次启动可能因网络原因超时失败。

打包后，随应用附带 **离线 wheel 包**；用户在首次启动时由本机 `uv tool install` 从该目录安装到用户数据目录，一般无需再访问 PyPI。

## 架构

### 打包产物（resources → extraResources）

`prepare-windows-mcp.js` 在 **Windows 打包机**上执行，生成：

```
resources/windows-mcp/
├── manifest.json       # 解析出的版本与 resolvedSpec（如 windows-mcp==0.7.1）
└── wheels/
    └── *.whl           # 及其传递依赖的 wheel（仅二进制包）
```

**不会**在 `resources/windows-mcp/bin/` 下预生成 `windows-mcp.exe`；可执行文件在用户首次运行客户端时安装到用户目录（见下）。

### 运行时路径

- **随包资源**：`process.resourcesPath/windows-mcp/`（含 `wheels/`、`manifest.json`）
- **安装后的可执行文件**：`%USERPROFILE%\.nuwaclaw\windows-mcp-runtime\<version>\bin\windows-mcp.exe`（由 `windowsMcp.ts` 中的 `uv tool install` 创建）

日志中启动阶段为 **`[WindowsMcp] Starting (runtime) on port ...`**（不是 “bundled” 直启 exe）。

## 相关文件

| 文件 | 说明 |
|------|------|
| `scripts/prepare/prepare-windows-mcp.js` | 打包脚本：用 bundled `uv` 拉取 wheel 并写 manifest |
| `src/main/services/packages/windowsMcp.ts` | 运行时：`uv tool install`（离线优先）与进程启动 |
| `src/main/services/system/dependencies.ts` | `getWindowsMcpBinPath()`（可选 legacy 路径，当前主线未使用） |
| `package.json` | prepare 脚本和 extraResources 配置 |

## 实现方案

### 打包时（Windows CI / 本地 Windows）

```bash
npm run prepare:windows-mcp
```

脚本执行：

1. 非 Windows 平台则跳过（直接返回）。
2. 校验 `resources/uv/bin/uv(.exe)` 存在。
3. 清空并重建 `resources/windows-mcp/`，创建 `wheels/`。
4. 调用 bundled uv：**新版 uv 已移除 `uv pip download`**，因此使用  
   `uv run --no-project --isolated --python <版本> -w pip python -m pip download ...`  
   将 `windows-mcp` 及其依赖的 **wheel** 下载到 `wheels/`。  
   脚本内 `PIP_DOWNLOAD_PYTHON` 须满足 PyPI 上 `windows-mcp` 的 `Requires-Python`，且 **`windowsMcp.ts` 中 `uv tool install --python` 须与之一致**，否则离线 wheel 的 cp 标签可能与运行时解释器不符。
5. 从 `windows_mcp-*.whl` 解析版本，写入 `manifest.json`。

打包机需要能访问 PyPI（或等价镜像）；**最终用户**在离线安装成功时无需外网。

### 运行时（Electron 启动）

见 `windowsMcp.ts`：`ensureWindowsMcpRuntime` 优先执行

`uv tool install --force --no-index --find-links <随包wheels目录> <resolvedSpec>`

失败时再回退 `uv tool install --force <resolvedSpec>`（在线）。

## 配置变更

### package.json

```json
{
  "scripts": {
    "prepare:windows-mcp": "node scripts/prepare/prepare-windows-mcp.js",
    "prepare:all": "... && npm run prepare:windows-mcp"
  },
  "build": {
    "win": {
      "extraResources": [
        {
          "from": "resources/windows-mcp",
          "to": "windows-mcp",
          "filter": ["**/*"]
        }
      ]
    }
  }
}
```

## 版本策略

- 每次在 Windows 上执行 prepare 时解析 **当前 PyPI 上满足 Python 约束的最新** `windows-mcp`（及依赖），版本写入 `manifest.json`。
- 用户升级客户端即可获得当时打包锁定的版本。

## 平台限制

| 平台 | 打包 | 运行 |
|------|------|------|
| Windows x64 | ✅ 支持 | ✅ 支持 |
| macOS | ⚠️ 跳过 | ❌ 不适用 |
| Linux | ⚠️ 跳过 | ❌ 不适用 |

## 测试验证

### 本地打包（Windows）

```bash
cd crates/agent-electron-client

npm run prepare:windows-mcp

dir resources\windows-mcp\wheels
type resources\windows-mcp\manifest.json

npm run dist:win
```

### 运行时验证

1. 启动 Windows 客户端。
2. 日志：`[WindowsMcp] offline_install_success` 或在线回退相关日志。
3. 确认 `windows-mcp-runtime` 下已生成 `bin\windows-mcp.exe`。

### 离线验证

1. 断开网络。
2. 删除已有 runtime 目录或强制重装后启动（视实现而定）。
3. 在 wheels 齐全时，应能通过离线 `uv tool install` 完成安装并启动。

## 常见问题

### Q: prepare 阶段需要网络吗？

A: 需要。prepare 要从索引下载 wheel；这与最终用户离线使用随包 wheels 不矛盾。

### Q: 如果 windows-mcp 打包失败会怎样？

A: `prepare-windows-mcp.js` 会 `process.exit(1)`，导致后续 `make electron-dev` / 打包失败。请保证 Windows 构建环境网络与 PyPI 可达。

### Q: CI 里没有本机 Python 怎么办？

A: 脚本通过 `uv run --python …` 使用 uv 管理的解释器；默认将 `UV_PYTHON_DOWNLOADS` 设为 `automatic`，以便首次拉取 CPython。若环境禁止下载，需预先提供满足 `Requires-Python` 的解释器或调整环境变量。

### Q: Python 依赖也会进 wheels 吗？

A: 会。`pip download` 会拉取传递依赖的 wheel（`--only-binary :all:` 要求均为预编译 wheel；若某依赖无 wheel，下载会失败）。

## 更新日志

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-04-02 | 0.10 | 初始集成（wheels + 运行时 uv tool install） |
| 2026-04-09 | — | 文档与注释对齐实际流程；prepare 改用 `uv run` + `pip download`（兼容移除 `uv pip download` 的 uv） |
