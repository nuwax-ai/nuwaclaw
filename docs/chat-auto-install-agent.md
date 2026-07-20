# Chat 接口自动安装 Agent 需求文档

## 1. 需求背景

### 1.1 现状

当前 `/computer/chat` 接口通过 `agent_config.agent_server` 参数支持指定自定义 ACP Agent：

```json
{
  "user_id": "user_123",
  "prompt": "帮我写代码",
  "agent_config": {
    "agent_server": {
      "agent_id": "codex-acp",
      "command": "codex-acp",
      "args": [],
      "env": {}
    }
  }
}
```

**问题**：
- 如果指定的 Agent 未安装，请求会直接失败
- 用户需要**先调用** `/agent-mgmt/agents/install-from-url` 安装 Agent
- **再调用** `/computer/chat` 使用 Agent，流程繁琐

### 1.2 目标

扩展 `/computer/chat` 接口，支持**自动安装 Agent**：

1. 用户在 `agent_server` 中携带 `platforms` 和 `version` 信息
2. 如果 Agent 未安装，系统自动下载安装
3. 安装完成后再启动 Agent 执行对话

**核心价值**：一个请求完成"安装+启动+对话"，无需分步调用。

---

## 2. 接口变更清单

### 2.1 需要实现/修改的接口

| 接口 | 方法 | 变更类型 | 说明 |
|------|------|----------|------|
| `/agent-mgmt/agents/install-from-url` | POST | **新增实现** | 从 URL 下载并安装 Agent（多平台+版本管理） |
| `/computer/chat` | POST | **参数扩展** | `agent_server` 新增 `platforms`、`version` 字段 |
| `/devcomputer/chat` | POST | **参数扩展** | 同 `/computer/chat`，同步扩展 |
| `/devcomputer/*` | - | 无变更 | 其他接口保持不变 |

### 2.2 接口详细说明

#### 2.2.1 `/agent-mgmt/agents/install-from-url` - 新增实现

从指定 URL 下载压缩包安装 ACP Agent。支持**多平台 URL** + **版本号**，自动判断是否需要下载安装（幂等）。

**请求体**（`InstallFromUrlRequest`）：

```json
{
  "project_id": "demo-project-001",
  "user_id": "user_123",
  "pod_id": "pod_abc123",
  "tenant_id": "tenant_001",
  "space_id": "space_001",
  "isolation_type": "tenant",
  "agent": {
    "agent_id": "codex-acp",
    "command": "codex-acp",
    "args": ["--serve", "--port", "7091"],
    "version": "1.2.0"
  },
  "platforms": {
    "linux-x86_64": {
      "url": "https://cdn.example.com/agent/1.2.0/agent-linux-amd64.tar.gz",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size": 52428800
    },
    "linux-aarch64": {
      "url": "https://cdn.example.com/agent/1.2.0/agent-linux-arm64.tar.gz",
      "sha256": "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
      "size": 49283072
    },
    "darwin-arm64": {
      "url": "https://cdn.example.com/agent/1.2.0/agent-darwin-arm64.tar.gz",
      "size": 47185920
    }
  },
  "force": false
}
```

**RoutingParams 字段**（定位目标容器）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | string | 条件必填 | 项目 ID（与 user_id/pod_id 二选一） |
| `user_id` | string | 条件必填 | 用户 ID（ComputerAgentRunner 模式） |
| `pod_id` | string | 否 | Pod ID（有值时覆盖 user_id） |
| `tenant_id` | string | 条件必填 | 租户 ID（pod_id 有值时必填） |
| `space_id` | string | 条件必填 | 空间 ID（pod_id 有值时必填） |
| `isolation_type` | string | 条件必填 | 隔离类型：tenant / space / project（pod_id 有值时必填） |

**AgentIdentity 字段**（`agent` 对象）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | Agent 标识符（如 "codex-acp"） |
| `command` | string | 是 | 入口可执行文件名（如 "codex-acp"） |
| `args` | string[] | 否 | 启动参数（默认空） |
| `version` | string | 否 | 版本号（semver 格式，如 "1.2.0"） |

