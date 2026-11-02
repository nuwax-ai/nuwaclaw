NuwaClaw 0.14.13 (Prerelease / Beta)

修复浏览器自动化被 Google 风控识别的问题（navigator.webdriver=true）。

- chrome-devtools MCP 切换自研 fork `@nuwax-ai/chrome-devtools-mcp`：官方包 puppeteer 默认参数含 `--enable-automation`，页面 `navigator.webdriver=true`，登录 Google 等账号体系直接触发风控（海外节点实测复现）；新包剔除该默认参数并追加 `--disable-blink-features=AutomationControlled` 双保险，`navigator.webdriver=false`
- MCP npx 缓存预热 spec 同步切换至 `@nuwax-ai/chrome-devtools-mcp@latest`（npmmirror 可拉取，spec 逐字一致保证 `_npx` hash 命中）
- 其余与 0.14.12（stable）相同
