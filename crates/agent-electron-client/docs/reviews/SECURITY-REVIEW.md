# 敏感信息与安全自查（agent-electron-client）

## 结论

**当前代码未发现硬编码密钥或明显敏感信息泄露。** 已对以下点做了修正与约定说明。

---

## 已修正

### 1. 日志中泄露 API Key（processHandlers.ts）

- **问题**：`agentRunner:start` 中 `log.info(..., args.join(' '))` 会输出完整命令行参数，包含 `--api-key <真实 key>`。
- **修正**：仅记录 `binPath`、`backendPort`、`proxyPort`、`apiBaseUrl`，不再记录含 apiKey 的 args。

### 2. 登录失败时打印完整 error（auth.ts）

- **问题**：`console.error('[Auth] 登录失败:', error)` 可能把含请求体（如 password）的 error 对象输出到控制台/日志。
- **修正**：改为只输出 `console.error('[Auth] 登录失败:', errorMessage)`，不再打印整个 error。

### 3. 登录成功时打印 configKey（auth.ts）

- **问题**：`console.log('[Auth] 登录成功:', { configKey: response.configKey, ... })` 会把客户端 configKey 写入日志。
- **修正**：改为 `configKeySet: !!response.configKey`，只记录是否设置，不记录内容。

---

## 已确认安全或低风险

| 项 | 说明 |
|----|------|
| **API Key 占位符** | UI 中 `placeholder="sk-ant-..."` 仅为占位文案，非真实密钥。 |
| **acpClient 日志** | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 仅打印前若干字符 + `...`，已脱敏。 |
| **凭证存储** | API key、password、configKey、saved_key 等均通过 IPC 存 SQLite（settings），未写进代码或仓库。 |
| **环境变量** | `dist:mac:unsigned` 等脚本中 `APPLE_API_KEY=` / `APPLE_ISSUER_ID=` 等置空，用于关闭签名与公证，不涉及真实密钥。 |
| **文档** | SIGNING.md、verify-sign.js 仅说明 env 名称，无密钥内容。 |
| **公开 URL** | `DEFAULT_SERVER_HOST`、npm/pypi 镜像等为公开默认配置，非敏感。 |

---

## 建议

1. **生产构建**：若使用 electron-log 等写文件，确保日志轮转与权限控制，避免日志文件被未授权访问。
2. **configKey / saved_key**：已不在日志中输出全文；若后续有调试需要，仅建议在开发环境且脱敏后使用。
3. **依赖**：定期 `npm audit`，及时升级存在已知漏洞的依赖。

---

*自查日期：2026-02*
