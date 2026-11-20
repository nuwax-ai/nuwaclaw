NuwaClaw 0.16.0 (Prerelease / Beta)

修复 chrome-devtools-mcp 页面上限未生效导致的浏览器内存无限增长。

背景：线上容器连跑 9.8 天后，chrome-devtools-mcp 经 puppeteer 拉起的 Chromium 攒下
33 个标签页、34 个渲染进程、6.7 GB RSS，把 16 GB 内存与 4.9 G swap 全部打满，load 6.5。
根因是该 MCP 默认**不限制页数**（`--maxTabs` 不设即无上限），而客户端内置配置从未下发
这个参数；agent 只开不关的页面便跨会话持续累积，renderer 随页面生灭。

- `DEFAULT_MCP_PROXY_CONFIG` 的 chrome-devtools 参数收敛到 `buildChromeDevtoolsMcpArgs()`，
  新增 `--maxTabs=10` 与 `--no-usage-statistics`。
- 容器适配参数（`--chrome-arg=--no-sandbox`、`--chrome-arg=--disable-dev-shm-usage`）改为
  仅「root + Linux」时追加；Mac/Windows 宿主机不再无谓关掉 Chromium 沙箱。
- 反检测两个参数与 npx spec 字符串保持逐字不变，`mcpCacheWarmup` 的 `_npx` 缓存契约不受影响。
- 新增 7 个单测覆盖四种平台上下文与默认配置结构。mcp.test.ts 67 项、packages + warmup
  共 148 项通过；import boundary 检查通过；无新增 lint 问题。

受控 A/B 实测（31.23 隔离环境，真 1.10.2 包 + 真 Chromium 156，24 次 new_page，
粘性 beforeunload 页面）：不设 maxTabs 时 25 页 / 4.3 GB，设 `--maxTabs=3` 时 3 页 / 1.0 GB，
相差约 4.2 倍；驱逐在粘性页面上同样生效，无空转无卡死。

范围说明：本次只改客户端自身启动链路。镜像内 `/etc/mcp/mcp-proxy-config.json`（早已配了
`--maxTabs=10`，但因配了 `--userDataDir` 而走 autoConnect、从不拉浏览器）与后端下发的
`chrome-tools` 仍指向容器 18099 共享代理，架构收敛（删除容器内自启动、后端停发
`chrome-tools`）另行推进，不在本版范围内。

此版本进入 beta 更新通道；默认 stable 通道保持现有版本。
