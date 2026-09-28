NuwaClaw 0.14.3 (Prerelease)

修复 Codex 引擎会话发消息即报「Failed to create engine: ACP connection closed」的问题。

- 修复引擎命令别名映射缺失：服务端按适配器包名 nuwax-codex-acp-ts 下发引擎命令时，客户端未能识别为 Codex 引擎，以裸命令名启动失败（spawn ENOENT）；现正确路由到随包内置的 Codex 适配器（与商业线基座修复 1016f189 同源，社区线 8af79c61）
- 其余与 0.14.2 相同：macOS 启动崩溃修复、内置 nuwax-file-server 1.4.7 等
