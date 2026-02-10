//! 服务管理器模块
//!
//! 管理 nuwax-file-server, nuwax-lanproxy 和 HTTP Server 服务的启动、停止、重启

use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

// 类型别名，解决 trait object 类型推断问题
type ChildWrapperType = Box<dyn process_wrap::tokio::ChildWrapper>;

// 导入 RcoderAgentRunner
use super::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};

// ========== 跨平台辅助函数 ==========

/// 获取 nuwax-file-server 的 PID 文件路径
///
/// 跨平台实现：
/// - Unix: /tmp/nuwax-file-server/server.pid
/// - Windows: %TEMP%\nuwax-file-server\server.pid
fn get_file_server_pid_file_path() -> std::path::PathBuf {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        std::path::PathBuf::from("/tmp/nuwax-file-server/server.pid")
    }

    #[cfg(target_os = "windows")]
    {
        let temp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".to_string());
        std::path::PathBuf::from(temp)
            .join("nuwax-file-server")
            .join("server.pid")
    }
}

/// 使用 process_wrap 执行命令，带超时机制
///
/// # Arguments
/// * `program` - 可执行文件路径
/// * `args` - 命令参数
/// * `timeout_secs` - 超时时间（秒）
///
/// # Returns
/// * `bool` - 命令是否成功执行（true = 成功，false = 失败或超时）
async fn run_command_with_timeout(program: &str, args: &[&str], timeout_secs: u64) -> bool {
    let mut cmd = process_wrap::tokio::CommandWrap::with_new(program, |cmd| {
        for arg in args {
            cmd.arg(*arg);
        }
    });

    match cmd.wrap(process_wrap::tokio::KillOnDrop).spawn() {
        Ok(mut child) => {
            match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), child.wait())
                .await
            {
                Ok(Ok(status)) => status.success(),
                Ok(Err(e)) => {
                    warn!("Command wait failed: {}", e);
                    false
                }
                Err(_) => {
                    warn!("Command timed out, killing process");
                    let _ = child.start_kill();
                    false
                }
            }
        }
        Err(e) => {
            warn!("Failed to spawn command: {}", e);
            false
        }
    }
}

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
pub async fn find_processes_by_name(process_name: &str) -> Option<Vec<u32>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep -x 精确匹配进程名
        let output = tokio::process::Command::new("pgrep")
            .arg("-x")
            .arg(process_name)
            .output()
            .await
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

        let output = tokio::process::Command::new("tasklist")
            .args([
                "/FI",
                &format!("IMAGENAME eq {}", exe_name),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .await
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
pub async fn is_process_running(process_name: &str) -> bool {
    find_processes_by_name(process_name).await.is_some()
}

/// 检测 nuwax-file-server 是否正在运行
///
/// nuwax-file-server 是 Node.js 服务，它使用 PID 文件管理进程
/// PID 文件位置: /tmp/nuwax-file-server/server.pid (Unix) 或 %TEMP%\nuwax-file-server\server.pid (Windows)
pub async fn is_file_server_running() -> bool {
    // 使用跨平台辅助函数获取 PID 文件路径
    let pid_file = get_file_server_pid_file_path();

    if !pid_file.exists() {
        return false;
    }

    // 读取 PID 文件内容 (JSON 格式)
    if let Ok(content) = std::fs::read_to_string(&pid_file) {
        // 尝试解析 JSON 获取 PID
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = json.get("pid").and_then(|v| v.as_u64()) {
                // 检查进程是否存在
                return is_pid_running(pid as u32).await;
            }
        }
    }

    false
}

/// 检查指定 PID 的进程是否存在
async fn is_pid_running(pid: u32) -> bool {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 kill -0 检查进程是否存在（通过 shell 命令）
        let output = tokio::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .await;

        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            !stdout.contains("No tasks") && stdout.contains(&pid.to_string())
        } else {
            false
        }
    }
}

/// 通过 PID 文件强制终止 file-server 残留进程
async fn kill_file_server_by_pid() {
    // 使用跨平台辅助函数获取 PID 文件路径
    let pid_file = get_file_server_pid_file_path();

    if let Ok(content) = std::fs::read_to_string(&pid_file) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = json.get("pid").and_then(|v| v.as_u64()) {
                let pid_str = pid.to_string();

                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    run_command_with_timeout("kill", &["-9", &pid_str], 5).await;
                }
                #[cfg(target_os = "windows")]
                {
                    run_command_with_timeout("taskkill", &["/F", "/PID", &pid_str], 5).await;
                }
            }
        }
        // 清理 PID 文件
        let _ = std::fs::remove_file(&pid_file);
    }
}

