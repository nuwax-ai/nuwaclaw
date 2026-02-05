//! 服务管理器模块
//!
//! 管理 nuwax-file-server, nuwax-lanproxy 和 HTTP Server 服务的启动、停止、重启

use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use super::http_server::HttpServer;

// ========== 进程检测辅助函数 ==========

/// 通过进程名称检测进程是否正在运行
///
/// 跨平台实现：
/// - macOS/Linux: 使用 `pgrep -x <name>` 精确匹配进程名
/// - Windows: 使用 `tasklist /FI "IMAGENAME eq <name>.exe"`
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `Option<Vec<u32>>` - 如果进程存在，返回 PID 列表；否则返回 None
pub fn find_processes_by_name(process_name: &str) -> Option<Vec<u32>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep -x 精确匹配进程名
        let output = std::process::Command::new("pgrep")
            .arg("-x")
            .arg(process_name)
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 tasklist 查询进程
        let exe_name = if process_name.ends_with(".exe") {
            process_name.to_string()
        } else {
            format!("{}.exe", process_name)
        };

        let output = std::process::Command::new("tasklist")
            .args([
                "/FI",
                &format!("IMAGENAME eq {}", exe_name),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter(|line| !line.trim().is_empty() && !line.contains("No tasks"))
                .filter_map(|line| {
                    // CSV 格式: "process.exe","PID","Session Name","Session#","Mem Usage"
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        parts[1].trim_matches('"').parse::<u32>().ok()
                    } else {
                        None
                    }
                })
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }
}

/// 检测指定进程名是否正在运行
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `bool` - 如果进程存在返回 true
pub fn is_process_running(process_name: &str) -> bool {
    find_processes_by_name(process_name).is_some()
}

/// 终止指定名称的所有进程
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `Result<u32, String>` - 成功返回终止的进程数量
pub fn kill_processes_by_name(process_name: &str) -> Result<u32, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pkill -x 精确匹配并终止进程
        let output = std::process::Command::new("pkill")
            .arg("-x")
            .arg(process_name)
            .output()
            .map_err(|e| format!("Failed to run pkill: {}", e))?;

        // pkill 返回 0 表示至少终止了一个进程
        if output.status.success() {
            // 获取实际终止的数量
            if let Some(pids) = find_processes_by_name(process_name) {
                Ok(0) // 进程仍存在，可能需要 SIGKILL
            } else {
                Ok(1) // 假设至少终止了 1 个
            }
        } else {
            // 返回码 1 表示没有匹配的进程
            Ok(0)
        }
    }

    #[cfg(target_os = "windows")]
    {
        let exe_name = if process_name.ends_with(".exe") {
            process_name.to_string()
        } else {
            format!("{}.exe", process_name)
        };

        let output = std::process::Command::new("taskkill")
            .args(["/F", "/IM", &exe_name])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        if output.status.success() {
            Ok(1)
        } else {
            Ok(0)
        }
    }
}

/// 服务类型
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceType {
    /// nuwax-file-server 服务
    NuwaxFileServer,
    /// nuwax-lanproxy 服务
    NuwaxLanproxy,
    /// HTTP Server (rcoder) 服务
    Rcoder,
}

/// 服务状态
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceState {
    /// 停止
    Stopped,
    /// 运行中
    Running,
    /// 启动中
    Starting,
    /// 停止中
    Stopping,
    /// 错误
    Error(String),
}

/// 服务信息
#[derive(Debug, Clone)]
pub struct ServiceInfo {
    /// 服务类型
    pub service_type: ServiceType,
    /// 服务状态
    pub state: ServiceState,
    /// 进程 PID（如果是运行中）
    pub pid: Option<u32>,
}

/// NuwaxFileServer 配置
#[derive(Debug, Clone)]
pub struct NuwaxFileServerConfig {
    /// 端口
    pub port: u16,
    /// 环境
    pub env: String,
    /// 项目名称
    pub init_project_name: String,
    /// 项目目录
    pub init_project_dir: String,
    /// 上传目录
    pub upload_project_dir: String,
    /// 工作空间目录
    pub project_source_dir: String,
    /// 目标目录
    pub dist_target_dir: String,
    /// 日志基础目录
    pub log_base_dir: String,
    /// 工作空间目录
    pub computer_workspace_dir: String,
    /// 计算机日志目录
    pub computer_log_dir: String,
}