**PlatformEntry 字段**（`platforms` 的值）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 下载 URL（http/https） |
| `sha256` | string | 否 | SHA-256 校验和（hex，可选） |
| `size` | integer | 否 | 文件大小（字节，用于磁盘空间预检查） |

**平台 key 命名规范**：`{os}-{arch}`

| Key | OS | CPU 架构 | 说明 |
|-----|-----|---------|------|
| `linux-x86_64` | Linux | x86_64/AMD64 | 服务器主流 |
| `linux-aarch64` | Linux | ARM64/AArch64 | AWS Graviton、M1/M2 Docker |
| `darwin-arm64` | macOS | ARM64/AArch64 | Apple Silicon (M1/M2/M3) |
| `darwin-x86_64` | macOS | Intel | Intel Mac |
| `windows-x86_64` | Windows | x86_64/AMD64 | Windows 桌面 |

**响应**（`HttpResult<InstallAgentResponse>`）：

```json
{
  "code": "0000",
  "message": "Success",
  "success": true,
  "tid": "trace_id_123",
  "data": {
    "agent_id": "codex-acp",
    "status": "available",
    "binary_path": "codex-acp",
    "file_type": "tar.gz",
    "file_size": 52428800,
    "file_count": 3,
    "version": "1.2.0",
    "source_url": "https://cdn.example.com/agent/1.2.0/agent-linux-amd64.tar.gz",
    "action": "installed",
    "installed": true,
    "previous_version": null,
    "platform": "linux-x86_64"
  }
}
```

**InstallAgentResponse 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | Agent 标识符 |
| `status` | string | 是 | 安装状态：`available` / `broken` / `not_installed` / `unknown` |
| `binary_path` | string | 是 | 可执行文件路径 |
| `file_type` | string | 是 | 文件类型：`executable` / `tar.gz` / `zip` / `npm` / `binary` |
| `file_size` | integer | 是 | 文件大小（字节） |
| `file_count` | integer | 否 | 文件数量（压缩包解压后） |
| `version` | string | 否 | 版本号（可检测时） |
| `source_url` | string | 否 | 源 URL（URL 安装时） |
| `action` | string | 否 | 操作类型：`installed` / `updated` / `skipped` |
| `installed` | boolean | 否 | 本次是否实际执行了下载安装 |
| `previous_version` | string | 否 | 更新前的版本（首次安装为 null） |
| `platform` | string | 否 | 实际匹配的平台 key（如 "linux-x86_64"） |

**业务逻辑**：

```
1. 验证参数
   - agent_id, command 必填
   - platforms 不能为空
   - version 必须是合法 semver

2. 定位目标容器
   - 根据 RoutingParams 定位

3. 版本检查（幂等核心）
   - 查询注册表 registry.json
   - version 归一化：v1.0.0 和 1.0.0 视为同一版本
   - 精确版本已安装 → action = "skipped"

4. 如果需要安装
   a. 获取当前系统平台：SystemInfo { os, arch }
   b. 归一化：amd64 → x86_64, arm64 → aarch64
   c. 在 platforms 中查找匹配的 URL
   d. 下载文件（流式，超时 10 分钟）
   e. SHA-256 校验（如果有）
   f. 解压/移动到 bin/{command}
   g. 添加执行权限
   h. 更新注册表
   i. 验证安装：which {command}

5. 返回安装结果
```

**请求示例**：

```bash
curl -X POST http://localhost:8087/agent-mgmt/agents/install-from-url \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "p1",
    "agent": {
      "agent_id": "codex-acp",
      "command": "codex-acp",
      "version": "1.2.0"
    },
    "platforms": {
      "linux-x86_64": {
        "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-amd64.tar.gz",
        "sha256": "e3b0c44298fc1c14..."
      },
      "linux-aarch64": {
        "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-arm64.tar.gz"
      }
    }
  }'
```

**错误码**：

