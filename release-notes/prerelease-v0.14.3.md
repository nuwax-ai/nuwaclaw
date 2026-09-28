NuwaClaw 0.14.3 (Prerelease)

Codex 引擎修复与内置文件服务升级版本。

- 修复 Codex 引擎会话发消息即报「Failed to create engine: ACP connection closed」的问题：引擎命令别名映射缺失，服务端按适配器包名 nuwax-codex-acp-ts 下发引擎命令时，客户端未能识别为 Codex 引擎，以裸命令名启动失败（spawn ENOENT）；现正确路由到随包内置的 Codex 适配器（与商业线基座修复 1016f189 同源，社区线 8af79c61）
- Codex 引擎其余修复：api-key 鉴权协议对齐（此前被 -32600 拒绝致 init 必挂）、自定义网关跳过 authenticate（此前回退内置 openai provider 打 api.openai.com 403）、CODEX_HOME/CODEX_SQLITE_HOME 隔离目录（修复 Windows 侧损坏 sqlite 库/并发锁直接杀引擎）
- 内置 nuwax-file-server 升级至 1.5.4（自 1.4.7：文件选择框支持新建目录/重命名、文件元数据查询、搜索支持类型/深度/含隐藏目录、文件查询支持类型和数量、git 原生优先与乱码处理、超时配置、常规项目目录修复等）
- computer 模块：agent_work_dir 双轨制支持本机绝对路径（web 端工作空间选择打通）
- 构建优化：禁跑已废弃 codex 构建脚本（CI 止血双下载 115MB）、排除 legacy codex-acp 产物