impl Default for NuwaxFileServerConfig {
    fn default() -> Self {
        Self {
            port: 60000,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: "/data/init".to_string(),
            upload_project_dir: "/data/zips".to_string(),
            project_source_dir: "/data/workspace".to_string(),
            dist_target_dir: "/var/www/nginx".to_string(),
            log_base_dir: "/var/logs/project_logs".to_string(),
            computer_workspace_dir: "/data/computer".to_string(),
            computer_log_dir: "/var/logs/computer".to_string(),
        }
    }
}

/// NuwaxLanproxy 配置
#[derive(Debug, Clone)]
pub struct NuwaxLanproxyConfig {
    /// 可执行文件完整路径
    pub bin_path: String,
    /// 服务器 IP
    pub server_ip: String,
    /// 服务器端口
    pub server_port: u16,
    /// 客户端密钥
    pub client_key: String,
}

impl Default for NuwaxLanproxyConfig {
    fn default() -> Self {
        Self {
            bin_path: "nuwax-lanproxy".to_string(),
            server_ip: "127.0.0.1".to_string(),
            server_port: 9000,
            client_key: "test_key".to_string(),
        }
    }
}

/// 服务管理器
#[derive(Clone)]
pub struct ServiceManager {
    /// nuwax-file-server 进程（统一使用 process_wrap）
    nuwax_file_server: Arc<Mutex<Option<Box<dyn process_wrap::tokio::ChildWrapper>>>>,
    /// nuwax-file-server 配置
    config: Arc<NuwaxFileServerConfig>,
    /// nuwax-lanproxy 进程（使用 process_wrap 进程组）
    lanproxy: Arc<Mutex<Option<Box<dyn process_wrap::tokio::ChildWrapper>>>>,
    /// nuwax-lanproxy 配置
    lanproxy_config: Arc<NuwaxLanproxyConfig>,
    /// HTTP Server 管理器
    http_server: Arc<tokio::sync::Mutex<Option<crate::http_server::HttpServer>>>,
}

impl ServiceManager {
    /// 创建新的服务管理器
    pub fn new(
        config: Option<NuwaxFileServerConfig>,
        lanproxy_config: Option<NuwaxLanproxyConfig>,
    ) -> Self {
        Self {
            nuwax_file_server: Arc::new(Mutex::new(None)),
            config: Arc::new(config.unwrap_or_default()),
            lanproxy: Arc::new(Mutex::new(None)),
            lanproxy_config: Arc::new(lanproxy_config.unwrap_or_default()),
            http_server: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// 启动 nuwax-file-server
    pub async fn file_server_start(&self) -> Result<(), String> {
        info!("Starting nuwax-file-server...");

        let mut cmd = process_wrap::tokio::CommandWrap::with_new("nuwax-file-server", |cmd| {
            cmd.arg("start")
                .arg("--env")
                .arg(&self.config.env)
                .arg("--port")
                .arg(self.config.port.to_string())
                .arg(format!(
                    "INIT_PROJECT_NAME={}",
                    &self.config.init_project_name
                ))
                .arg(format!(
                    "INIT_PROJECT_DIR={}",
                    &self.config.init_project_dir
                ))
                .arg(format!(
                    "UPLOAD_PROJECT_DIR={}",
                    &self.config.upload_project_dir
                ))
                .arg(format!(
                    "PROJECT_SOURCE_DIR={}",
                    &self.config.project_source_dir
                ))
                .arg(format!("DIST_TARGET_DIR={}", &self.config.dist_target_dir))
                .arg(format!("LOG_BASE_DIR={}", &self.config.log_base_dir))
                .arg(format!(
                    "COMPUTER_WORKSPACE_DIR={}",
                    &self.config.computer_workspace_dir
                ))
                .arg(format!(
                    "COMPUTER_LOG_DIR={}",
                    &self.config.computer_log_dir
                ));
        });

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-file-server: {}", e))?;

        let mut guard = self.nuwax_file_server.lock().await;
        *guard = Some(child);

        info!("nuwax-file-server started successfully");
        Ok(())
    }

    /// 停止 nuwax-file-server
    pub async fn file_server_stop(&self) -> Result<(), String> {
        info!("Stopping nuwax-file-server...");

        let mut guard = self.nuwax_file_server.lock().await;
        if let Some(child) = guard.take() {
            let mut child = child;

            if let Err(e) = child.start_kill() {
                warn!("Failed to send kill signal, process may have exited: {}", e);
            }

            use std::time::Duration;
            use tokio::time::timeout;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("nuwax-file-server stopped gracefully");
                    } else {
                        info!(
                            "nuwax-file-server stopped with exit code: {:?}",
                            status.code()
                        );
                    }
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for nuwax-file-server: {}", e);
                }
                Err(_) => {
                    warn!("nuwax-file-server stop timed out");
                }
            }
        } else {
            warn!("nuwax-file-server is not running");
        }