| 错误码 | 说明 |
|--------|------|
| `ERR_AGENT_MGMT_PLATFORM_NOT_FOUND` | platforms 中无当前系统 URL |
| `ERR_AGENT_MGMT_INVALID_VERSION` | version 格式不合法 |
| `ERR_AGENT_MGMT_CHECKSUM_MISMATCH` | SHA-256 校验失败 |
| `ERR_AGENT_MGMT_INSTALL_FAILED` | 下载或安装失败 |
| `ERR_AGENT_MGMT_COMMAND_TIMEOUT` | 下载超时（10 分钟） |
| `ERR_CONTAINER_NOT_FOUND` | 容器不存在 |

---

#### 2.2.2 `/computer/chat` - 参数扩展

**请求体**（`ComputerChatRequest`）：

```json
{
  "user_id": "user_123",
  "prompt": "帮我写一个 React 组件",
  "project_id": "proj_456",
  "session_id": "session_789",
  "request_id": "req_123456789",
  "pod_id": "pod_tenant_123",
  "tenant_id": "tenant_001",
  "space_id": "space_001",
  "isolation_type": "tenant",
  "model_provider": { ... },
  "agent_config": {
    "agent_server": {
      "agent_id": "codex-acp",
      "command": "codex-acp",
      "args": ["--serve"],
      "version": "1.2.0",
      "platforms": {
        "linux-x86_64": {
          "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-amd64.tar.gz",
          "sha256": "e3b0c44298fc1c14...",
          "size": 52428800
        },
        "linux-aarch64": {
          "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-arm64.tar.gz"
        }
      },
      "env": {"ANTHROPIC_API_KEY": "sk-xxx"},
      "model_env_bindings": [
        {"env_key": "ANTHROPIC_API_KEY", "source": "api_key"}
      ],
      "agent_mode": "yolo",
      "metadata": {}
    },
    "auto_reload": {
      "enabled": true,
      "force": false,
      "stability_window_ms": 500
    },
    "context_servers": {},
    "resource_limits": {}
  },
  "attachments": [],
  "data_source_attachments": []
}
```

**ComputerChatRequest 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | 是 | 用户 ID（用于容器标识） |
| `prompt` | string | 是 | 用户输入的 prompt |
| `project_id` | string | 否 | 项目 ID（可选，系统自动生成 UUID） |
| `session_id` | string | 否 | 会话 ID（可选，不提供则创建新会话） |
| `request_id` | string | 否 | 请求 ID（用于追踪） |
| `pod_id` | string | 否 | 容器唯一标识（有值时覆盖 user_id） |
| `tenant_id` | string | 否 | 租户 ID |
| `space_id` | string | 否 | 空间 ID |
| `isolation_type` | string | 否 | 隔离类型：tenant / space / project |
| `model_provider` | object | 否 | 模型配置 |
| `agent_config` | object | 否 | Agent 运行时配置 |
| `attachments` | array | 否 | 附件列表 |
| `data_source_attachments` | array | 否 | 数据源附件列表 |

