# Lanproxy Sidecar API 迁移方案（完全版）

## 目标

将 nuwax-lanproxy 的进程管理从 Core 层（`process_wrap`）完全迁移到 Tauri 层，直接使用 Tauri 官方 sidecar API（`app.shell().sidecar().spawn()`）。

## 架构变更

### 迁移前
```
Tauri 层 (commands/services/lanproxy.rs)
  └─ 读取配置 + 获取 bin_path
     └─> Core 层 ServiceManager.lanproxy_start_with_config(config)
           └─ process_wrap::CommandWrap::with_new(bin_path)
              └─ spawn_wrapped (ProcessGroup + KillOnDrop)
```

### 迁移后
```
Tauri 层 (commands/services/lanproxy.rs)
  └─ 读取配置
     └─ nuwax_agent_core::kill_stale_lanproxy_processes()  // 清理残留
     └─ app.shell().sidecar("binaries/nuwax-lanproxy")
           .args(["-s", ip, "-p", port, ...])
           .spawn()  // 返回 (Receiver, CommandChild)
        └─ 存入 LanproxyState

Core 层 ServiceManager
  └─ 不再包含 lanproxy 字段
  └─ 仅保留公开的残留进程清理函数
```

## 详细实施步骤

### Step 1: Core 层清理 lanproxy 管理逻辑

#### 1.1 修改 `crates/nuwax-agent-core/src/service/process.rs`

将残留进程清理函数的可见性改为 `pub`：

```rust
// 第 366 行
pub async fn kill_stale_lanproxy_processes() {
    // 保持原有实现不变
}

// 如果 is_process_running_fuzzy 和 find_processes_by_prefix 是 pub(crate)，也改为 pub
pub async fn is_process_running_fuzzy(name: &str) -> bool {
    // ...
}

pub async fn find_processes_by_prefix(name: &str) -> Option<Vec<u32>> {
    // ...
}
```

#### 1.2 修改 `crates/nuwax-agent-core/src/service/mod.rs`

删除 `ServiceManager` 中的 lanproxy 相关字段：

```rust
// 删除第 51-52 行
// pub(crate) lanproxy: Arc<Mutex<Option<ChildWrapperType>>>,
// pub(crate) lanproxy_config: Arc<NuwaxLanproxyConfig>,

pub struct ServiceManager {
    pub(crate) nuwax_file_server: Arc<Mutex<Option<ChildWrapperType>>>,
    pub(crate) config: Arc<NuwaxFileServerConfig>,
    // ❌ 删除: pub(crate) lanproxy: Arc<Mutex<Option<ChildWrapperType>>>,
    // ❌ 删除: pub(crate) lanproxy_config: Arc<NuwaxLanproxyConfig>,
    pub(crate) rcoder: Arc<Mutex<Option<Arc<RcoderAgentRunner>>>>,
    pub(crate) mcp_proxy: Arc<Mutex<Option<ChildWrapperType>>>,
    pub(crate) mcp_proxy_config: Arc<McpProxyConfig>,
}
```

修改 `new()` 构造函数：

```rust
pub fn new(config: NuwaxFileServerConfig, mcp_proxy_config: McpProxyConfig) -> Self {
    Self {
        nuwax_file_server: Arc::new(Mutex::new(None)),
        config: Arc::new(config),
        // ❌ 删除: lanproxy: Arc::new(Mutex::new(None)),
        // ❌ 删除: lanproxy_config: Arc::new(NuwaxLanproxyConfig::default()),
        rcoder: Arc::new(Mutex::new(None)),
        mcp_proxy: Arc::new(Mutex::new(None)),
        mcp_proxy_config: Arc::new(mcp_proxy_config),
    }
}
```

删除 lanproxy 相关公开方法：

```rust
// ❌ 删除这些方法
// pub async fn lanproxy_start_with_config(&self, config: NuwaxLanproxyConfig) -> Result<(), String>
// pub async fn lanproxy_stop(&self) -> Result<(), String>
// pub async fn lanproxy_restart(&self) -> Result<(), String>
```

修改 `services_stop_all()` 方法（第 240-273 行）：

```rust
pub async fn services_stop_all(&self) -> Result<(), String> {
    info!("[Services] ========== 停止所有服务 ==========");

    // 1. 停止 rcoder agent
    info!("[Services] 停止 Rcoder Agent...");
    self.rcoder_stop().await?;
    info!("[Services] Rcoder Agent 已停止");

    // 2. 停止 nuwax-file-server
    info!("[Services] 停止 Nuwax File Server...");
    self.nuwax_file_server_stop().await?;
    info!("[Services] Nuwax File Server 已停止");

    // ❌ 删除步骤 3: 停止 lanproxy
    // info!("[Services] 停止 Lanproxy...");
    // lanproxy::stop(&self).await?;
    // info!("[Services] Lanproxy 已停止");

    // 3. 停止 MCP Proxy (原步骤 4)
    info!("[Services] 停止 MCP Proxy...");
    self.mcp_proxy_stop().await?;
    info!("[Services] MCP Proxy 已停止");

    info!("[Services] 所有服务已停止");
    Ok(())
}
```

