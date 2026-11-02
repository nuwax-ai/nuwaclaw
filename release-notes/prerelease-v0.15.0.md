NuwaClaw 0.15.0 (Prerelease / Beta)

0.15 系列首个 beta：客户端源码、开发工具和发布流程统一回到 NuwaClaw 仓库。

- 将原基座 community/main 的完整源码迁入工程根目录，来源提交为 a576fc4ba8ff2d86ed62d45222daf5e698ab8e99；保留原仓库历史及社区版配置。
- 移除基座子模块、命令转发和子模块初始化流程。开发、测试、构建和打包直接在当前仓库完成。
- 正式版与 beta 发布流程适配根目录源码，保留 macOS arm64/x64、Windows x64、Linux x64/arm64 五个平台，以及签名和 beta 更新通道。
- 继承 0.14 分支最新修复：构建固定使用 Node 24，避免 lts/* 漂移到 Node 26 后原生依赖缺少预编译包；Chrome DevTools MCP 使用自研 fork 并禁用 webdriver 自动化标记。
- 修复本地无签名打包时空证书链接被误识别为当前目录的问题。

迁移验证：agent-kit 84 项测试、构建脚本 29 项测试、导入边界检查、生产构建及本机 macOS arm64 无签名包完整性校验通过。Electron CI 测试集合的 28 项测试失败和 2 个测试文件加载失败，与未修改的来源快照完全一致，详见 docs/source-import.md。

此版本进入 beta 更新通道；默认 stable 通道保持现有版本。
