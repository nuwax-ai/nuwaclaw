# Electron 更新通道发布说明（stable / beta）

## 目标

- 发版顺序：先 `beta` 验证，再 `stable` 推广。
- 默认用户通道：`stable`，不影响已安装旧版客户端的默认更新行为。
- 通道切换仅改配置（`update_channel`），不需要重新打包。

## OSS 指针约定

- `stable`：`nuwaclaw-electron/latest/latest.json`
- `beta`：`nuwaclaw-electron/beta/latest.json`
- 版本产物目录：`nuwaclaw-electron/electron-vX.Y.Z/`

## Workflow 触发参数

- `tag`：如 `electron-v0.9.0`
- `channel`：`stable` 或 `beta`（默认 `stable`）

> `channel=beta` 时，只更新 `beta/latest.json`，不会覆盖 `latest/latest.json`。

## 建议流程

1. 发布资产到 GitHub Release（`electron-vX.Y.Z`）。
2. 预发验证：运行同步 workflow，参数 `channel=beta`。
3. 验证通过后：再次运行同步 workflow，参数 `channel=stable`。

## 发布前检查清单

- 版本号必须是 `x.y.z`（MVP 不支持 `-beta`、`-rc` 等 prerelease 版本号）。
- `latest.json` 里的 `version` 与 OSS 目录 `electron-vX.Y.Z` 一致。
- 若本次仅预发，确认不会写入 `latest/latest.json`。
- `nuwax-agent` 与 `nuwaclaw` 两边 workflow 内容保持一致（以 release 仓库实际执行结果为准）。

