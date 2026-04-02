# 服务重启接口文档

## 概述

Nuwax Agent 客户端提供 HTTP 接口用于重启本地服务，支持两种模式：
1. **重启所有服务**（含代理服务）
2. **重启除代理服务外的所有服务**

代理服务（Lanproxy）用于维持服务器到客户端的长连接隧道，重启频率较低。

## 接口约定

### 响应格式

所有接口返回统一 JSON 格式：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 状态码，`0000` 表示成功，其他表示失败 |
| `message` | string | 状态描述，成功时为 "success"，失败时为错误信息 |
| `data` | object | 业务数据，具体服务的结果列表 |

### 状态码

| code | 说明 |
|------|------|
| `0000` | 成功 |
| `1001` | 部分服务启动失败 |
| `1002` | 服务内部错误（如 ServiceManager 未初始化） |

---

## 接口列表

### 1. 重启所有服务（排除代理服务）

**端点**: `POST /services/restart`

**说明**: 重启 Computer Server、MCP Proxy、GUI Agent Server、Windows MCP、Agent、File Server，**不重启 Lanproxy**。

**请求**

```
POST http://127.0.0.1:60006/services/restart
Content-Type: application/json
```

**响应（成功）**

```json
{
  "code": "0000",
  "message": "success",
  "data": {
    "mcpProxy": { "success": true },
    "guiAgentServer": { "success": true },
    "windowsMcp": { "success": true },
    "agent": { "success": true },
    "fileServer": { "success": true },
    "computerServer": { "success": true }
  }
}
```

**响应（部分失败）**

```json
{
  "code": "1001",
  "message": "部分服务启动失败: guiAgentServer: 启动失败; windowsMcp: 启动失败",
  "data": {
    "mcpProxy": { "success": true },
    "guiAgentServer": { "success": false, "error": "启动失败" },
    "windowsMcp": { "success": false, "error": "启动失败" },
    "agent": { "success": true },
    "fileServer": { "success": true },
    "computerServer": { "success": true }
  }
}
```

**响应（内部错误）**

```json
{
  "code": "1002",
  "message": "ServiceManager 未初始化",
  "data": null
}
```

---

### 2. 查询代理服务通道健康状态

**端点**: `GET /services/lanproxy-health`

**说明**: 检查 Lanproxy 隧道到服务器的连通性。该接口依赖 `auth.saved_key` 配置。

**请求**

```
GET http://127.0.0.1:60006/services/lanproxy-health
```

**响应（健康）**

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

**响应（未配置）**

```json
{
  "healthy": false,
  "error": "未配置 savedKey"
}
```

---

## 服务列表与端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Computer Server | 60006 | Agent HTTP API 服务 |
| MCP Proxy | 18099 | MCP 协议聚合代理 |
| GUI Agent Server | 60008 | GUI 自动化 MCP tools（非 Windows） |
| Windows MCP | - | Windows GUI 自动化（仅 Windows） |
| Agent | - | AI 引擎（claude-code / nuwaxcode） |
| File Server | 60005 | 文件服务 |
| Lanproxy | - | 内网穿透隧道（不参与重启） |

---

## 调用示例

### cURL

```bash
# 重启服务
curl -X POST http://127.0.0.1:60006/services/restart

# 查询通道健康状态
curl http://127.0.0.1:60006/services/lanproxy-health
```

### Fetch API

```javascript
// 重启服务
const restartResp = await fetch('http://127.0.0.1:60006/services/restart', {
  method: 'POST'
});
const { code, message, data } = await restartResp.json();

if (code === '0000') {
  console.log('重启成功');
} else {
  console.error(`重启失败: ${message}`);
  // 遍历失败的服务
  Object.entries(data).forEach(([service, result]) => {
    if (!result.success) {
      console.error(`${service} 失败: ${result.error}`);
    }
  });
}

// 查询通道健康状态
const healthResp = await fetch('http://127.0.0.1:60006/services/lanproxy-health');
const health = await healthResp.json();
if (!health.healthy) {
  console.error('通道不健康:', health.error);
}
```

---

## 注意事项

1. **Computer Server 必须在运行**：重启接口依赖 Computer Server（端口 60006），如果该服务未启动，接口不可用。

2. **代理服务独立管理**：代理服务（Lanproxy）不参与 `/services/restart` 重启，如需重启代理服务需调用 `lanproxy:stop` / `lanproxy:start` IPC 接口。

3. **健康检查超时**：通道健康检查有 10 秒超时，服务器不可达时会返回错误。

4. **顺序依赖**：服务重启按顺序执行，MCP Proxy 需先于 Agent 启动，因为 Agent 初始化时需要连接 MCP Proxy 获取 MCP 服务器配置。

5. **code 判定**：调用方应始终检查 `code === '0000'` 来判断成功，其他值均表示失败或部分失败。
