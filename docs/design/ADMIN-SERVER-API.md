# Admin Server API 文档

## 概述

Admin Server 是 Nuwax Agent 客户端的管理接口服务，集成在 Computer Server (60006) 中，复用同一端口：

1. **服务重启**：重启本地服务（排除 Lanproxy）
2. **健康检查**：检查代理服务通道健康状态

**注意**：Admin Server 不再独立占用 60007 端口，而是与 Computer Server 共用 `agentPort`（默认 60006）。

---

## 端口配置

### 默认端口

| 服务 | 默认端口 | 说明 |
|------|----------|------|
| Admin Server | **60006**（与 Computer Server 共用） | 管理接口服务 |
| Computer Server | 60006 | Agent HTTP API 服务 |
| GUI Agent MCP | 60008 | GUI 自动化 MCP tools |
| File Server | 60005 | 文件服务 |
| MCP Proxy | 18099 | MCP 协议聚合代理 |

### 端口修改

Admin Server 端口随 `agentPort` 变化（合并到 Computer Server）。`step1_config.adminServerPort` 配置项保留，但已不再实际使用。

---

## 接口列表

### 1. Admin Server 健康检查

**端点**: `GET /admin/health`

**路径**: `/admin/health`

**端口**: Computer Server 端口（默认 60006）

**说明**: 检查 Admin Server 自身是否正常运行。用于判断管理接口服务是否启动成功。

**请求示例**

```bash
curl http://127.0.0.1:60006/admin/health
```

**响应格式**

```json
{
  "status": "ok",
  "timestamp": 1743580800000
}
```

**响应（服务未启动）**

```
连接失败
```

---

### 2. 重启服务（排除 Lanproxy）

**端点**: `POST /admin/services/restart`

**路径**: `/admin/services/restart`

**端口**: Computer Server 端口（默认 60006）

**说明**: 重启以下服务：
- Computer Server
- MCP Proxy
- GUI Agent Server
- Windows MCP
- Agent
- File Server

**Lanproxy 不参与重启**，如需重启 Lanproxy 需调用客户端 IPC 接口。

**请求示例**

```bash
curl -X POST http://127.0.0.1:60006/admin/services/restart
```

**响应格式（立即返回）**

```json
{
  "code": "0000",
  "message": "重启请求已收到，将延迟2秒执行",
  "data": null
}
```

> **说明**：接口立即返回"收到请求"，实际重启延迟 2 秒执行（避免 Computer Server 自己被重启导致响应无法写回）。

**最终重启结果通过日志输出**，不通过 HTTP 响应返回。

**状态码说明**

| code | 说明 |
|------|------|
| `0000` | 重启请求已收到 |
| `500` | 服务内部错误（如 ServiceManager 未初始化） |

---

### 3. 查询代理服务通道健康状态

**端点**: `GET /admin/health/lanproxy`

**路径**: `/admin/health/lanproxy`

**端口**: Computer Server 端口（默认 60006）

**说明**: 检查 Lanproxy 隧道到服务器的连通性。该接口依赖 `auth.saved_key` 配置。

**请求示例**

```bash
curl http://127.0.0.1:60006/admin/health/lanproxy
```

**响应格式**

```json
{
  "healthy": true
}
```

**响应（不健康）**

```json
{
  "healthy": false,
  "error": "HTTP 401"
}
```

**响应（未配置 savedKey）**

```json
{
  "healthy": false,
  "error": "未配置 savedKey"
}
```

---

## 客户端注册接口 (/reg)

### 接口地址

`POST /api/sandbox/config/reg`

### 🚨 后端新增字段说明

> **⚠️ 重要：以下两个字段需要后端在 `/reg` 接口的 `sandboxConfigValue` 中新增支持**

| 字段 | 类型 | 必填 | 说明 | 后端要求 |
|------|------|------|------|----------|
| `guiMcpPort` | number | 是 | GUI Agent MCP 端口，默认 60008 | **后端需新增此字段** |
| `adminServerPort` | number | 是 | Admin Server 端口（与 agentPort 相同，默认 60006） | **后端需新增此字段** |

### 请求参数

`sandboxConfigValue` 字段包含以下端口信息：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `hostWithScheme` | string | 是 | 客户端地址，如 `http://127.0.0.1` |
| `agentPort` | number | 是 | Agent 服务端口，默认 60006 |
| `vncPort` | number | 是 | VNC 端口（未启用，固定为 0） |
| `fileServerPort` | number | 是 | 文件服务端口，默认 60005 |
| `guiMcpPort` | number | 是 | GUI Agent MCP 端口，默认 60008 |
| `adminServerPort` | number | 是 | Admin Server 端口（与 agentPort 相同，默认 60006） |
| `apiKey` | string | 否 | API 密钥 |
| `maxUsers` | number | 否 | 最大用户数，默认 1 |

