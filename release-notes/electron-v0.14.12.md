NuwaClaw 0.14.12 (Stable)

修复常规项目工作区目录问题 + 内置文件服务升级（自 0.14.11 stable / 0.14.12 beta 收敛转正）。

- 修复常规项目（normalProject）工作区目录建错位置的问题：此前客户端会在 `computer-project-workspace/{userId}/{projectId}`（影子目录）另建一套目录，与平台侧已建好的 `normalProject/{projectId}` 目录并行，导致文件/技能落两处；现统一为 `computer-project-workspace/{userId}/normalProject/{projectId}` 三段布局（镜像云端容器布局），会话工作区、agent 引擎与内嵌终端 cwd 三处一致（对齐商业版实现）
- 内嵌终端：终端路由支持 service_type/cwd query 契约；normalProject 终端目录判据放宽为存在即用（空目录是新项目合法初始态）
- 内置 nuwax-file-server 升级至 1.6.0（自 1.5.5：软链逃逸处理、文件查询优化、技能推送失败不影响 chat、若干 bug 修复）；npm 兜底 installVersion 同步对齐 1.6.0
- 其余与 0.14.11 相同
