# Windows-MCP 打包集成文档

本文档说明如何将 windows-mcp 预打包到 Electron 客户端中，避免用户首次使用时从 PyPI 下载。

## 背景

windows-mcp 是 Python MCP 服务器，提供 Windows 桌面自动化能力。原实现通过 `uv tool run windows-mcp` 动态从 PyPI 下载安装，首次启动可能因网络原因超时失败。

打包后，用户安装新版本客户端即可自动获得最新 windows-mcp，无需额外下载。

## 架构

### 打包结构

```
resources/windows-mcp/bin/
├── windows-mcp.exe     # 主程序入口
└── ...                 # Python 依赖
```

### 运行时路径

```
打包后: process.resourcesPath/windows-mcp/bin/windows-mcp.exe
开发时: crates/agent-electron-client/resources/windows-mcp/bin/windows-mcp.exe
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `scripts/prepare/prepare-windows-mcp.js` | 打包脚本，调用 uv 安装 windows-mcp |
| `src/main/services/packages/windowsMcp.ts` | 运行时启动逻辑 |
| `src/main/services/system/dependencies.ts` | `getWindowsMcpBinPath()` 函数 |
| `package.json` | prepare 脚本和 extraResources 配置 |

## 实现方案

### 打包时（Windows CI）

```bash
npm run prepare:windows-mcp
```

脚本执行：
1. 检查 Windows 平台（非 Windows 跳过）
2. 检查 uv 可用性
3. 清理旧版本目录
4. 执行 `uv tool install windows-mcp --target resources/windows-mcp/bin/`
5. 验证安装

### 运行时（Electron 启动）

```
startWindowsMcp()
  │
  ├─ getWindowsMcpBinPath() 检查 bundled 路径
  │   │
  │   └─ 存在 → 直接调用 windows-mcp.exe（离线可用）
  │           └─ 日志: "[WindowsMcp] Starting (bundled) on port..."
  │
  └─ 不存在 → 回退到 uv tool run（可能需下载）
              └─ 日志: "[WindowsMcp] Using uv tool run (bundled not found)"
```

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

### extraResources 结构

打包后 `.app/Contents/Resources/` 或安装包内包含：

```
windows-mcp/bin/
├── windows-mcp.exe
├── windows_mcp/          # Python 包
└── ...其他依赖
```

## 版本策略

- windows-mcp 版本：**latest**（跟随 Electron 客户端版本）
- 每次打包时自动获取最新版本
- 用户升级客户端即可获得最新 windows-mcp

## 平台限制

| 平台 | 打包 | 运行 |
|------|------|------|
| Windows x64 | ✅ 支持 | ✅ 支持 |
| macOS | ⚠️ 跳过（仅检查 uv） | ❌ 不适用 |
| Linux | ⚠️ 跳过（仅检查 uv） | ❌ 不适用 |

## 测试验证

### 本地打包（Windows）

```bash
cd crates/agent-electron-client

# 1. 运行 prepare 脚本
npm run prepare:windows-mcp

# 2. 检查生成的文件
dir resources\windows-mcp\bin\

# 3. 完整打包
npm run dist:win
```

### 运行时验证

1. 启动 Windows 客户端
2. 检查日志中是否包含 `[WindowsMcp] Starting (bundled)`
3. 确认无 PyPI 下载日志

### 离线验证

1. 断开网络
2. 启动 Windows 客户端
3. windows-mcp 应正常启动（使用打包的二进制）

## 回退机制

如果打包不完整或路径错误，运行时自动回退到 `uv tool run`：

```typescript
// windowsMcp.ts 第 52-88 行
if (!windowsMcpBinPath) {
  // 回退到 uv tool run
  const uvPath = getUvBinPath();
  // ...
}
```

## 常见问题

### Q: uv tool install --target 需要网络吗？

A: 是的，首次安装需要网络下载 windows-mcp 包。这是正常的打包过程，不影响最终用户。

### Q: 如果 windows-mcp 打包失败会怎样？

A: `prepare-windows-mcp.js` 会 `process.exit(1)`，导致打包失败。需要确保 Windows CI 环境网络正常。

### Q: 回退机制会导致用户首次使用时还是需要下载吗？

A: 不会。回退仅在打包文件缺失时触发（正常情况下不会发生）。用户安装的客户端已包含打包的 windows-mcp。

### Q: Python 依赖（如 pywin32）也会打包吗？

A: `uv tool install --target` 会将所有依赖安装到目标目录，包括 Python 原生依赖。完整打包。

## 更新日志

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-04-02 | 0.10 | 初始集成，使用 uv tool install --target 打包 |