**ChatAgentConfig 字段说明**（`agent_config`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_server` | object | 否 | Agent 服务器配置 |
| `auto_reload` | object | 否 | 自动重载配置 |
| `context_servers` | object | 否 | MCP 服务器配置 |
| `resource_limits` | object | 否 | 容器资源限制配置 |

**ChatAgentServerConfig 字段说明**（`agent_server`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 否 | Agent 标识符（默认 "claude-code-acp-ts"） |
| `command` | string | 否 | 执行命令（如 "codex-acp"） |
| `args` | string[] | 否 | 命令参数 |
| `version` | string | 否 | 版本号（semver 格式，如 "1.2.0"） |
| `platforms` | object | 否 | 多平台下载地址（key 为 `{os}-{arch}`） |
| `env` | object | 否 | 环境变量 |
| `model_env_bindings` | array | 否 | 模型环境变量绑定规则 |
| `agent_mode` | string | 否 | 权限审批模式："yolo"（默认）或 "ask" |
| `metadata` | object | 否 | 元数据 |

**AutoReloadConfig 字段说明**（`auto_reload`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 否 | 是否启用自动重载（devcomputer 默认 true） |
| `force` | boolean | 否 | 强制重载（不检查文件变化） |
| `stability_window_ms` | integer | 否 | 稳定性检查窗口（毫秒，默认 500） |

**响应**（`HttpResult<ChatResponse>`）：

```json
{
  "code": "0000",
  "message": "Success",
  "success": true,
  "tid": "trace_id_123",
  "data": {
    "project_id": "proj_456",
    "session_id": "session_789",
    "request_id": "req_123456789",
    "error": null,
    "need_fallback": false,
    "fallback_reason": null,
    "agent_version": "1.2.0",
    "reloaded": false
  }
}
```

**ChatResponse 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | string | 是 | 项目 ID |
| `session_id` | string | 是 | 会话 ID |
| `request_id` | string | 否 | 请求 ID |
| `error` | string | 否 | 错误信息 |
| `need_fallback` | boolean | 否 | 是否需要降级重试 |
| `fallback_reason` | string | 否 | 降级原因 |
| `agent_version` | string | 否 | Agent 版本号 |
| `reloaded` | boolean | 否 | 是否触发了 agent 二进制热重载 |

#### 2.2.3 `/devcomputer/chat` - 同步扩展

参数和逻辑与 `/computer/chat` 完全一致，额外启用 `auto_reload` 功能。

**请求体**：与 `ComputerChatRequest` 完全相同

**响应**：与 `ChatResponse` 完全相同

**差异点**：
- `auto_reload.enabled` 默认为 `true`（生产接口默认为 `false`）
- 路由前缀为 `/devcomputer/`（用于区分调试流量）

---

## 3. 业务逻辑设计

### 3.1 处理流程

```
POST /computer/chat
    │
    ├── 1. 解析请求参数
    │      └── 提取 agent_server.platforms, agent_server.version
    │
    ├── 2. 检查 Agent 是否已安装
    │      └── 查询 registry.json 或调用 check 逻辑
    │
    ├── 3. 判断是否需要安装
    │      ├── 已安装 且 version 匹配 → 跳过安装
    │      ├── 已安装 但 version 不匹配 → 按需更新（可选）
    │      └── 未安装 → 执行安装
    │
    ├── 4. [如果需要安装] 自动安装 Agent
    │      ├── 4a. 获取容器系统信息 (os, arch)
    │      ├── 4b. 从 platforms 中匹配当前平台
    │      ├── 4c. 下载并安装（复用 install-from-url 逻辑）
    │      └── 4d. 验证安装成功
    │
    ├── 5. 启动 Agent 并执行对话
    │      └── 调用现有的 chat 逻辑
    │
    └── 6. 返回响应（包含安装信息）
```

### 3.2 响应扩展

在现有 `ChatResponse` 基础上，新增 `agent_install` 字段：

```json
{
  "success": true,
  "data": {
    "project_id": "proj_123",
    "session_id": "session_456",
    "request_id": "req_789",
    "agent_install": {
      "installed": true,
      "action": "installed",
      "version": "1.2.0",
      "platform": "linux-x86_64",
      "previous_version": null
    }
  },
  "code": "0000",
  "message": "Success"
}
```

**agent_install 字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `installed` | `boolean` | 本次是否执行了安装 |
| `action` | `string` | 操作类型：`installed` / `updated` / `skipped` |
| `version` | `string` | 当前安装的版本 |
| `platform` | `string` | 匹配的平台 key |
| `previous_version` | `string` | 更新前的版本（首次安装为 null） |

---

## 4. 接口调用示例

### 4.1 场景一：首次安装并使用

```bash
# 一个请求完成：安装 + 启动 + 对话
curl -X POST http://localhost:8087/computer/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "prompt": "帮我写一个 Python 脚本",
    "agent_config": {
      "agent_server": {
        "agent_id": "codex-acp",
        "command": "codex-acp",
        "version": "1.2.0",
        "platforms": {
          "linux-x86_64": {
            "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-amd64.tar.gz"
          }
        },
        "model_env_bindings": [
          {"env_key": "ANTHROPIC_API_KEY", "source": "api_key"}
        ]
      }
    }
  }'

