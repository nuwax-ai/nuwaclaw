# Sandbox 子模块集成说明

**范围**：文中的 `nuwax-sandbox-helper`、`resources/sandbox-helper` 以及 manifest 里 `win32-*` 产物**仅用于 Windows 客户端**沙箱；macOS / Linux 分别走 seatbelt / bwrap，不依赖上述 exe。

## 目标

将三端沙箱运行时统一从 `crates/agent-sandbox-runtime` 同步到 Electron `resources`：

- 目标目录: `resources/sandbox-runtime/bin`
- 打包映射: `build.extraResources -> sandbox-runtime`

## 当前接入点

1. 脚本: `scripts/prepare/prepare-sandbox-runtime.js`
2. npm script: `prepare:sandbox-runtime`
3. Windows 内置 helper: `crates/windows-sandbox-helper` → `npm run build:sandbox-helper`（Windows 上 `prepare:all` 会通过 `prepare:sandbox-helper-win` 自动构建），产出 `resources/sandbox-helper/nuwax-sandbox-helper.exe`；Windows 安装包 `extraResources` 映射为 `sandbox-helper/*.exe`
4. 构建链: `prepare:all` 已串联 `prepare:sandbox-helper-win` 与 `prepare:sandbox-runtime`
5. 签名: `scripts/build/after-sign.js` 已覆盖 `resources/sandbox-runtime` 与 `resources/sandbox-helper`（Windows）

## 子模块清单约定

`crates/agent-sandbox-runtime/manifest.json` 支持以下最小结构：

```json
{
  "version": "x.y.z",
  "platforms": {
    "linux-x64": {
      "source": "artifacts/linux/x64/bwrap",
      "sha256": "..."
    },
    "win32-x64": {
      "source": "artifacts/windows/x64/nuwax-sandbox-helper.exe",
      "sha256": "...",
      "targetName": "nuwax-sandbox-helper.exe"
    }
  }
}
```

## 运行时策略与后端

- 策略键: `settings.sandbox_policy`
- 默认策略:
  - `enabled=true`
  - `mode=non-main`
  - `backend=auto`
  - `fallback=degrade_to_off`
  - `windows.sandbox.mode=read-only` 或 `workspace-write`

`backend=auto` 映射：

- macOS -> `macos-seatbelt`
- Linux -> `linux-bwrap`
- Windows -> `windows-sandbox`（探测 `nuwax-sandbox-helper.exe`）

## 注意事项

1. 子模块未初始化时，`prepare-sandbox-runtime` 会告警并跳过，不中断构建。
2. Windows helper setup 目前为占位实现，后续由 `sandbox:setup` 补全真实 setup 流程。
3. 当前 WorkspaceManager 仍以 Docker 全量执行链路为主，其他后端已完成策略与资源接入框架。
