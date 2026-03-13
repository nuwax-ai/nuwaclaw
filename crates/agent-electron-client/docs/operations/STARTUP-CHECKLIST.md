# Nuwax Agent 启动前检查清单

适用于 **开发模式** 与 **打包运行**，按顺序执行可避免常见端口冲突与 native 模块错误。

**聚合实现**：端口定义与解析集中在 `src/shared/startupPorts.ts` 与 `src/main/services/startupPorts.ts`，启动时 ComputerServer / File Server 等均通过 `getConfiguredPorts()` 取端口；CLI 检查可运行 `npm run check-ports`（开发时加 Vite：`npm run check-ports:dev`）。**端口占用检查**：优先统一走 **bash** 执行 `scripts/tools/check-port.sh`（与 prepare-git 集成一致）：Windows 使用 prepare-git 集成的 Git Bash（`resources/git/bin/bash.exe`），macOS/Linux 使用系统 bash；无 bash 或脚本时回退到 Node 内联 netstat/lsof。

---

## 一、端口与服务的对应关系（以最终配置为准）

检查端口时应使用 **当前配置的端口**，而不是写死的默认值。各服务端口来源如下：

| 服务 | 说明 | 配置来源 | 默认端口 |
|------|------|----------|----------|
| **Agent（ComputerServer）** | /computer/* API，供后端与 lanproxy 隧道访问 | 设置 → step1 配置 → `agentPort`（存 SQLite `step1_config`） | 60001 |
| **File Server** | 本地文件服务、项目上传等 | 设置 → step1 配置 → `fileServerPort`（存 SQLite `step1_config`） | 60000 |
| **MCP Proxy** | MCP 服务统一入口 | 设置 → MCP → 代理端口（存 SQLite `mcp_proxy_port`） | 18099 |
| **Vite 开发服务器** | 仅开发模式，前端热更新 | `vite.config.ts` 的 `server.port` | 60173 |
| **Lanproxy** | 内网穿透客户端；连接远程 `server_port`，隧道落到本机 Agent 或本地代理端口 | 设置 → Lanproxy → 服务端端口（存 `lanproxy_config` / `lanproxy.server_port`，为**远程**端口）；**本地**端口依实现，常见与 Agent 一致或使用 60002（Agent Runner 代理默认） | 远程常 10076；本地 60002 |

- 若未在应用内改过端口，则按上表**默认端口**检查即可。
- 若改过端口，请以**设置页或下面「获取当前配置端口」**得到的值为准。

---

## 二、获取当前配置端口（可选）

**方式一：应用内**  
打开 Nuwax Agent → 设置 → 查看「Agent 端口 / 后端端口」「File Server 端口」「MCP 代理端口」「Lanproxy 服务端端口」（远程）及本地代理相关端口（若可见）。开发时 Vite 端口见项目根下 `vite.config.ts`。

**方式二：从 SQLite 读取（应用未运行时）**

```bash
DB="$HOME/.nuwaclaw/nuwaclaw.db"

# step1_config 内含 agentPort、fileServerPort（JSON）
sqlite3 "$DB" "SELECT value FROM settings WHERE key='step1_config';"

# MCP 代理端口（单独键）
sqlite3 "$DB" "SELECT value FROM settings WHERE key='mcp_proxy_port';"

# Lanproxy 远程服务端端口（lanproxy_config 或 lanproxy.server_port）
sqlite3 "$DB" "SELECT value FROM settings WHERE key='lanproxy_config';"
sqlite3 "$DB" "SELECT value FROM settings WHERE key='lanproxy.server_port';"
```

解析 `step1_config` 的 JSON 可得 `agentPort`、`fileServerPort`；`mcp_proxy_port` 无则表示用默认 18099。Lanproxy 本地检查端口通常用默认 60002（与 Agent Runner 代理端口一致）。

---

## 三、快速检查（按配置端口执行）

确认上述**实际使用的端口**未被占用（无输出表示端口空闲）：

```bash
# 替换为你的实际端口（未改过则用默认）
AGENT_PORT=60001       # Agent / ComputerServer
FILE_SERVER_PORT=60000
MCP_PROXY_PORT=18099
LANPROXY_LOCAL_PORT=60002   # Lanproxy 相关本地端口（如 Agent Runner 代理）
VITE_PORT=60173        # 仅开发模式需要

lsof -i :$AGENT_PORT
lsof -i :$FILE_SERVER_PORT
lsof -i :$MCP_PROXY_PORT
lsof -i :$LANPROXY_LOCAL_PORT
# 开发时追加：
# lsof -i :$VITE_PORT
```

若某端口有输出，说明已被占用，需先结束占用进程或只保留一个 Agent 实例。

**一键检查（推荐，与应用内聚合逻辑一致）：**

```bash
# 从 ~/.nuwaclaw/nuwaclaw.db 读配置并检查占用（需系统有 sqlite3）
npm run check-ports
# 开发模式含 Vite 端口
npm run check-ports:dev
```

**或手动从 SQLite 读取后检查（需已安装 sqlite3）：**

```bash
DB="$HOME/.nuwaclaw/nuwaclaw.db"
get_port() { sqlite3 "$DB" "SELECT value FROM settings WHERE key='$1';" 2>/dev/null; }
step1=$(get_port 'step1_config')
agent_port=$(echo "$step1" | sed -n 's/.*"agentPort":\([0-9]*\).*/\1/p'); agent_port=${agent_port:-60001}
file_port=$(echo "$step1" | sed -n 's/.*"fileServerPort":\([0-9]*\).*/\1/p'); file_port=${file_port:-60000}
mcp_port=$(get_port 'mcp_proxy_port'); mcp_port=${mcp_port:-18099}
lanproxy_local_port=60002   # Lanproxy 相关本地端口，默认 60002

