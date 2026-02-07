# Tauri Commands 集成设计方案

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
- `<domain>` 对应服务或业务模块，例如 `agent`、`dependency`、`file_server`、`rcoder`
- `<action>` 为动词或动宾短语，尽量语义明确：`start`、`stop`、`restart`、`status`、`query_version`

## 4. API 草稿（与服务同学沟通版）

以下是已约定的接口草稿，将作为“第一期落地”目标：

### 4.1 Agent 服务（以 rcoder 作为对照）

统一以 rcoder 服务命令作为对照：  
- `commands::rcoder_start()`  
- `commands::rcoder_stop()`  
- `commands::rcoder_restart()`  
- 状态查询请使用 `commands::services_status_all()`（统一从服务状态集合读取）

### 4.2 配置

已改为 **Tauri Store 持久化方案**，不再通过 `command` 读写配置。  
配置结构以 `docs/store-data-schema.md` 为准，前端写入，Rust 后端只读或监听即可。

### 4.3 依赖管理

当前依赖安装实现（除去系统级 Node/uv）走 **本地 npm 包安装**,真实包名如下:
`nuwax-file-server`、`nuwaxcode`、`claude-code-acp-ts`。

建议命令样例（以真实包名为准,命名遵循 `<domain>_<action>`）:
- `commands::dependency_npm_install("nuwax-file-server")`
- `commands::dependency_npm_query_version("nuwaxcode")`
- `commands::dependency_npm_reinstall("claude-code-acp-ts")`

### 4.4 服务重启

- `commands::file_server_start()`
- `commands::file_server_stop()`
- `commands::file_server_restart()`
- `commands::rcoder_start()`
- `commands::rcoder_stop()`
- `commands::rcoder_restart()`
- `commands::services_stop_all()`
- `commands::services_restart_all()`
- `commands::services_status_all()`

> 注：VNC 相关命令暂定为 TODO，后续补充。

## 5. 命令归类与建议补充

为了提升可维护性，建议在正式实现中做如下归类：

### 5.1 Agent 域（以 rcoder 对照）

- `rcoder_start`：启动 rcoder（Agent HTTP Server）
- `rcoder_stop`：停止 rcoder
- `rcoder_restart`：重启 rcoder
- `services_status_all`：统一读取服务状态

### 5.2 配置域

- 配置读写改为 **Tauri Store**（见 `docs/store-data-schema.md`）  
- Rust 后端仅需读取或监听，无需 `command` 读写

### 5.3 依赖域

- `dependency_list`：获取依赖列表
- `dependency_summary`：依赖统计
- `dependency_install`：安装依赖（通用）
- `dependency_install_all`：安装全部缺失依赖（通用）
- `dependency_uninstall`：卸载依赖（通用）
- `dependency_check`：检查单个依赖（通用）
- `dependency_npm_install`：安装 npm 依赖（本地包）
- `dependency_npm_query_version`：查询 npm 依赖版本
- `dependency_npm_reinstall`：重装 npm 依赖（本地包）

### 5.4 服务域

- `file_server_start`、`file_server_stop`、`file_server_restart`
- `rcoder_start`、`rcoder_stop`、`rcoder_restart`
- `services_restart_all`、`services_stop_all`、`services_status_all`

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

配置结构以 `docs/store-data-schema.md` 为准，此处不再重复列举。  
后续如需新增字段，优先在 Store Schema 中扩展并同步版本号。

## 8. 前端调用流程（建议）

1. UI 触发操作 → 调用 `invoke()`
2. 统一处理 `CommandResult`
3. 成功则刷新 UI 状态
4. 失败则抛出 message 或提示用户

## 9. 风险与注意事项

1. 命令命名需与 Rust `tauri::command` 同步，避免大小写不一致
2. 依赖安装属于高权限操作，需明确安全限制
3. `services_stop_all` / `services_restart_all` 影响范围大，需加确认提示
4. 后续与服务团队协作时，需要统一数据结构版本

## 10. 已实现命令（命名对齐说明）

以下为当前 Rust 侧已实现的基础命令命名风格（节选），用于校验命名是否符合 `<domain>_<action>` 规范：

- 权限：`permission_check`、`permission_request`、`permission_open_settings`、`permission_list`、`permission_monitor_start`、`permission_monitor_stop`
- 依赖：`dependency_list`、`dependency_summary`、`dependency_install`、`dependency_install_all`、`dependency_uninstall`、`dependency_check`
- npm 依赖：`dependency_npm_install`、`dependency_npm_query_version`、`dependency_npm_reinstall`
- 服务：`file_server_start`、`file_server_stop`、`file_server_restart`、`rcoder_start`、`rcoder_stop`、`rcoder_restart`、`services_stop_all`、`services_restart_all`、`services_status_all`
- lanproxy：`lanproxy_start`、`lanproxy_stop`、`lanproxy_restart`
- 系统：`app_data_dir_get`、`dialog_select_directory`、`autolaunch_set`、`autolaunch_get`

## 11. 下一步建议

1. 与服务侧确认命令命名、参数、返回结构最终版
2. 在 Rust 侧完成对应命令框架（仅接口，不含业务实现）
3. 前端替换 Mock 调用，接入真实 IPC 命令
4. VNC 服务接口补齐并扩展文档
