# Tauri Commands 集成设计方案（草案）

> 目标：在不直接写代码的前提下，先明确 Tauri 前端与 Rust 后端的命令接口设计、调用流程、数据结构和集成边界，为后续与服务端/本地服务打通提供统一规范。

## 1. 背景与范围

- 客户端技术栈：Tauri 2 + React 18 + Ant Design 5
- 后端接入方式：通过 `tauri::command` 暴露 Rust IPC 命令，由前端统一调用
- 本期范围：
  - 代理服务（Agent Service）
  - 文件服务（File Server）
  - Agent Server（远程管理/调度服务）
  - VNC 服务（TODO）
  - 配置、依赖管理、服务重启等命令

## 2. 设计目标

1. **统一命名与调用方式**，降低前端调用复杂度
2. **最小接口集**，先满足核心业务路径，再扩展
3. **可观测性**，统一错误与日志返回
4. **可扩展性**，后续新增服务/命令不破坏已有接口

## 3. 命令命名规范

- 命令命名采用 `commands::<domain>_<action>` 风格
- `<domain>` 对应服务或业务模块，例如 `computer_agent`、`config`、`dependency`
- `<action>` 为动词，尽量语义明确：`start`、`stop`、`restart`、`status`、`query`、`update`

## 4. API 草稿（与服务同学沟通版）

以下是已约定的接口草稿，将作为“第一期落地”目标：

### 4.1 Agent 服务

- `commands::computer_agent_stop`
- `commands::computer_agent_session_cancel`
- `commands::computer_agent_status`

### 4.2 配置

已改为 **Tauri Store 持久化方案**，不再通过 `command` 读写配置。  
配置结构以 `docs/store-data-schema.md` 为准，前端写入，Rust 后端只读或监听即可。

### 4.3 依赖管理

当前依赖安装实现（除去系统级 Node/uv）走 **本地 npm 包安装**，真实包名如下：  
`nuwax-file-server`、`nuwaxcode`、`claude-code-acp`。

建议命令样例（以真实包名为准）：\n+\n+- `commands::install_dependency(\"nuwax-file-server\")`\n+- `commands::query_version(\"nuwaxcode\")`\n+- `commands::reinstall_dependency(\"claude-code-acp\")`

### 4.4 服务重启

- `commands::restart_nuwax-file-server()`
- `commands::stop_nuwax-file-server()`
- `commands::stop_rcoder()`
- `commands::restart_rcoder()`
- `commands::stop_all()`
- `commands::restart_all()`

> 注：VNC 相关命令暂定为 TODO，后续补充。

## 5. 命令归类与建议补充

为了提升可维护性，建议在正式实现中做如下归类：

### 5.1 Agent 域

- `computer_agent_status`：查询运行状态
- `computer_agent_stop`：停止 Agent
- `computer_agent_session_cancel`：取消当前会话
- （可选补充）`computer_agent_start`
- （可选补充）`computer_agent_logs` / `computer_agent_events`

### 5.2 配置域

- `queryConfig`：读取配置
- `updateConfig`：更新配置
- （可选补充）`validateConfig`

### 5.3 依赖域

- `install_dependency`：安装依赖
- `query_version`：查询依赖版本
- `reinstall_dependency`：重装依赖
- （可选补充）`check_dependency`、`list_dependencies`

### 5.4 服务域

- `restart_nuwax-file-server`、`stop_nuwax-file-server`
- `restart_rcoder`、`stop_rcoder`
- `restart_all`、`stop_all`

### 5.5 VNC 域（预留）

- `vnc_status`
- `vnc_start`
- `vnc_stop`

## 6. 统一返回结构（建议）

为了前端统一处理错误/成功状态，建议所有命令返回以下结构：

```ts
interface CommandResult<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  code?: string; // 统一业务错误码，可选
}
```

示例：

- `success = true` 时返回 `data`
- `success = false` 时返回 `message` 与错误码

## 7. 配置对象草案

`updateConfig` / `queryConfig` 返回的配置对象建议包含：

```ts
interface AgentConfig {
  serverHost: string;   // 服务域名
  agentPort: number;    // Agent 服务端口
  fileServerPort: number; // 文件服务端口
  proxyPort: number;    // 代理端口
  workspaceDir: string; // 工作区目录
}
```

（后续可扩展：token、环境标识、日志级别等）

## 8. 前端调用流程（建议）

1. UI 触发操作 → 调用 `invoke()`
2. 统一处理 `CommandResult`
3. 成功则刷新 UI 状态
4. 失败则抛出 message 或提示用户

## 9. 风险与注意事项

1. 命令命名需与 Rust `tauri::command` 同步，避免大小写不一致
2. 依赖安装属于高权限操作，需明确安全限制
3. `stop_all` / `restart_all` 影响范围大，需加确认提示
4. 后续与服务团队协作时，需要统一数据结构版本

## 10. 下一步建议

1. 与服务侧确认命令命名、参数、返回结构最终版
2. 在 Rust 侧完成对应命令框架（仅接口，不含业务实现）
3. 前端替换 Mock 调用，接入真实 IPC 命令
4. VNC 服务接口补齐并扩展文档
