NuwaClaw 0.14.8 (Prerelease)

内置文件服务升级与构建优化版本。

- 内置 nuwax-file-server 升级至 1.5.4（自 1.5.2：文件查询支持类型和数量、搜索文件支持传类型/深度/不过滤隐藏目录、git 原生优先与乱码处理）；npm 兜底 installVersion 同步对齐 1.5.4
- codex 引擎只走 nuwax-codex-acp-ts：禁跑已废弃构建脚本（CI 止血双下载 115MB）、排除 legacy codex-acp 产物；acp-ts 依赖放宽 ^ 随上游跟新
- computer 模块：agent_work_dir 双轨制支持本机绝对路径（web 端工作空间选择打通）