### 请求示例

```json
{
  "username": "user@example.com",
  "password": "xxx",
  "savedKey": "xxx",
  "deviceId": "xxx",
  "sandboxConfigValue": {
    "hostWithScheme": "http://127.0.0.1",
    "agentPort": 60006,
    "vncPort": 0,
    "fileServerPort": 60005,
    // --- 以下为后端需新增支持的字段 ---
    "guiMcpPort": 60008,
    "adminServerPort": 60006,
    // ---------------------------------
    "apiKey": "",
    "maxUsers": 1
  }
}
```

### 响应

服务端返回 `SandboxConfigDto`，包含客户端注册信息。

### 后端改造要求

> **📋 后端开发任务清单**

1. **新增字段** `guiMcpPort` (number)
   - 用途：客户端 GUI Agent MCP 服务端口
   - 默认值：60008
   - 存储位置：`sandboxConfigValue.guiMcpPort`

2. **新增字段** `adminServerPort` (number)
   - 用途：客户端 Admin Server 管理接口端口
   - 默认值：**60006**（与 agentPort 相同，Admin Server 已合并到 Computer Server）
   - 存储位置：`sandboxConfigValue.adminServerPort`

3. **兼容性要求**
   - 旧版本客户端不含这两个字段，后端应兼容处理（使用默认值）
   - 新版本客户端会发送这两个字段，后端需正确接收并存储

---

## GUI Agent MCP 配置说明

### 客户端本地架构

```
Electron 客户端
├── Computer/Admin Server :60006
│   ├── /admin/*  (管理接口)
│   └── /computer/*, /chat/*  (Agent HTTP API)
├── GUI Agent Server :60008
│   └── /mcp  (streamable-http)
├── MCP Proxy :18099
│   └── Agent 通过 MCP Proxy 连接 GUI Agent Server
└── Agent (claude-code / nuwaxcode)
    └── 本地 stdio 连接 MCP Proxy
```

### 后台如何配置 MCP JSON

客户端的 GUI Agent MCP 使用 **streamable-http** 协议，客户端本地访问地址为 `http://127.0.0.1:{guiMcpPort}/mcp`。

#### MCP Server 配置格式

```json
{
  "mcpServers": {
    "gui-agent": {
      "url": "http://127.0.0.1:{guiMcpPort}/mcp"
    }
  }
}
```

#### 后台下发给客户端的完整配置示例

```json
{
  "mcpServers": {
    "gui-agent": {
      "url": "http://127.0.0.1:60008/mcp"
    }
  }
}
```

### 注意事项

1. **仅本地访问**：`guiMcpPort` 是客户端本地端口（127.0.0.1），后台无法直接访问，只能由客户端自己使用
2. **MCP 协议**：GUI Agent Server 使用 `streamable-http` 协议，与标准 MCP HTTP 兼容
3. **Agent 注入**：客户端的 Agent 通过 MCP Proxy 桥接到 GUI Agent Server，无需后台直接连接

---

## 服务端口对应关系

```
客户端 (127.0.0.1)
├── Computer Server :60006  (Agent HTTP API + Admin 管理接口)
│   ├── GET  /admin/health
│   ├── POST /admin/services/restart
│   ├── GET  /admin/health/lanproxy
│   └── /computer/*, /chat/*
├── File Server :60005  (文件服务)
├── GUI Agent MCP :60008  (GUI 自动化)
└── MCP Proxy :18099  (MCP 协议代理)
```

---

## 注意事项

1. **端口合并**：Admin Server 已合并到 Computer Server (60006)，不再独立占用 60007 端口。

2. **重启延迟 2 秒**：`/admin/services/restart` 立即返回后，实际重启延迟 2 秒执行，避免 Computer Server 自己被重启导致响应无法写回。

3. **Lanproxy 独立管理**：Lanproxy 不参与 `/admin/services/restart` 重启，用于维持服务器到客户端的长连接隧道。

4. **健康检查超时**：通道健康检查有 10 秒超时，服务器不可达时会返回错误。

5. **顺序依赖**：服务重启按顺序执行，MCP Proxy 需先于 Agent 启动。