修改 `get_all_status()` 方法（第 302-394 行）：

```rust
pub async fn get_all_status(&self) -> ServiceStatusResponse {
    let file_server_status = self.get_file_server_status().await;
    // ❌ 删除 lanproxy_status 的获取逻辑
    let mcp_proxy_status = self.get_mcp_proxy_status().await;

    ServiceStatusResponse {
        file_server: file_server_status,
        // ❌ 删除: lanproxy: lanproxy_status,
        mcp_proxy: mcp_proxy_status,
    }
}
```

#### 1.3 删除 `crates/nuwax-agent-core/src/service/lanproxy.rs`

整个文件不再需要，直接删除。

#### 1.4 修改 `crates/nuwax-agent-core/src/service/config.rs`

删除 `NuwaxLanproxyConfig`（或标记为 deprecated）：

```rust
// ❌ 完全删除此结构体
// pub struct NuwaxLanproxyConfig {
//     pub bin_path: String,
//     pub server_ip: String,
//     pub server_port: u16,
//     pub client_key: String,
// }
```

#### 1.5 修改 `crates/nuwax-agent-core/src/lib.rs`

删除 lanproxy 相关导出：

```rust
// ❌ 删除这些导出
// pub use service::NuwaxLanproxyConfig;
// pub use service::lanproxy;

// ✅ 确保导出残留进程清理函数
pub use service::process::{
    kill_stale_lanproxy_processes,
    is_process_running_fuzzy,
};
```

---

### Step 2: Tauri 层新增 LanproxyState

#### 2.1 修改 `crates/agent-tauri-client/src-tauri/src/state/mod.rs`

新增 `LanproxyState` 结构体：

```rust
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;

/// Lanproxy 进程状态管理（使用 Tauri sidecar API）
#[derive(Default)]
pub struct LanproxyState {
    /// Tauri sidecar CommandChild（进程句柄）
    pub child: Mutex<Option<CommandChild>>,
    /// 事件接收器（stdout/stderr/terminated 等）
    pub receiver: Mutex<Option<Receiver<CommandEvent>>>,
}
```

导出新类型：

```rust
pub use lanproxy::LanproxyState;
```

#### 2.2 修改 `crates/agent-tauri-client/src-tauri/src/main.rs`

