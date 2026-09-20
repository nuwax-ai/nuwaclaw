NuwaClaw 0.14.4 (Prerelease)

修复部分 Windows 机器上 Codex 引擎会话报「Failed to create engine: failed to initialize sqlite state runtime」的问题。

- Codex 引擎状态目录隔离：Windows 上 Codex 引擎此前在用户真实 ~/.codex 下初始化 SQLite 状态库，本机已有的损坏状态库、与其他 Codex 进程并发的文件锁都会直接导致引擎启动失败；现通过 CODEX_HOME/CODEX_SQLITE_HOME 将配置与全部 SQLite 数据库指向客户端管理的按项目隔离目录，不再读写用户本机 ~/.codex（与商业线基座修复 9392f459 同源，社区线 4586f679）
- 其余与 0.14.3 相同