echo "检查端口: Agent=$agent_port FileServer=$file_port MCP=$mcp_port Lanproxy本地=$lanproxy_local_port (Vite=60173 仅开发)"
for p in $agent_port $file_port $mcp_port $lanproxy_local_port; do
  lsof -i :$p 2>/dev/null && echo "  -> 端口 $p 已被占用"
done
```

---

## 四、端口被占用时的处理步骤

### 1. 查看占用进程

```bash
# 替换 <PORT> 为实际端口号（以「一」中配置为准），例如 60001
lsof -i :<PORT>
```

示例输出：
```
COMMAND   PID  USER   FD   TYPE  DEVICE  SIZE/OFF  NODE  NAME
Electron  123  apple  23u  IPv4  xxx     0t0      TCP  *:60001 (LISTEN)
```

记下 **PID**（第二列）。

### 2. 结束占用进程

```bash
# 替换 123 为上面看到的 PID
kill 123
```

若进程无法结束，可强制结束：
```bash
kill -9 123
```

### 3. 一次性释放 Agent / File Server / MCP / Vite 端口（谨慎使用）

以下会结束占用**当前配置端口**的进程。若你未改过端口，可直接运行；若改过，请先把 `agent_port`、`file_port`、`mcp_port`、`lanproxy_local_port`、`vite_port` 改成你在设置里配置的值，并确认没有其他重要服务使用这些端口：

```bash
# 使用默认端口示例；若已修改，请改为你配置的端口
agent_port=60001
file_port=60000
mcp_port=18099
lanproxy_local_port=60002   # Lanproxy 相关本地端口
vite_port=60173            # 仅开发模式需要

for port in $agent_port $file_port $mcp_port $lanproxy_local_port $vite_port; do
  pid=$(lsof -t -i :$port 2>/dev/null)
  [ -n "$pid" ] && echo "Killing PID $pid (port $port)" && kill $pid
done
```

---

## 五、开发模式启动流程

在项目根目录或 `crates/agent-electron-client` 下执行：

```bash
cd /Users/apple/workspace/nuwax-agent/crates/agent-electron-client

# 1. 安装依赖（首次或 package.json 变更后）
npm install

# 2. 若曾出现 better-sqlite3 与 Electron Node 版本不匹配，先重建 native 模块
npx @electron/rebuild

# 3. 启动开发环境（Vite + Electron）
npm run dev
```

**开发模式注意：**

- 若 Vite 报错 `Port 60173 is already in use`，说明上次 dev 未完全退出。先执行「四、端口被占用时的处理步骤」释放 Vite 配置端口（默认 60173），或执行「四」中的「一次性释放」脚本后再 `npm run dev`。
- 确保只运行一个 `npm run dev`，避免多开导致 Agent / File Server / MCP 端口冲突。

---

## 六、打包后运行（正式/测试包）

1. **完全退出已有实例**  
   从菜单退出并确认托盘图标已消失，避免 Agent / File Server / MCP 等配置端口被旧进程占用。

2. **首次运行或更换 Electron/Node 后**  
   若出现「Database initialization failed」且与 better-sqlite3 相关，在**开发目录**执行一次：
   ```bash
   cd crates/agent-electron-client && npx @electron/rebuild
   ```
   然后重新打包再运行。

3. **启动应用**  
   直接打开打包好的应用即可；无需再执行 npm。

---

## 七、API 连接失败（UND_ERR_SOCKET）时

日志中出现 `Unable to connect to API (UND_ERR_SOCKET)` 时，表示引擎无法连上配置的模型 API，请依次检查：

| 检查项 | 说明 |
|--------|------|
| 网络 | 本机能否访问外网或企业代理（如用代理，确认代理可用）。 |
| Base URL | 设置中的 API Base URL 是否正确（含协议与端口）。 |
| 防火墙/安全软件 | 是否拦截了 Electron 或 Node 的出站连接。 |
| 本地验证 | 在终端用 `curl -I <你的 Base URL>` 或浏览器访问，确认可达。 |

---

## 八、检查清单小结（可打印或保存）

- [ ] 以**当前配置端口**检查：Agent（ComputerServer）、File Server、MCP Proxy、Lanproxy 相关本地端口（默认 60002）及开发时 Vite 无冲突或已释放（参见「一」「三」）
- [ ] 只保留一个 Nuwax Agent 进程（含托盘）
- [ ] 开发模式：已执行 `npm install`，必要时执行 `npx @electron/rebuild`
- [ ] 设置中已配置默认模型和 API Key（避免依赖内置默认）
- [ ] 若需内网穿透：Lanproxy 服务端与网络正常，且本地 Lanproxy/Agent Runner 所用端口（如 60002）无冲突；否则可忽略 Lanproxy 相关告警
- [ ] 出现 API 连接错误时，已按「七」检查网络与 Base URL

---

*文档依据 `~/.nuwaclaw/logs/latest.log` 常见错误整理，最后更新：2026-02-27*