# 响应
{
  "success": true,
  "data": {
    "project_id": "proj_abc",
    "session_id": "session_xyz",
    "agent_install": {
      "installed": true,
      "action": "installed",
      "version": "1.2.0",
      "platform": "linux-x86_64"
    }
  }
}
```

### 4.2 场景二：已安装，跳过安装

```bash
# 再次调用相同版本，跳过安装
curl -X POST http://localhost:8087/computer/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "prompt": "继续上次的任务",
    "agent_config": {
      "agent_server": {
        "agent_id": "codex-acp",
        "command": "codex-acp",
        "version": "1.2.0",
        "platforms": {
          "linux-x86_64": {
            "url": "https://cdn.example.com/codex-acp/1.2.0/codex-acp-linux-amd64.tar.gz"
          }
        }
      }
    }
  }'

# 响应（跳过安装）
{
  "success": true,
  "data": {
    "project_id": "proj_abc",
    "session_id": "session_xyz",
    "agent_install": {
      "installed": false,
      "action": "skipped",
      "version": "1.2.0",
      "platform": null
    }
  }
}
```

### 4.3 场景三：不传 platforms（向后兼容）

```bash
# 不传 platforms，走现有逻辑（Agent 必须已安装）
curl -X POST http://localhost:8087/computer/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "prompt": "hello",
    "agent_config": {
      "agent_server": {
        "agent_id": "codex-acp",
        "command": "codex-acp"
      }
    }
  }'

# 响应（无 agent_install 字段，向后兼容）
{
  "success": true,
  "data": {
    "project_id": "proj_abc",
    "session_id": "session_xyz"
  }
}
```

---

## 5. 错误处理

### 5.1 新增错误码

| 错误码 | 说明 | 触发场景 |
|--------|------|----------|
| `ERR_AGENT_AUTO_INSTALL_FAILED` | 自动安装失败 | 下载失败、校验失败等 |
| `ERR_AGENT_PLATFORM_NOT_FOUND` | 平台不匹配 | platforms 中无当前系统 URL |
| `ERR_AGENT_VERSION_MISMATCH` | 版本不匹配 | 已安装版本与请求版本冲突 |

### 5.2 错误响应示例

```json
{
  "success": false,
  "code": "ERR_AGENT_AUTO_INSTALL_FAILED",
  "message": "Agent 自动安装失败: 下载超时",
  "data": {
    "agent_install": {
      "installed": false,
      "action": "failed",
      "error": "Download timeout after 600s",
      "platform": "linux-x86_64"
    }
  }
}
```

---

## 6. 与现有接口的关系

### 6.1 接口职责划分

| 接口 | 职责 | 使用场景 |
|------|------|----------|
| `/computer/chat` | 对话 + 按需安装 | 一体化使用，适合业务集成 |
| `/agent-mgmt/agents/install-from-url` | 纯安装管理 | 预安装、批量安装、CI/CD |
| `/devcomputer/chat` | 调试 + 按需安装 | 开发调试场景 |

### 6.2 调用流程对比

**现有流程**（两步）：
```
1. POST /agent-mgmt/agents/install-from-url  → 安装 Agent
2. POST /computer/chat                        → 使用 Agent
```

**新流程**（一步）：
```
1. POST /computer/chat (带 platforms/version) → 自动安装 + 使用
```

---

## 7. 实现要点

### 7.1 代码改动范围

#### 7.1.1 `/agent-mgmt/agents/install-from-url` 实现

| 文件/模块 | 变更 |
|-----------|------|
| `shared_types/agent_mgmt_types.rs` | 新增 `InstallFromUrlRequest`、`InstallAgentResponse` 等类型 |
| `rcoder/router.rs` | 注册 `/agent-mgmt/agents/install-from-url` 路由 |
| `rcoder/handler/agent_mgmt_handler.rs` | 新增 `install_from_url` handler |
| `rcoder/agent_mgmt_forward.rs` | gRPC 转发逻辑（或本地直接处理） |
| `agent_runner/agent_mgmt/installer/url_installer.rs` | URL 下载安装核心逻辑 |
| `agent_runner/agent_mgmt/registry.rs` | 注册表读写 |
| `agent_runner/agent_mgmt/checker.rs` | 安装后验证 |

#### 7.1.2 `/computer/chat` 自动安装扩展

| 文件/模块 | 变更 |
|-----------|------|
| `shared_types/chat_agent_config.rs` | `ChatAgentServerConfig` 新增 `platforms`、`version` 字段 |
| `shared_types/chat_types.rs` | `ChatResponse` 新增 `agent_install` 字段 |
| `agent_runner/chat_handler.rs` | `handle_chat_core()` 中新增自动安装逻辑 |
| `rcoder/handler/chat_handler.rs` | 参数透传（无额外逻辑） |

### 7.2 核心复用关系

```
/computer/chat (自动安装)
    │
    ├── 复用 agent_runner::agent_mgmt::installer::url_installer
    │      └── do_install_from_url() 核心安装逻辑
    │
    ├── 复用 agent_runner::agent_mgmt::checker
    │      └── check_agent() 安装后验证
    │
    └── 复用 agent_runner::agent_mgmt::registry
           └── 读写 registry.json

