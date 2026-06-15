# {PREFIX_WORKSPACE_DIR} 路径变量替换规则

## 概述

`{PREFIX_WORKSPACE_DIR}` 是一个路径占位符，用于 ACP Agent 配置中的 `command`、`args` 和 `env` 字段。客户端在处理请求时，会根据不同的接口（HTTP 入口）自动替换为实际的本地路径。

**设计目的**：让同一套 Agent 配置可以在不同环境（开发调试 / 正式使用）下工作，无需手动修改路径。

---

## 替换规则总览

| 字段 | `/devcomputer/chat` 替换为 | `/computer/chat` 替换为 |
|------|--------------------------|----------------------|
| `command` | `{WORKSPACE}/computer-project-workspace/{user_id}` | `{APP_DATA_DIR}/acp-agent/` |
| `args` | `{WORKSPACE}/computer-project-workspace/{user_id}` | `{APP_DATA_DIR}/acp-agent/` |
| `env` 值 | `{WORKSPACE}/computer-project-workspace/{user_id}` | `{APP_DATA_DIR}/logs/agent_logs/` |

> - `{WORKSPACE}` = 用户配置的工作目录（`workspaceDir`），默认 `{APP_DATA_DIR}/workspace`
> - `{APP_DATA_DIR}` = 应用数据目录，由 `getAppDataDir()` 返回（即 `path.join(os.homedir(), ".nuwaclaw")`）

---

## 场景详解

### 场景 1：开发调试（`/devcomputer/chat`）

**用途**：开发者在本地调试自己开发的 ACP Agent 项目。

**替换路径**：`baseWorkspaceDir/computer-project-workspace/{user_id}`

**示例**：

```json
{
  "agent_config": {
    "agent_server": {
      "command": "{PREFIX_WORKSPACE_DIR}/1552795/node_modules/.bin/tsx",
      "args": ["{PREFIX_WORKSPACE_DIR}/1552795/src/index.ts"],
      "env": {
        "LOG_DIR": "{PREFIX_WORKSPACE_DIR}/{project_id}/logs"
      }
    }
  }
}
```

替换后（macOS）：

```json
{
  "command": "/Users/soddy/Documents/nuwaClaw-workspace/computer-project-workspace/6/1552795/node_modules/.bin/tsx",
  "args": ["/Users/soddy/Documents/nuwaClaw-workspace/computer-project-workspace/6/1552795/src/index.ts"],
  "env": {
    "LOG_DIR": "/Users/soddy/Documents/nuwaClaw-workspace/computer-project-workspace/6/{project_id}/logs"
  }
}
```

替换后（Windows）：

```json
{
  "command": "C:\\Users\\soddy\\Documents\\nuwaClaw-workspace\\computer-project-workspace\\6\\1552795\\node_modules\\.bin\\tsx",
  "args": ["C:\\Users\\soddy\\Documents\\nuwaClaw-workspace\\computer-project-workspace\\6\\1552795\\src\\index.ts"],
  "env": {
    "LOG_DIR": "C:\\Users\\soddy\\Documents\\nuwaClaw-workspace\\computer-project-workspace\\6\\{project_id}\\logs"
  }
}
```

**特点**：
- Agent 源码在项目工作目录下
- 开发者修改代码后，通过 auto-reload 自动重载
- 日志也在项目目录下，方便查看

---

### 场景 2：正式使用（`/computer/chat`）

**用途**：使用已安装的 ACP Agent 执行正式任务。

**command/args 替换路径**：`{APP_DATA_DIR}/acp-agent/`

**env 替换路径**：`{APP_DATA_DIR}/logs/agent_logs/`

**示例**：

```json
{
  "agent_config": {
    "agent_server": {
      "command": "{PREFIX_WORKSPACE_DIR}/bin/my-agent",
      "args": ["--verbose"],
      "env": {
        "LOG_DIR": "{PREFIX_WORKSPACE_DIR}/{project_id}/logs"
      }
    }
  }
}
```

替换后（macOS）：

```json
{
  "command": "/Users/soddy/.nuwaclaw/acp-agent/bin/my-agent",
  "args": ["--verbose"],
  "env": {
    "LOG_DIR": "/Users/soddy/.nuwaclaw/logs/agent_logs/{project_id}/logs"
  }
}
```

替换后（Windows）：

```json
{
  "command": "C:\\Users\\soddy\\.nuwaclaw\\acp-agent\\bin\\my-agent",
  "args": ["--verbose"],
  "env": {
    "LOG_DIR": "C:\\Users\\soddy\\.nuwaclaw\\logs\\agent_logs\\{project_id}\\logs"
  }
}
```

**特点**：
- Agent 二进制在 `acp-agent` 目录下（通过 `/agent-mgmt/agents/install-from-url` 安装）
- 日志统一存放在 `logs/agent_logs/` 目录
- 路径更短、更规范

---

## 目录结构

> 以下以默认路径 `~/.nuwaclaw/`（即 `{APP_DATA_DIR}`）为例，实际路径由 `getAppDataDir()` 决定。

```
{APP_DATA_DIR}/                          ← 应用数据目录（默认 ~/.nuwaclaw/）
├── acp-agent/                          ← /computer/chat 的 command/args 替换目标
│   ├── bin/
│   │   └── my-agent                    ← 已安装的 Agent 二进制
│   ├── lib/
│   ├── cache/
│   └── registry.json
├── logs/
│   └── agent_logs/                     ← /computer/chat 的 env 替换目标
│       └── {project_id}/
│           └── ...
└── workspace/                          ← 默认工作目录
    └── computer-project-workspace/     ← /devcomputer/chat 的替换目标
        └── {user_id}/
            └── {project_id}/
                ├── src/
                ├── node_modules/
                └── logs/
```

---

## Windows 路径处理

- `path.join()` 在 Windows 上自动使用反斜杠 `\`
- 替换后保持当前平台的原生路径格式，不做正斜杠统一
- Windows 子进程能正确识别反斜杠路径

---

## 实现位置

| 文件 | 函数 | 说明 |
|------|------|------|
| `src/main/services/workspacePaths.ts` | `resolveWorkspacePrefix()` | 单个字符串替换 |
| `src/main/services/workspacePaths.ts` | `resolveAgentServerPaths()` | 批量替换 command/args |
| `src/main/services/workspacePaths.ts` | `resolveAgentEnvPaths()` | 批量替换 env 值 |
| `src/main/services/computer/router.ts` | `handleComputerChat()` | 调用替换逻辑，区分 source |

---

## 调用流程

```
POST /devcomputer/chat 或 /computer/chat
    │
    ▼
handleComputerChat(req, res, body, source)
    │
    ├── 检查 agent_server 中是否有 {PREFIX_WORKSPACE_DIR}
    │
    ├── 计算替换路径
    │   ├── source="devcomputer" → cmdPrefix = envPrefix = workspaceDir/computer-project-workspace/{user_id}
    │   └── source="computer"   → cmdPrefix = acp-agent/，envPrefix = logs/agent_logs/
    │
    ├── 替换 command/args → resolveAgentServerPaths()
    ├── 替换 env          → resolveAgentEnvPaths()
    │
    └── 继续处理（自动安装检查 → 引擎创建 → 对话）
```