注册 `LanproxyState` 到 Tauri 的状态管理：

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            setup::perform_setup(app)?;
            Ok(())
        })
        .manage(ServiceManagerState::default())
        .manage(LanproxyState::default())  // ✅ 新增
        .invoke_handler(tauri::generate_handler![
            // ... 现有命令
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Step 3: Tauri 层使用 sidecar API 重写 lanproxy 命令

#### 3.1 完全重写 `crates/agent-tauri-client/src-tauri/src/commands/services/lanproxy.rs`

```rust
use crate::state::*;
use crate::utils::*;
use tauri_plugin_shell::ShellExt;

/// 启动 nuwax-lanproxy 客户端（使用 Tauri sidecar API）
///
/// 从 Tauri store 读取配置后，使用 app.shell().sidecar() 启动进程
#[tauri::command]
pub async fn lanproxy_start(
    app: tauri::AppHandle,
    lanproxy_state: tauri::State<'_, LanproxyState>,
) -> Result<bool, String> {
    info!("[Lanproxy] ========== Starting Proxy Service (via Tauri sidecar) ==========");

    // 1. 从 store 读取配置
    let server_host = match read_store_string(&app, "lanproxy.server_host") {
        Ok(Some(host)) => {
            info!("[Lanproxy] server_host: {}", host);
            host
        }
        Ok(None) => {
            let err = "配置缺失: lanproxy.server_host";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 lanproxy.server_host 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };
    let server_ip = strip_host_from_url(&server_host);
    info!("[Lanproxy] server_ip (processed): {}", server_ip);

    let server_port = match read_store_port(&app, "lanproxy.server_port") {
        Ok(Some(port)) => {
            info!("[Lanproxy] server_port: {}", port);
            port
        }
        Ok(None) => {
            let err = "配置缺失: lanproxy.server_port";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 lanproxy.server_port 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    let client_key = match read_store_string(&app, "auth.saved_key") {
        Ok(Some(key)) => {
            let masked = if key.len() > 8 {
                format!("{}****{}", &key[..4], &key[key.len() - 4..])
            } else {
                "****".to_string()
            };
            info!("[Lanproxy] client_key: {}", masked);
            key
        }
        Ok(None) => {
            let err = "配置缺失: auth.saved_key";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 auth.saved_key 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    // 2. 检测并清理残留进程（使用 core 层的公开函数）
    info!("[Lanproxy] 检测残留进程...");
    nuwax_agent_core::kill_stale_lanproxy_processes().await;

    // 3. 使用 Tauri sidecar API 启动
    info!("[Lanproxy] 使用 Tauri sidecar API 启动进程...");
    let sidecar_cmd = app
        .shell()
        .sidecar("nuwax-lanproxy")  // 只需文件名，不包含 binaries/ 路径
        .map_err(|e| {
            let err = format!("创建 sidecar 命令失败: {}", e);
            error!("[Lanproxy] {}", err);
            err
        })?;

    let (rx, child) = sidecar_cmd
        .args([
            "-s",
            &server_ip,
            "-p",
            &server_port.to_string(),
            "-k",
            &client_key,
            "--ssl=true",
        ])
        .spawn()
        .map_err(|e| {
            let err = format!("启动 lanproxy sidecar 失败: {}", e);
            error!("[Lanproxy] {}", err);
            err
        })?;

    let pid = child.pid();
    info!("[Lanproxy] 进程已启动，PID: {}", pid);

    // 4. 存储进程句柄和事件接收器
    {
        let mut guard = lanproxy_state.child.lock().await;
        *guard = Some(child);
    }
    {
        let mut guard = lanproxy_state.receiver.lock().await;
        *guard = Some(rx);
    }

    // 5. 等待进程初始化（lanproxy 是客户端，无本地端口可检查）
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 6. 简单验证进程是否还在运行
    let still_running = {
        let guard = lanproxy_state.child.lock().await;
        guard.is_some()
    };

    if !still_running {
        let err = "进程启动后立即退出，请检查配置";
        error!("[Lanproxy] {}", err);
        return Err(err.to_string());
    }

    info!("[Lanproxy] 服务启动成功");
    Ok(true)
}

/// 停止 nuwax-lanproxy 客户端
#[tauri::command]
pub async fn lanproxy_stop(
    lanproxy_state: tauri::State<'_, LanproxyState>,
) -> Result<bool, String> {
    info!("[Lanproxy] 正在停止服务...");

    let child = lanproxy_state.child.lock().await.take();

    if let Some(child) = child {
        info!("[Lanproxy] 发送 kill 信号到 PID: {}", child.pid());
        child.kill().map_err(|e| {
            let err = format!("停止 lanproxy 失败: {}", e);
            error!("[Lanproxy] {}", err);
            err
        })?;
        info!("[Lanproxy] 进程已停止");
    } else {
        info!("[Lanproxy] 进程未运行，无需停止");
    }

    // 清理事件接收器
    lanproxy_state.receiver.lock().await.take();

    Ok(true)
}

/// 重启 nuwax-lanproxy 客户端
#[tauri::command]
pub async fn lanproxy_restart(
    app: tauri::AppHandle,
    lanproxy_state: tauri::State<'_, LanproxyState>,
) -> Result<bool, String> {
    info!("[Lanproxy] 正在重启服务...");

    // 先停止
    lanproxy_stop(lanproxy_state.clone()).await?;

    // 等待端口释放
    info!("[Lanproxy] 等待端口释放 (500ms)...");
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 重新启动
    info!("[Lanproxy] 正在重新启动...");
    lanproxy_start(app, lanproxy_state).await?;

    info!("[Lanproxy] 重启完成");
    Ok(true)
}
```

---

### Step 4: 修改 services_restart_all 和 services_status_all

#### 4.1 修改 `crates/agent-tauri-client/src-tauri/src/commands/services/lifecycle.rs`

**修改函数签名**（第 287 行）：

```rust
#[tauri::command]
pub async fn services_restart_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    lanproxy_state: tauri::State<'_, LanproxyState>,  // ✅ 新增参数
) -> Result<bool, String> {
```

**修改步骤 4: 启动 lanproxy**（第 390-440 行）：

```rust
// 步骤 4/4: 启动 lanproxy
info!("[Services] 步骤 4/4: 启动 lanproxy (via Tauri sidecar)...");

// 从 store 读取 lanproxy 配置（复用 lanproxy_start 的逻辑）
match super::lanproxy::lanproxy_start(app.clone(), lanproxy_state).await {
    Ok(_) => {
        info!("[Services] lanproxy 启动成功");
    }
    Err(e) => {
        let err = format!("lanproxy 启动失败: {}", e);
        error!("[Services]   - {}", err);
        return Err(err);
    }
}
```

**删除原有的 bin_path 查找和 config 构建逻辑**（第 359-440 行全部替换为上面的简化版本）。

#### 4.2 修改 `crates/agent-tauri-client/src-tauri/src/commands/services/status.rs`

假设存在 `services_status_all` 命令，修改函数签名并添加 lanproxy 状态查询：

```rust
#[tauri::command]
pub async fn services_status_all(
    state: tauri::State<'_, ServiceManagerState>,
    lanproxy_state: tauri::State<'_, LanproxyState>,  // ✅ 新增参数
) -> Result<serde_json::Value, String> {
    // 获取其他服务状态（file-server, rcoder, mcp-proxy）
    let core_status = {
        let manager = state.manager.lock().await;
        manager.get_all_status().await
    };

    // 获取 lanproxy 状态
    let lanproxy_running = {
        let guard = lanproxy_state.child.lock().await;
        if guard.is_some() {
            // 进一步验证进程是否真的在运行
            nuwax_agent_core::is_process_running_fuzzy("nuwax-lanproxy").await
        } else {
            false
        }
    };

    let lanproxy_pid = if lanproxy_running {
        lanproxy_state.child.lock().await.as_ref().map(|c| c.pid())
    } else {
        None
    };

    Ok(serde_json::json!({
        "file_server": core_status.file_server,
        "lanproxy": {
            "status": if lanproxy_running { "Running" } else { "Stopped" },
            "pid": lanproxy_pid,
        },
        "mcp_proxy": core_status.mcp_proxy,
    }))
}
```

---

### Step 5: 清理不再需要的路径解析代码

#### 5.1 修改 `crates/agent-tauri-client/src-tauri/src/utils/paths.rs`

删除以下 4 个函数（不再需要手动查找 sidecar 路径）：

```rust
// ❌ 删除第 85-199 行：get_lanproxy_bin_path (deprecated)
// ❌ 删除第 201-252 行：get_lanproxy_bin_path_via_sidecar
// ❌ 删除第 254-289 行：resolve_sidecar_path
// ❌ 删除第 291-320 行：get_platform_binary_name
```

保留其他函数（`get_file_server_bin_path`, `resolve_projects_dir` 等）。

---

### Step 6: 更新命令注册

#### 6.1 确认 `crates/agent-tauri-client/src-tauri/src/main.rs` 中的命令注册

确保 `lanproxy_start`, `lanproxy_stop`, `lanproxy_restart` 已注册：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 其他命令
    lanproxy_start,
    lanproxy_stop,
    lanproxy_restart,
    services_restart_all,
    services_status_all,
])
```

---

## 验证计划

### 开发环境测试

```bash
cd crates/agent-tauri-client
cargo tauri dev
```

预期日志：
```
[Lanproxy] 检测残留进程...
[Lanproxy] 使用 Tauri sidecar API 启动进程...
[Lanproxy] 进程已启动，PID: 12345
[Lanproxy] 服务启动成功
```

### 生产环境测试

```bash
# macOS aarch64
cargo tauri build --target aarch64-apple-darwin