        Ok(())
    }

    /// 重启 nuwax-file-server
    pub async fn file_server_restart(&self) -> Result<(), String> {
        self.file_server_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.file_server_start().await
    }

    /// 使用指定端口启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入端口参数，用于支持从 Tauri Store 动态读取端口配置
    ///
    /// # Arguments
    /// * `port` - 文件服务端口号
    pub async fn file_server_start_with_port(&self, port: u16) -> Result<(), String> {
        info!("Starting nuwax-file-server on port {}...", port);

        let mut cmd = process_wrap::tokio::CommandWrap::with_new("nuwax-file-server", |cmd| {
            cmd.arg("start")
                .arg("--env")
                .arg(&self.config.env)
                .arg("--port")
                .arg(port.to_string())
                .arg(format!(
                    "INIT_PROJECT_NAME={}",
                    &self.config.init_project_name
                ))
                .arg(format!(
                    "INIT_PROJECT_DIR={}",
                    &self.config.init_project_dir
                ))
                .arg(format!(
                    "UPLOAD_PROJECT_DIR={}",
                    &self.config.upload_project_dir
                ))
                .arg(format!(
                    "PROJECT_SOURCE_DIR={}",
                    &self.config.project_source_dir
                ))
                .arg(format!("DIST_TARGET_DIR={}", &self.config.dist_target_dir))
                .arg(format!("LOG_BASE_DIR={}", &self.config.log_base_dir))
                .arg(format!(
                    "COMPUTER_WORKSPACE_DIR={}",
                    &self.config.computer_workspace_dir
                ))
                .arg(format!(
                    "COMPUTER_LOG_DIR={}",
                    &self.config.computer_log_dir
                ));
        });

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-file-server on port {}: {}", port, e))?;

        let mut guard = self.nuwax_file_server.lock().await;
        *guard = Some(child);

        info!("nuwax-file-server started successfully on port {}", port);
        Ok(())
    }

    /// 启动 nuwax-lanproxy
    ///
    /// 使用 process_wrap 进程组方式启动，确保子进程不会成为僵尸进程
    /// - Unix/Linux/macOS: 使用 ProcessGroup::leader()
    /// - Windows: 使用 JobObject::new()
    /// - 双重保障: kill_on_drop 确保进程被正确终止
    ///
    /// TODO: 从 Tauri store 读取配置
    /// 需要前端定义 store 中的配置字段名，如:
    /// - nuwax-lanproxy.server_ip: 服务器 IP
    /// - nuwax-lanproxy.server_port: 服务器端口
    /// - nuwax-lanproxy.client_key: 客户端密钥
    pub async fn lanproxy_start(&self) -> Result<(), String> {
        info!("Starting nuwax-lanproxy...");

        // TODO: 从 store 读取配置
        // let server_ip: String = store.get("nuwax-lanproxy.server_ip").unwrap_or_default();
        // let server_port: u16 = store.get("nuwax-lanproxy.server_port").unwrap_or_default();
        // let client_key: String = store.get("nuwax-lanproxy.client_key").unwrap_or_default();

        // 使用配置中的完整路径
        let lanproxy_bin = &self.lanproxy_config.bin_path;
        info!("[Lanproxy] 使用可执行文件路径: {}", lanproxy_bin);

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(lanproxy_bin.as_str(), |cmd| {
            cmd.arg("-s").arg(&self.lanproxy_config.server_ip);
            cmd.arg("-p")
                .arg(self.lanproxy_config.server_port.to_string());
            cmd.arg("-k").arg(&self.lanproxy_config.client_key);
            cmd.arg("--ssl=true");
        });

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        let mut guard = self.lanproxy.lock().await;
        *guard = Some(child);

        info!("nuwax-lanproxy started successfully");
        Ok(())
    }

    /// 停止 nuwax-lanproxy
    pub async fn lanproxy_stop(&self) -> Result<(), String> {
        info!("Stopping nuwax-lanproxy...");

        let mut guard = self.lanproxy.lock().await;
        if let Some(child) = guard.take() {
            // 使用 process_wrap 的 kill 方法
            // 使用 start_kill() 发送终止信号，然后用 wait() 等待退出
            let mut child = child;

            // 发送 kill 信号，如果进程已退出可能会失败（ESRCH）
            if let Err(e) = child.start_kill() {
                // 进程可能已经退出，尝试等待获取最终状态
                warn!("Failed to send kill signal, process may have exited: {}", e);
            }

            // 等待进程退出，带超时
            use std::time::Duration;
            use tokio::time::timeout;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("nuwax-lanproxy stopped gracefully");
                    } else {
                        info!("nuwax-lanproxy stopped with exit code: {:?}", status.code());
                    }
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for nuwax-lanproxy: {}", e);
                }
                Err(_) => {
                    warn!("nuwax-lanproxy stop timed out, process may still be terminating");
                }
            }
        } else {
            warn!("nuwax-lanproxy is not running");
        }

        Ok(())
    }

    /// 重启 nuwax-lanproxy
    pub async fn lanproxy_restart(&self) -> Result<(), String> {
        self.lanproxy_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.lanproxy_start().await
    }

    /// 使用指定配置启动 nuwax-lanproxy
    pub async fn lanproxy_start_with_config(
        &self,
        config: NuwaxLanproxyConfig,
    ) -> Result<(), String> {
        info!("[Lanproxy] ========== 启动代理服务 ==========");
        info!("[Lanproxy] 可执行文件路径: {}", config.bin_path);
        info!(
            "[Lanproxy] 服务器地址: {}:{}",
            config.server_ip, config.server_port
        );
        info!(
            "[Lanproxy] 客户端密钥: {}****{}",
            &config.client_key[..config
                .client_key
                .len()
                .saturating_sub(4)
                .min(config.client_key.len())],
            if config.client_key.len() > 4 {
                &config.client_key[config.client_key.len() - 4..]
            } else {
                "****"
            }
        );

        // 打印完整启动命令
        info!(
            "[Lanproxy] 启动命令: {} -s {} -p {} -k {} --ssl=true",
            config.bin_path, config.server_ip, config.server_port, config.client_key
        );

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
            cmd.arg("-s").arg(&config.server_ip);
            cmd.arg("-p").arg(config.server_port.to_string());
            cmd.arg("-k").arg(&config.client_key);
            cmd.arg("--ssl=true");
        });

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| {
                error!("[Lanproxy] 启动失败: {}", e);
                format!("Failed to start nuwax-lanproxy: {}", e)
            })?;

        let mut guard = self.lanproxy.lock().await;
        *guard = Some(child);

        info!("[Lanproxy] 进程已启动，等待运行状态...");
        Ok(())
    }

    /// 启动 HTTP Server
    pub async fn rcoder_start(
        &self,
        port: u16,
        agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>,
    ) -> Result<(), String> {
        info!("Starting HTTP Server (rcoder) on port {}...", port);

        let server = super::http_server::HttpServer::new(port);
        let server_clone = server.clone();

        // 在后台启动服务
        tokio::spawn(async move {
            if let Err(e) = server_clone.start(agent_runner_api).await {
                error!("HTTP Server error: {}", e);
            }
        });

        // 等待一小段时间让服务启动
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let mut guard = self.http_server.lock().await;
        *guard = Some(server);

        info!("HTTP Server (rcoder) started");
        Ok(())
    }

    /// 停止 HTTP Server
    pub async fn rcoder_stop(&self) -> Result<(), String> {
        info!("Stopping HTTP Server (rcoder)...");

        let mut guard: tokio::sync::MutexGuard<'_, Option<HttpServer>> =
            self.http_server.lock().await;
        if let Some(server) = guard.take() {
            drop(guard);
            server.stop();
            info!("HTTP Server (rcoder) stopped");
        } else {
            warn!("HTTP Server (rcoder) is not running");
        }

        Ok(())
    }

    /// 重启 HTTP Server
    pub async fn rcoder_restart(
        &self,
        port: u16,
        agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>,
    ) -> Result<(), String> {
        self.rcoder_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.rcoder_start(port, agent_runner_api).await
    }

    /// 停止所有服务
    pub async fn services_stop_all(&self) -> Result<(), String> {
        info!("[Services] ========== 停止所有服务 ==========");

        info!("[Services] 1/3 停止 Agent 服务 (rcoder)...");
        if let Err(e) = self.rcoder_stop().await {
            warn!("[Services]   - Agent 服务停止失败: {}", e);
        } else {
            info!("[Services]   - Agent 服务已停止");
        }

        info!("[Services] 2/3 停止文件服务 (nuwax-file-server)...");
        if let Err(e) = self.file_server_stop().await {
            warn!("[Services]   - 文件服务停止失败: {}", e);
        } else {
            info!("[Services]   - 文件服务已停止");
        }

        info!("[Services] 3/3 停止代理服务 (nuwax-lanproxy)...");
        if let Err(e) = self.lanproxy_stop().await {
            warn!("[Services]   - 代理服务停止失败: {}", e);
        } else {
            info!("[Services]   - 代理服务已停止");
        }

        info!("[Services] ========== 所有服务停止完成 ==========");
        Ok(())
    }

    /// 重启所有服务
    pub async fn services_restart_all(
        &self,
        port: u16,
        agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>,
    ) -> Result<(), String> {
        info!("Restarting all services...");

        self.services_stop_all().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        self.rcoder_start(port, agent_runner_api.clone()).await?;
        self.file_server_start().await?;
        self.lanproxy_start().await?;

        info!("All services restarted");
        Ok(())
    }

    /// 获取所有服务状态
    pub async fn services_status_all(&self) -> Vec<ServiceInfo> {
        self.get_all_status().await
    }

    /// 获取所有服务状态（别名方法）
    pub async fn get_all_status(&self) -> Vec<ServiceInfo> {
        let mut statuses = Vec::new();

        // nuwax-file-server 状态
        // 注意：nuwax-file-server 是 daemon 模式，start 命令会 fork 出独立进程后退出
        // 所以这里不返回 PID（实际 daemon 的 PID 需要通过 nuwax-file-server status 获取）
        {
            let guard = self.nuwax_file_server.lock().await;
            if guard.is_some() {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Running,
                    pid: None, // daemon 模式不返回启动命令的 PID
                });
                debug!("[Services] 文件服务运行中");
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] 文件服务已停止");
            }
        }

        // nuwax-lanproxy 状态
        {
            let guard = self.lanproxy.lock().await;
            if let Some(child) = &*guard {
                // process_wrap::tokio::ChildWrapper.id() 返回 Option<u32>
                let pid = child.id();
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxLanproxy,
                    state: ServiceState::Running,
                    pid,
                });
                debug!("[Services] 代理服务运行中, PID: {:?}", pid);
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxLanproxy,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] 代理服务已停止");
            }
        }

        // HTTP Server 状态
        {
            let guard = self.http_server.lock().await;
            if guard.is_some() {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::Rcoder,
                    state: ServiceState::Running,
                    pid: None, // HTTP Server 是内嵌的，没有独立 PID
                });
                debug!("[Services] Agent 服务运行中");
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::Rcoder,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] Agent 服务已停止");
            }
        }

        statuses
    }
}
