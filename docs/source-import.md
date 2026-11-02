# NuwaClaw 源码迁入记录

- 迁移日期：2026-11-02。
- 来源：`nuwax-ai/nuwa-electron-shell` 的 `community/main`。
- 锁定提交：[`a576fc4ba8ff2d86ed62d45222daf5e698ab8e99`](https://github.com/nuwax-ai/nuwa-electron-shell/commit/a576fc4ba8ff2d86ed62d45222daf5e698ab8e99)。
- 原基座 pin：`ea791d96740fd509fdf52f7e943df6eef0ab9828`。

本次将上述提交受 Git 跟踪的完整源码与工程配置迁入 NuwaClaw 根目录，保留原文件权限及符号链接。当前仓库继续保留自身 Git 历史、产品介绍、历史发布记录，以及正式版、预发布、签名和 OSS/MinIO 同步流程。业务源码保持来源提交内容，迁移适配集中在根目录开发入口、仓库说明、CI/发布路径，以及本地无签名打包的证书环境处理。

客户端、agent-kit、GUI Agent MCP 与 Windows helper 都由本仓直接维护；不再使用基座子模块、基座命令转发或基座拉取认证。后续开发直接提交到本仓。构建身份、端口、数据目录和更新通道保持社区默认行为，Webview 仍访问配置域上的 nuwax。

导入采用 Git 提交快照，未导入原工作目录中的依赖、缓存或未跟踪前端。本机旧基座工作目录及其 Git 数据在清理前已移至仓库外备份；其他本地前端工作目录保持独立，不纳入此次源码导入。

根目录开发、测试与打包命令见 [README.md](../README.md)。历史发布记录、归档文档和旧方案可能仍描述迁移前的架构，不能作为当前开发入口。

## 本次验证（2026-11-02）

环境：macOS arm64，Node.js 24.22.1，pnpm 9.15.5。

- 全部 779 个来源文件已迁入，其中 769 个文件与来源完全相同，10 个文件包含明确适配。业务运行时源码逐文件一致；适配限于仓库说明、开发入口、CI 与本地无签名打包的证书环境处理。
- 从暂存快照建立独立本地仓库并正常克隆：797 个受跟踪文件、0 个 gitlink，无需初始化子模块，根目录 `make help` 可运行。
- 干净依赖安装使用来源锁文件并通过 `--frozen-lockfile`；agent-kit 构建与 84 项测试通过，构建脚本 29 项测试和导入边界检查通过。
- Electron 主进程与渲染进程生产构建通过。根目录 `make electron-bundle-unsigned` 的资源准备链路通过。修正证书环境后，使用同一打包入口 `dist:unsigned:local` 完成应用封装与 macOS arm64 DMG 生成；DMG 通过 `hdiutil verify` 完整性校验。
- actionlint 校验通过，66 个工作流 shell 步骤通过 Bash 语法检查。正式版与预发布工作流各保留五个平台；对 YAML 结构比较，除移除基座初始化和调整目录外，发布行为一致。PR 标题校验改为环境变量传参以通过 actionlint 检查。
- Electron CI 测试集合（排除真实系统沙箱集成测试）结果：98 个测试文件通过、7 个失败；1286 项测试通过、28 项失败、1 项跳过，另有 2 个测试文件加载失败。对未修改的来源快照使用相同依赖复跑，失败用例与汇总完全一致。

已有测试失败涉及日志 mock、MCP mock/模拟资源路径、系统依赖 mock、Windows Shell 路径断言。此次保留来源业务源码和测试，未把已有失败隐藏为跳过项。真实系统沙箱集成测试、Windows/Linux 安装运行验收及线上发布不在本机验证结果内。

本地打包还复现并修正了来源脚本的已有问题：`dist:unsigned:local` 将 `CSC_LINK` / `WIN_CSC_LINK` 设为空字符串，electron-builder 会尝试把当前目录作为证书文件读取。现改为从子进程环境删除这些键，继续禁止签名自动发现和发布；macOS、Windows、Linux 的命令环境检查均通过。此改动只涉及构建脚本，未修改客户端运行时源码。

已检查 macOS 应用包的 asar 主入口、原生 SQLite（arm64）、Node、uv、ripgrep、MCP 代理、GUI Agent、文件服务与 Claude ACP 适配器。应用标识与版本匹配来源配置。随包 Node 为 24.14.0、uv 为 0.10.8、ripgrep 为 14.1.1。

本机 macOS arm64 无签名产物已生成，版本使用来源包的 `0.14.0`：

- `crates/agent-electron-client/release/0.14.0/NuwaClaw-0.14.0-arm64.dmg`：通过镜像完整性校验。
- `crates/agent-electron-client/release/0.14.0/NuwaClaw-0.14.0-arm64-mac.zip`：35467 个条目全部通过 CRC 校验。

最高压缩 ZIP 的验证进程因耗时中止；本机验收 ZIP 使用同一已封装应用，通过 `electron-builder --prepackaged release/0.14.0/mac-arm64/NuwaClaw.app --mac zip --arm64 --config.compression=normal --publish never` 生成。正式发布脚本的压缩配置保留原值；本次未签名、公证或发布安装包。
