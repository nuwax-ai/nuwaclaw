NuwaClaw 0.14.5 (Prerelease)

修复 Codex 引擎会话报「Failed to create engine: Invalid request」的问题。

- 修复鉴权握手协议不匹配：客户端在 ACP 初始化后发起的鉴权请求使用了引擎适配器协议中不存在的鉴权方式标识（codex-api-key），适配器按非法请求拒绝（-32600 Invalid request），导致 Codex 引擎初始化必然失败（自 Codex 引擎接入以来一直存在，此前被更早的启动失败掩盖）。现改用适配器协议定义的 api-key 方式，密钥继续经环境变量下发；鉴权激活失败时不再阻断引擎启动（与商业线基座修复 071147ea 同源，社区线 43ef601d）
- 其余与 0.14.4 相同
