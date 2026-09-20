NuwaClaw 0.14.6 (Prerelease)

修复 Codex 引擎会话模型请求报 403（Country, region, or territory not supported）的问题。

- 修复自定义模型网关被鉴权握手清除的问题：上一版使鉴权握手成功执行后，适配器会先清空环境变量自动装配的自定义网关配置（网关模式本就无需登录），导致会话不携带自定义模型服务定义，Codex 回退到内置 OpenAI 服务（api.openai.com）在不可用区域报 403。现配了自定义模型网关时跳过鉴权握手（与商业线基座修复 04c4a549 同源，社区线 f2531d06）
- 其余与 0.14.5 相同
