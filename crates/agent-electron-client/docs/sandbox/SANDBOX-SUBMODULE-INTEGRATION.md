# Sandbox 子模块集成说明

## 目标

将三端沙箱运行时统一从 `crates/agent-sandbox-runtime` 同步到 Electron `resources`：

- 目标目录: `resources/sandbox-runtime/bin`
- 打包映射: `build.extraResources -> sandbox-runtime`

## 当前接入点

1. 脚本: `scripts/prepare/prepare-sandbox-runtime.js`
2. npm script: `prepare:sandbox-runtime`
3. 构建链: `prepare:all` 已串联 `prepare:sandbox-runtime`
4. 签名: `scripts/build/after-sign.js` 已覆盖 `resources/sandbox-runtime`

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
      "source": "artifacts/windows/x64/codex-sandbox-helper.exe",
      "sha256": "...",
      "targetName": "codex-sandbox-helper.exe"
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
  - `windows.codex.mode=unelevated`

`backend=auto` 映射：

- macOS -> `macos-seatbelt`
- Linux -> `linux-bwrap`
- Windows -> `windows-codex`

## 注意事项

1. 子模块未初始化时，`prepare-sandbox-runtime` 会告警并跳过，不中断构建。
2. Windows helper setup 目前为占位实现，后续由 `sandbox:setup` 补全真实 setup 流程。
3. 当前 WorkspaceManager 仍以 Docker 全量执行链路为主，其他后端已完成策略与资源接入框架。