# macOS x86_64
cargo tauri build --target x86_64-apple-darwin

# macOS universal binary (推荐)
cargo tauri build --target universal-apple-darwin
```

验证：
1. 安装打包后的应用
2. 通过 UI 启动 lanproxy
3. 检查进程是否运行：`ps aux | grep nuwax-lanproxy`
4. 测试停止和重启功能
5. 测试 `services_restart_all` 是否正确启动 lanproxy

---

## 关键改进点

1. **符合 Tauri 最佳实践**：直接使用官方 sidecar API，不再自己实现路径解析
2. **跨平台自动处理**：Tauri 自动选择正确架构的二进制文件（包括 universal binary）
3. **代码简化**：删除 200+ 行路径查找逻辑
4. **职责分离清晰**：Tauri 层负责 UI 相关进程管理，Core 层保持框架无关
5. **保留残留进程清理**：仍使用 core 层的 `kill_stale_lanproxy_processes()`

---

## 风险与缓解

### 潜在风险

1. Tauri sidecar API 在开发模式可能行为不同
2. CommandChild 的生命周期管理与 process_wrap 不同

### 缓解措施

1. 详细日志记录每个步骤
2. 开发模式和生产模式分别测试
3. 保留 core 层的残留进程清理机制

### 回滚方案

如果出现问题，可以：
1. 恢复 core 层的 lanproxy 模块
2. 恢复 Tauri 层的 `get_lanproxy_bin_path_via_sidecar` 函数
3. 恢复原有的 `ServiceManager.lanproxy` 字段

---

## 预期成果

- ✅ 符合 Tauri v2 官方推荐的 sidecar 使用方式
- ✅ 支持所有平台架构（macOS x86_64/aarch64, Linux, Windows）
- ✅ 代码更简洁，维护性更强
- ✅ 职责分离更清晰，便于未来其他 UI 客户端复用 core 层
