# Sandbox 子模块升级 Runbook

## 适用范围

- 主仓: `nuwax-agent`
- Electron 客户端: `crates/agent-electron-client`
- 子模块: `crates/agent-sandbox-runtime`

## 升级步骤

1. 更新子模块到目标 commit。
2. 检查 `manifest.json` 是否包含目标平台产物和 `sha256`。
3. 在 Electron 客户端执行：

```bash
npm run prepare:sandbox-runtime
```

4. 验证产物落地：
   - `resources/sandbox-runtime/bin`
   - `resources/sandbox-runtime/resolved-manifest.json`
5. 运行构建并验证 `after-sign` 日志包含 `sandbox-runtime`（Windows 另含 `sandbox-helper`）。

## 快速校验

```bash
node scripts/prepare/prepare-sandbox-runtime.js
npm run build:main
```

## 回滚步骤

1. 将子模块回退到上一个稳定 commit。
2. 重新执行 `npm run prepare:sandbox-runtime`。
3. 重新构建安装包并验证。

## 常见故障

1. `manifest 不存在`：子模块未初始化或路径错误。
2. `sha256 mismatch`：产物与清单不一致，拒绝继续。
3. `helper not found`（Windows）：未构建内置 helper（`npm run build:sandbox-helper`）且未通过子模块 `prepare:sandbox-runtime` 同步产物，或安装包未包含 `sandbox-helper` / `sandbox-runtime` 下的 exe。
