# Electron 更新通道发布说明（stable / beta）

## 当前开发线

- 0.15 系列开发分支：`feature/electron-client-0.15`。
- 首个 beta：客户端版本 `0.15.0`，标签 `prerelease-v0.15.0`。
- 首个 stable：客户端版本 `0.15.0`，标签 `electron-v0.15.0`。
- 客户端版本维护在 `crates/agent-electron-client/package.json`；独立共享包继续维护各自版本。

## 发布约定

- 先发布 beta 验证，再发布 stable。
- beta 使用 `prerelease-vX.Y.Z` 标签，触发本仓 `release-electron-dev.yml`：五平台构建、GitHub Draft Prerelease、MinIO 资产同步及 OSS beta 指针更新。
- stable 使用 `electron-vX.Y.Z` 标签，触发本仓 `release-electron.yml`；已有 Release 的通道同步由手动 workflow 参数 `tag` 与 `channel` 指定。
- 当前发布脚本接受数字 `x.y.z` 版本。beta 身份由标签前缀、GitHub prerelease 标记与 beta 更新通道表达，不使用 `-beta` / `-rc` 版本后缀。
- 本仓直接维护源码、构建与发布流程，无需同步其他产品壳或初始化基座子模块。

## 更新地址

- stable 指针：`nuwaclaw-electron/latest/latest.json`。
- beta 指针：`nuwaclaw-electron/beta/latest.json`。
- stable 版本目录：`nuwaclaw-electron/electron-vX.Y.Z/`。
- beta 版本目录：`nuwaclaw-electron/beta-build/prerelease-vX.Y.Z/`。

默认用户通道为 stable。切换通道只更新 `update_channel` 配置，beta 发布只更新 beta 指针；正式用户通道继续使用原 stable 版本。

## 发版核验

1. 推送对应开发分支、版本提交和唯一的发布标签。
2. 确认 prepare、五个平台构建和同步 job 均成功；同步 job 设置了 continue-on-error，必须独立检查其最终 conclusion。
3. 检查 GitHub Release 的平台产物、版本化元数据及 CDN beta/stable 指针，确认版本、文件大小和摘要匹配。
4. 完成目标设备验收后，再按正式版标签发布 stable。