/// 检测并清理残留的 lanproxy 进程，确保只有一个实例运行
async fn kill_stale_lanproxy_processes() {
    if is_process_running_fuzzy("nuwax-lanproxy").await {
        warn!("[Lanproxy] 检测到残留 nuwax-lanproxy 进程，正在终止");
        if let Some(pids) = find_processes_by_prefix("nuwax-lanproxy").await {
            for pid in &pids {
                info!("[Lanproxy] 终止残留进程 PID: {}", pid);
                let pid_str = pid.to_string();

                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    run_command_with_timeout("kill", &["-9", &pid_str], 5).await;
                }
                #[cfg(target_os = "windows")]
                {
                    run_command_with_timeout("taskkill", &["/F", "/PID", &pid_str], 5).await;
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }
}

/// 检测并清理残留的 file-server 进程，确保只有一个实例运行
///
/// # Arguments
/// * `bin_path` - nuwax-file-server 可执行文件的完整路径
async fn kill_stale_file_server_processes(bin_path: &str) {
    if is_file_server_running().await {
        warn!("[FileServer] 检测到残留 nuwax-file-server 进程，正在终止");
        info!("[FileServer] 使用路径: {} stop", bin_path);

        // 使用 process_wrap 执行 stop 命令
        let success = run_command_with_timeout(bin_path, &["stop"], 5).await;

        if success {
            info!("[FileServer] stop 命令执行成功");
        } else {
            warn!("[FileServer] stop 命令执行失败或超时");
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // 如果还在运行，强制 kill
        if is_file_server_running().await {
            warn!("[FileServer] 优雅停止失败，强制终止");
            kill_file_server_by_pid().await;
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        // 最终验证
        if is_file_server_running().await {
            error!("[FileServer] 无法清理残留进程，启动可能失败");
        }
    }
}

/// 等待端口就绪（可被连接）
///
/// 通过尝试 TCP 连接来检测服务是否已经在监听端口
///
/// # Arguments
/// * `port` - 要检查的端口
/// * `timeout_secs` - 超时时间（秒）
///
/// # Returns
/// * `Ok(())` - 端口已就绪
/// * `Err(String)` - 超时或错误
async fn wait_for_port_ready(port: u16, timeout_secs: u64) -> Result<(), String> {
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::{sleep, timeout};

    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs);
    let retry_interval = Duration::from_millis(100);

    loop {
        match timeout(
            Duration::from_millis(500),
            TcpStream::connect(format!("127.0.0.1:{}", port)),
        )
        .await
        {
            Ok(Ok(_)) => {
                info!("Port {} is ready", port);
                return Ok(());
            }
            Ok(Err(_)) | Err(_) => {
                // 连接失败或超时，检查是否已超过总超时时间
                if start.elapsed() > timeout_duration {
                    return Err(format!(
                        "Timeout waiting for port {} to be ready after {}s",
                        port, timeout_secs
                    ));
                }
                // 继续重试
                sleep(retry_interval).await;
            }
        }
    }
}

/// 检测指定进程名（支持模糊匹配）是否正在运行
///
/// 用于开发模式下检测带平台后缀的二进制文件
/// 如 `nuwax-lanproxy` 可以匹配 `nuwax-lanproxy-aarch64-apple-darwin`
///
/// # Arguments
/// * `process_prefix` - 进程名前缀
///
/// # Returns
/// * `bool` - 如果匹配的进程存在返回 true
pub async fn is_process_running_fuzzy(process_prefix: &str) -> bool {
    find_processes_by_prefix(process_prefix).await.is_some()
}

/// 通过进程名前缀查找进程（模糊匹配）
///
/// # Arguments
/// * `process_prefix` - 进程名前缀
///
/// # Returns
/// * `Option<Vec<u32>>` - 如果进程存在，返回 PID 列表；否则返回 None
pub async fn find_processes_by_prefix(process_prefix: &str) -> Option<Vec<u32>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep -f 进行模糊匹配
        let output = tokio::process::Command::new("pgrep")
            .arg("-f")
            .arg(process_prefix)
            .output()
            .await
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
        // Windows: 使用 tasklist 然后过滤
        let output = tokio::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter(|line| line.to_lowercase().contains(&process_prefix.to_lowercase()))
                .filter_map(|line| {
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

/// 终止指定名称的所有进程
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `Result<u32, String>` - 成功返回终止的进程数量
pub async fn kill_processes_by_name(process_name: &str) -> Result<u32, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pkill -x 精确匹配并终止进程
        let success = run_command_with_timeout("pkill", &["-x", process_name], 5).await;

        // pkill 返回 0 表示至少终止了一个进程
        if success {
            // 获取实际终止的数量
            if find_processes_by_name(process_name).await.is_some() {
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

        let success = run_command_with_timeout("taskkill", &["/F", "/IM", &exe_name], 5).await;

        if success {
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
    /// 可执行文件完整路径
    pub bin_path: String,
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
            bin_path: "nuwax-file-server".to_string(),
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
            server_port: 60003,
            client_key: "test_key".to_string(),
        }
    }
}

/// 服务管理器
#[derive(Clone)]
pub struct ServiceManager {
    /// nuwax-file-server 进程（统一使用 process_wrap）
    nuwax_file_server: Arc<Mutex<Option<ChildWrapperType>>>,
    /// nuwax-file-server 配置
    config: Arc<NuwaxFileServerConfig>,
    /// nuwax-lanproxy 进程（使用 process_wrap 进程组）
    lanproxy: Arc<Mutex<Option<ChildWrapperType>>>,
    /// nuwax-lanproxy 配置
    lanproxy_config: Arc<NuwaxLanproxyConfig>,
    /// Rcoder Agent Runner
    rcoder: Arc<Mutex<Option<Arc<RcoderAgentRunner>>>>,
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
            rcoder: Arc::new(Mutex::new(None)),
        }
    }

    /// 启动 nuwax-file-server（使用内部配置）
    ///
    /// 使用 ServiceManager 初始化时的配置启动文件服务
    pub async fn file_server_start(&self) -> Result<(), String> {
        // 委托给核心方法，使用内部配置（需要解引用 Arc）
        self.file_server_start_with_config((*self.config).clone())
            .await
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
        // 基于内部配置创建新配置，仅修改端口
        let config = NuwaxFileServerConfig {
            port,
            ..(*self.config).clone()
        };
        // 委托给核心方法
        self.file_server_start_with_config(config).await
    }

    /// 使用指定配置启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入完整配置，包括 bin_path 和 port
    ///
    /// # Arguments
    /// * `config` - 文件服务配置（包含 bin_path、port 等）
    pub async fn file_server_start_with_config(
        &self,
        config: NuwaxFileServerConfig,
    ) -> Result<(), String> {
        info!("[FileServer] ========== 启动文件服务 ==========");

        // 检测并清理残留进程（传入正确的 bin_path）
        kill_stale_file_server_processes(&config.bin_path).await;

        info!("[FileServer] 可执行文件路径: {}", config.bin_path);
        info!("[FileServer] 端口: {}", config.port);

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
            cmd.arg("start")
                .arg("--env")
                .arg(&config.env)
                .arg("--port")
                .arg(config.port.to_string())
                // 通过命令行参数传递配置 (--KEY=VALUE 格式，loadEnvFromArgv 要求 -- 前缀)
                .arg(format!("--INIT_PROJECT_NAME={}", &config.init_project_name))
                .arg(format!("--INIT_PROJECT_DIR={}", &config.init_project_dir))
                .arg(format!(
                    "--UPLOAD_PROJECT_DIR={}",
                    &config.upload_project_dir
                ))
                .arg(format!(
                    "--PROJECT_SOURCE_DIR={}",
                    &config.project_source_dir
                ))
                .arg(format!("--DIST_TARGET_DIR={}", &config.dist_target_dir))
                .arg(format!("--LOG_BASE_DIR={}", &config.log_base_dir))
                .arg(format!(
                    "--COMPUTER_WORKSPACE_DIR={}",
                    &config.computer_workspace_dir
                ))
                .arg(format!("--COMPUTER_LOG_DIR={}", &config.computer_log_dir));
        });

        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::ProcessGroup::leader())
            .spawn()
            .map_err(|e| {
                error!("[FileServer] 启动失败: {}", e);
                format!("Failed to start nuwax-file-server: {}", e)
            })?;

        #[cfg(target_os = "windows")]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::JobObject)
            .spawn()
            .map_err(|e| {
                error!("[FileServer] 启动失败: {}", e);
                format!("Failed to start nuwax-file-server: {}", e)
            })?;

        {
            let mut guard = self.nuwax_file_server.lock().await;
            *guard = Some(child);
        }

        // 等待端口就绪
        if let Err(e) = wait_for_port_ready(config.port, 10).await {
            error!("[FileServer] 端口就绪检查失败: {}", e);

            // 端口检查失败，清理已存储的 child
            if let Ok(mut guard) = self.nuwax_file_server.try_lock() {
                let _ = guard.take();
            }

            // 使用 process_wrap 停止可能已启动的 daemon
            run_command_with_timeout(&config.bin_path, &["stop"], 5).await;

            return Err(e);
        }

        info!("[FileServer] 进程启动成功");
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

        // 检测并清理残留进程
        kill_stale_lanproxy_processes().await;

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
        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::ProcessGroup::leader())
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        #[cfg(target_os = "windows")]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::JobObject)
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

        // 检测并清理残留进程
        kill_stale_lanproxy_processes().await;

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
        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::ProcessGroup::leader())
            .spawn()
            .map_err(|e| {
                error!("[Lanproxy] 启动失败: {}", e);
                format!("Failed to start nuwax-lanproxy: {}", e)
            })?;

        #[cfg(target_os = "windows")]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::JobObject)
            .spawn()
            .map_err(|e| {
                error!("[Lanproxy] 启动失败: {}", e);
                format!("Failed to start nuwax-lanproxy: {}", e)
            })?;

        {
            let mut guard = self.lanproxy.lock().await;
            *guard = Some(child);
        }

        // 等待进程初始化（lanproxy 是客户端，无本地端口可检查）
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 检查进程是否还在运行（未立即退出）
        {
            let guard = self.lanproxy.lock().await;
            if let Some(ref child) = *guard {
                if child.id().is_none() {
                    drop(guard);
                    // 清理已存储的 child
                    if let Ok(mut guard) = self.lanproxy.try_lock() {
                        let _ = guard.take();
                    }
                    return Err("[Lanproxy] 进程启动后立即退出，请检查配置".to_string());
                }
            }
        }

        info!("[Lanproxy] 进程启动成功");
        Ok(())
    }

    /// 启动 Rcoder Agent Runner
    ///
    /// 接受外部创建的 RcoderAgentRunner 实例
    /// 如果已有运行中的实例，先停止再替换
    pub async fn rcoder_start(
        &self,
        port: u16,
        agent_runner: Arc<RcoderAgentRunner>,
    ) -> Result<(), String> {
        info!("[Rcoder] 正在启动 Agent Runner (port={})...", port);

        let mut guard = self.rcoder.lock().await;

        // 如果已有 runner，确保停止后再替换
        if let Some(ref old_runner) = *guard {
            info!("[Rcoder] 停止旧的 Agent Runner...");
            old_runner.shutdown().await;
        }

        *guard = Some(agent_runner);

        info!("[Rcoder] Agent Runner 已启动");
        Ok(())
    }

    /// 停止 Rcoder Agent Runner
    pub async fn rcoder_stop(&self) -> Result<(), String> {
        info!("[Rcoder] 正在停止 Agent Runner...");

        let mut guard = self.rcoder.lock().await;
        if let Some(ref runner) = *guard {
            runner.shutdown().await;
            info!("[Rcoder] Agent Runner 已停止");
        } else {
            info!("[Rcoder] Agent Runner 未运行");
        }
        *guard = None;

        Ok(())
    }

    /// 重启 Rcoder Agent Runner
    pub async fn rcoder_restart(&self, config: RcoderAgentRunnerConfig) -> Result<(), String> {
        info!("[Rcoder] 正在重启 Agent Runner...");

        let mut guard = self.rcoder.lock().await;

        // 先停止旧的
        if let Some(ref old_runner) = *guard {
            old_runner.shutdown().await;
        }

        // 创建并启动新的
        let mut runner = RcoderAgentRunner::new(config);
        runner.start().await?;
        *guard = Some(Arc::new(runner));

        info!("[Rcoder] Agent Runner 重启完成");
        Ok(())
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
        rcoder_config: RcoderAgentRunnerConfig,
    ) -> Result<(), String> {
        info!("Restarting all services...");

        self.services_stop_all().await?;

        let mut runner = RcoderAgentRunner::new(rcoder_config);
        runner.start().await?;
        let agent_runner = Arc::new(runner);
        self.rcoder_start(0, agent_runner).await?;
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

        // Rcoder Agent Runner 状态
        {
            let guard = self.rcoder.lock().await;
            let state = if let Some(ref runner) = *guard {
                if runner.is_running() {
                    ServiceState::Running
                } else {
                    ServiceState::Stopped
                }
            } else {
                ServiceState::Stopped
            };
            statuses.push(ServiceInfo {
                service_type: ServiceType::Rcoder,
                state,
                pid: None,
            });
            debug!(
                "[Services] Agent 服务状态: {:?}",
                statuses.last().unwrap().state
            );
        }

        statuses
    }
}
