NuwaClaw 0.14.1 (Prerelease)

内置文件服务升级与稳定性修复版本。

- 内置 nuwax-file-server 升级至最新 1.4.7（workspaceType 空间类型定位、git 操作 bug 修复）
- 应用退出前等待托管进程结束，减少进程残留
- guest preload 补全宿主身份（host.getProduct）
- productName 统一 ASCII 化（NuwaClaw）
- 仓库切换为「产品壳 + 基座 submodule」结构，基座同步社区融合线最新