/agent-mgmt/agents/install-from-url (独立接口)
    │
    └── 直接调用 do_install_from_url()（与 /computer/chat 共享）
```

### 7.3 关键实现细节

#### 7.3.1 版本归一化

```rust
/// 归一化版本号：去除 v/V 前缀、trim 空格
fn normalize_version(version: &str) -> String {
    let v = version.trim();
    if v.starts_with('v') || v.starts_with('V') {
        v[1..].to_string()
    } else {
        v.to_string()
    }
}

// "v1.0.0" 和 "1.0.0" 视为同一版本
assert_eq!(normalize_version("v1.0.0"), normalize_version("1.0.0"));
```

#### 7.3.2 平台匹配逻辑

```rust
/// 从 platforms 中匹配当前系统平台
fn match_platform(
    platforms: &HashMap<String, PlatformEntry>,
    system_info: &SystemInfo,
) -> Result<&PlatformEntry, AppError> {
    // 归一化架构名：amd64 → x86_64, arm64 → aarch64
    let arch = match system_info.arch.as_str() {
        "amd64" => "x86_64",
        "arm64" => "aarch64",
        other => other,
    };
    let key = format!("{}-{}", system_info.os, arch);

    platforms.get(&key)
        .ok_or(AppError::ERR_AGENT_MGMT_PLATFORM_NOT_FOUND)
}
```

#### 7.3.3 `/computer/chat` 自动安装流程

```rust
async fn handle_chat_core(input: ChatRequest, context: Context) -> Result<ChatResponse> {
    let agent_server = input.agent_config.agent_server;

    // 1. 检查是否有 platforms 参数（触发自动安装）
    if let Some(platforms) = &agent_server.platforms {
        // 2. 检查 Agent 是否已安装
        let installed = check_agent_installed(&agent_server.agent_id, &agent_server.version).await?;

        if !installed {
            // 3. 自动安装
            let install_result = do_install_from_url(InstallFromUrlRequest {
                agent: agent_server.clone().into(),
                platforms: platforms.clone(),
                version: agent_server.version.clone(),
                ..Default::default()
            }).await?;

            // 4. 记录安装信息到响应
            response.agent_install = Some(install_result.into());
        }
    }

    // 5. 继续原有的 chat 逻辑
    // ...
}
```

---

## 8. 非目标

1. **不修改** `/agent-mgmt/agents/install-from-url` 接口
2. **不支持** 从 npm 自动安装（仅支持 URL 方式）
3. **不支持** 自动升级（已安装版本不匹配时，默认跳过而非升级）

---

## 9. 验收标准

1. **AC-1**：`/computer/chat` 传入 `platforms` 和 `version`，Agent 未安装时自动安装并启动
2. **AC-2**：Agent 已安装且版本匹配时，跳过安装，直接启动
3. **AC-3**：不传 `platforms` 时，行为与现有逻辑完全一致（向后兼容）
4. **AC-4**：`/devcomputer/chat` 同步支持自动安装
5. **AC-5**：响应中包含 `agent_install` 字段，正确反映安装状态
6. **AC-6**：安装失败时返回明确的错误码和错误信息

---

## 附录：相关文档

- `acp-agent-management-api.md` - Agent 管理 API 完整设计
- `devcomputer-debug-api-spec.md` - DevComputer 调试接口设计
