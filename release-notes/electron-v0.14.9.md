NuwaClaw 0.14.9 (Stable)

0.14 系列 prerelease（0.14.0 ~ 0.14.8）验证收敛后的正式版。

Codex 引擎稳定性（四连修复）：

- 修复会话启动报「ACP connection closed」：服务端按适配器包名下发的引擎命令此前未被识别，裸命令启动失败（spawn ENOENT）
- 修复 Windows 上报「failed to initialize sqlite state runtime」：Codex 状态库隔离到客户端管理的按项目目录（CODEX_HOME/CODEX_SQLITE_HOME），不再读写用户本机 ~/.codex，避免损坏状态库与并发文件锁直接杀引擎
- 修复报「Invalid request」必挂：鉴权握手改用适配器协议定义的 api-key 方式；鉴权激活失败降级告警不再阻断启动
- 修复配自定义网关时模型请求 403：网关模式跳过鉴权握手，自定义模型服务定义不再被清除回退内置 OpenAI 服务

computer 工作目录：

- agent_work_dir 双轨制：web 端工作空间选择打通，支持本机绝对路径（存在性/可写校验 + 路径归一化），存量标识符轨道不受影响

内置文件服务（nuwax-file-server）1.4.4 → 1.5.4：

- workspaceType 空间类型定位、git 操作修复
- 文件选择框支持新建目录与重命名，文件名支持前后空格
- 文件查询支持类型和数量；搜索文件支持传类型/深度/不过滤隐藏目录；git 原生优先与乱码处理

平台与架构：

- 修复 macOS 启动即崩溃（Unable to find helper app）：包内 CFBundleName 与 Helper 命名对齐
- 仓库切换为「产品壳 + 基座 submodule」三层架构；productName 统一 ASCII 化（NuwaClaw）
- 应用退出前等待托管进程结束，减少进程残留
- codex 引擎仅走 nuwax-codex-acp-ts：排除 legacy codex-acp 产物，安装体积止血（CI 双下载 115MB）
