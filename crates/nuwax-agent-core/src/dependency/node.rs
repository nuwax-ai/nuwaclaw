//! Node.js 检测和安装
//!
//! 检测系统中已安装的 Node.js，支持自动下载安装

use semver::Version;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// Node.js 最低要求版本
pub const MIN_NODE_VERSION: &str = "22.0.0";

/// Node.js 信息
#[derive(Debug, Clone)]
pub struct NodeInfo {
    /// 版本
    pub version: String,
    /// 安装路径
    pub path: PathBuf,
    /// 来源（系统/客户端目录）
    pub source: NodeSource,
}

/// Node.js 来源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeSource {
    /// 系统全局安装
    System,
    /// 客户端目录安装
    Local,
}

/// Node.js 错误
#[derive(Error, Debug)]
pub enum NodeError {
    #[error("Node.js 未找到")]
    NotFound,
    #[error("版本过低: 需要 >= {min}, 实际 {actual}")]
    VersionTooLow { min: String, actual: String },
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// Node.js 检测器
pub struct NodeDetector {
    /// 最低版本要求
    min_version: Version,
}

impl Default for NodeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeDetector {
    /// 创建新的检测器
    pub fn new() -> Self {
        Self {
            min_version: Version::parse(MIN_NODE_VERSION).unwrap(),
        }
    }

    /// 从 PATH 检测
    fn detect_from_path(&self) -> Result<NodeInfo, NodeError> {
        let output = Command::new("node")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| NodeError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(NodeError::NotFound);
        }

        let version = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string();

        // 获取路径
        let path = self.get_node_path()?;

        info!("Found Node.js in PATH: v{} at {:?}", version, path);

        Ok(NodeInfo {
            version,
            path,
            source: NodeSource::System,
        })
    }

    /// 获取 node 可执行文件路径
    fn get_node_path(&self) -> Result<PathBuf, NodeError> {
        #[cfg(unix)]
        {
            let output = Command::new("which")
                .no_window()
                .arg("node")
                .output()
                .map_err(|e| NodeError::CommandFailed(e.to_string()))?;

            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(PathBuf::from(path));
            }
        }

        #[cfg(windows)]
        {
            let output = Command::new("where")
                .no_window()
                .arg("node")
                .output()
                .map_err(|e| NodeError::CommandFailed(e.to_string()))?;

            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                return Ok(PathBuf::from(path));
            }
        }

        Err(NodeError::NotFound)
    }

    /// 检测 macOS 特定路径
    #[cfg(target_os = "macos")]
    fn detect_macos_paths(&self) -> Result<NodeInfo, NodeError> {
        let paths = vec![
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/opt/local/bin/node",
        ];

        for path in paths {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Node.js at {}: v{}", path, version);
                    return Ok(NodeInfo {
                        version,
                        path: path_buf,
                        source: NodeSource::System,
                    });
                }
            }
        }

        Err(NodeError::NotFound)
    }

    /// 检测 Windows 特定路径
    #[cfg(target_os = "windows")]
    fn detect_windows_paths(&self) -> Result<NodeInfo, NodeError> {
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        let paths = vec![
            format!("{}\\nodejs\\node.exe", program_files),
            format!("{}\\nodejs\\node.exe", program_files_x86),
        ];

        for path in paths {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Node.js at {}: v{}", path, version);
                    return Ok(NodeInfo {
                        version,
                        path: path_buf,
                        source: NodeSource::System,
                    });
                }
            }
        }

        Err(NodeError::NotFound)
    }

    /// 检测客户端目录安装
    fn detect_local(&self) -> Result<NodeInfo, NodeError> {
        let local_path = Self::get_local_node_path();

        if local_path.exists() {
            let version = self.get_version_from_path(&local_path)?;
            info!("Found local Node.js: v{} at {:?}", version, local_path);
            return Ok(NodeInfo {
                version,
                path: local_path,
                source: NodeSource::Local,
            });
        }

        Err(NodeError::NotFound)
    }

    /// 从路径获取版本
    fn get_version_from_path(&self, path: &PathBuf) -> Result<String, NodeError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| NodeError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(NodeError::CommandFailed(
                "node --version failed".to_string(),
            ));
        }

        let version = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string();

        Ok(version)
    }

    /// 检查版本是否满足要求
    fn check_version(&self, version: &str) -> Result<bool, NodeError> {
        let parsed =
            Version::parse(version).map_err(|_| NodeError::ParseError(version.to_string()))?;

        if parsed < self.min_version {
            warn!(
                "Node.js version {} is below minimum required {}",
                version, MIN_NODE_VERSION
            );
            return Ok(false);
        }

        Ok(true)
    }

    /// 获取客户端安装的 node 路径（~/.local/bin/node）
    pub fn get_local_node_path() -> PathBuf {
        let home_local = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local");

        #[cfg(unix)]
        {
            home_local.join("bin").join("node")
        }

        #[cfg(windows)]
        {
            home_local.join("bin").join("node.exe")
        }
    }
}

// ============================================================================
// DependencyDetector trait implementation
// ============================================================================

impl DependencyDetector for NodeDetector {
    fn name(&self) -> &str {
        "nodejs"
    }

    fn display_name(&self) -> &str {
        "Node.js"
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_node() {
            Ok(info) => {
                let source = match info.source {
                    NodeSource::System => "system",
                    NodeSource::Local => "local",
                };
                Ok(DetectionResult::found(info.version, info.path, source))
            }
            // NotFound 不是错误，而是"未找到"的正常结果
            Err(NodeError::NotFound) => Ok(DetectionResult::not_found()),
            // 版本过低是检测器层面的错误
            Err(NodeError::VersionTooLow { min, actual }) => {
                Err(DetectorError::VersionTooLow { min, actual })
            }
            // 命令执行和解析错误直接转换
            Err(NodeError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(NodeError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
            // 其他错误（DownloadFailed, InstallFailed, IoError）统一转为 IoError
            // 这些错误在检测阶段不应该发生，如果发生则视为 IO 问题
            Err(e) => Err(DetectorError::IoError(e.to_string())),
        }
    }

    fn is_required(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "JavaScript 运行时"
    }
}

impl NodeDetector {
    /// 内部检测方法，返回 NodeInfo（供 trait 实现使用）
    fn detect_node(&self) -> Result<NodeInfo, NodeError> {
        // 复用原有的 detect 逻辑，但重命名以避免与 trait 方法冲突
        // 1. 检测 PATH 中的 node
        if let Ok(info) = self.detect_from_path() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 2. 检测平台特定路径
        #[cfg(target_os = "macos")]
        if let Ok(info) = self.detect_macos_paths() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        #[cfg(target_os = "windows")]
        if let Ok(info) = self.detect_windows_paths() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 3. 检测客户端目录
        if let Ok(info) = self.detect_local() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        Err(NodeError::NotFound)
    }

    /// 获取 NodeInfo（便捷方法，供需要完整信息的调用方使用）
    pub fn detect_with_info(&self) -> Result<NodeInfo, NodeError> {
        self.detect_node()
    }
}

/// Node.js 安装器
pub struct NodeInstaller {
    /// 目标目录（~/.local/）
    target_dir: PathBuf,
}

impl NodeInstaller {
    /// 创建新的安装器
    pub fn new() -> Self {
        let target_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local");

        Self { target_dir }
    }

    /// 使用自定义目标目录创建安装器
    pub fn with_target_dir(target_dir: PathBuf) -> Self {
        Self { target_dir }
    }

    fn read_version_from_path(path: &PathBuf) -> Result<String, NodeError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| NodeError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(NodeError::CommandFailed(
                "node --version failed".to_string(),
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string())
    }

    /// 验证打包的 Node.js 资源存在并返回信息
    ///
    /// 新架构：不再复制到 ~/.local/，直接验证打包资源
    /// 优势：保持 macOS 代码签名，避免 V8 SIGTRAP 崩溃
    ///
    /// - 验证 node 二进制存在
    /// - 返回 Node.js 信息（版本、路径）
    pub fn install_from_bundled(&self, bundled_node_dir: &PathBuf) -> Result<NodeInfo, NodeError> {
        info!(
            "[NodeInstaller] 验证打包的 Node.js 资源: {:?}",
            bundled_node_dir
        );

        // 验证打包资源目录存在
        if !bundled_node_dir.exists() {
            return Err(NodeError::InstallFailed(format!(
                "打包的 Node.js 资源目录不存在: {:?}",
                bundled_node_dir
            )));
        }

        // 验证 bin/node 存在
        #[cfg(unix)]
        let bundled_node_bin = bundled_node_dir.join("bin").join("node");
        #[cfg(windows)]
        let bundled_node_bin = bundled_node_dir.join("bin").join("node.exe");

        if !bundled_node_bin.exists() {
            return Err(NodeError::InstallFailed(format!(
                "打包的 Node.js 二进制文件不存在: {:?}",
                bundled_node_bin
            )));
        }

        // 获取版本信息
        let version = Self::read_version_from_path(&bundled_node_bin)?;

        info!(
            "[NodeInstaller] Node.js 资源验证通过: v{} at {:?}",
            version, bundled_node_bin
        );

        // 写入本地 env 脚本（用于终端环境）
        if let Err(e) = crate::utils::ensure_local_bin_env() {
            warn!("写入本地 env 脚本失败（不影响使用）: {}", e);
        }

        Ok(NodeInfo {
            version,
            path: bundled_node_bin,
            source: NodeSource::Local,
        })
    }

    /// 获取下载 URL
    /// 使用国内 npmmirror 镜像（https://npmmirror.com/mirrors/node），便于国内环境下载
    fn get_download_url(&self) -> String {
        let version = "22.14.0"; // LTS 版本
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        let platform = match os {
            "macos" => "darwin",
            "windows" => "win",
            "linux" => "linux",
            _ => "linux",
        };

        let arch_str = match arch {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            _ => "x64",
        };

        let ext = if os == "windows" { "zip" } else { "tar.gz" };

        format!(
            "https://npmmirror.com/mirrors/node/v{}/node-v{}-{}-{}.{}",
            version, version, platform, arch_str, ext
        )
    }

    /// 安装 Node.js
    #[cfg(feature = "dependency-management")]
    pub async fn install(
        &self,
        progress_callback: impl Fn(f32, &str),
    ) -> Result<NodeInfo, NodeError> {
        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;

        let url = self.get_download_url();
        info!("Downloading Node.js from: {}", url);
        progress_callback(0.0, "开始下载 Node.js...");

        // 创建目标目录
        tokio::fs::create_dir_all(&self.target_dir)
            .await
            .map_err(NodeError::IoError)?;

        // 下载
        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| NodeError::DownloadFailed(e.to_string()))?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded = 0u64;

        let temp_file = self.target_dir.join("node_download.tmp");
        let mut file = tokio::fs::File::create(&temp_file)
            .await
            .map_err(NodeError::IoError)?;

        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| NodeError::DownloadFailed(e.to_string()))?;
            file.write_all(&chunk).await.map_err(NodeError::IoError)?;
            downloaded += chunk.len() as u64;

            if total_size > 0 {
                let progress = (downloaded as f32 / total_size as f32) * 0.5;
                progress_callback(
                    progress,
                    &format!("下载中... {}%", (progress * 200.0) as u32),
                );
            }
        }

        file.flush().await.map_err(NodeError::IoError)?;
        drop(file);

        progress_callback(0.5, "解压中...");

        // 解压
        self.extract(&temp_file).await?;

        // 清理临时文件
        let _ = tokio::fs::remove_file(&temp_file).await;

        progress_callback(0.9, "设置权限...");

        // 设置可执行权限
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let node_path = NodeDetector::get_local_node_path();
            if node_path.exists() {
                let mut perms = std::fs::metadata(&node_path)?.permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&node_path, perms)?;
            }
        }

        progress_callback(1.0, "安装完成");

        // 验证安装
        let detector = NodeDetector::new();
        detector.detect_local()
    }

    /// 解压文件
    #[cfg(feature = "dependency-management")]
    async fn extract(&self, archive_path: &Path) -> Result<(), NodeError> {
        let archive_path = archive_path.to_path_buf();
        let target_dir = self.target_dir.clone();

        tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&archive_path)?;

            if archive_path.to_string_lossy().ends_with(".zip") {
                // ZIP 解压
                let mut archive = zip::ZipArchive::new(file)
                    .map_err(|e| NodeError::InstallFailed(e.to_string()))?;

                for i in 0..archive.len() {
                    let mut file = archive
                        .by_index(i)
                        .map_err(|e| NodeError::InstallFailed(e.to_string()))?;

                    let outpath = if let Some(name) = file.enclosed_name() {
                        // 跳过第一层目录
                        let mut components = name.components();
                        components.next();
                        target_dir.join(components.as_path())
                    } else {
                        continue;
                    };

                    if file.is_dir() {
                        std::fs::create_dir_all(&outpath)?;
                    } else {
                        if let Some(parent) = outpath.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        let mut outfile = std::fs::File::create(&outpath)?;
                        std::io::copy(&mut file, &mut outfile)?;
                    }
                }
            } else {
                // tar.gz 解压
                let decoder = flate2::read::GzDecoder::new(file);
                let mut archive = tar::Archive::new(decoder);

                for entry in archive.entries().map_err(NodeError::IoError)? {
                    let mut entry = entry.map_err(NodeError::IoError)?;
                    let path = entry.path().map_err(NodeError::IoError)?;

                    // 跳过第一层目录
                    let mut components = path.components();
                    components.next();
                    let outpath = target_dir.join(components.as_path());

                    if entry.header().entry_type().is_dir() {
                        std::fs::create_dir_all(&outpath)?;
                    } else {
                        if let Some(parent) = outpath.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        entry.unpack(&outpath).map_err(NodeError::IoError)?;
                    }
                }
            }

            Ok::<_, NodeError>(())
        })
        .await
        .map_err(|e| NodeError::InstallFailed(e.to_string()))??;

        Ok(())
    }
}

impl Default for NodeInstaller {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// npm 包路径解析工具（用于绕过 .cmd 文件直接调用 node.exe）
// ============================================================================

/// npm 全局包信息
#[derive(Debug, Clone)]
pub struct NpmPackageInfo {
    /// Node.js 可执行文件路径
    pub node_exe: PathBuf,
    /// 包的 JavaScript 入口文件
    pub js_entry: PathBuf,
    /// 包名
    pub package_name: String,
}

/// 解析 npm 全局包的实际路径
///
/// 这个函数会找到 node.exe 和包的 JavaScript 入口文件，
/// 用于绕过 .cmd 批处理文件直接启动 Node.js 进程，避免 CMD 窗口弹出
///
/// # 参数
/// - `package_name`: npm 包名（如 "mcp-stdio-proxy"）
///
/// # 返回
/// - Ok(NpmPackageInfo): 包含 node.exe 和 JS 入口文件路径
/// - Err(NodeError): 未找到或解析失败
pub fn resolve_npm_package_direct_path(package_name: &str) -> Result<NpmPackageInfo, NodeError> {
    // 1. 找到 node.exe
    let node_exe = find_node_executable()?;

    // 2. 找到包的安装位置
    let package_dir = find_npm_package_dir(package_name)?;

    // 3. 读取 package.json 找到入口文件
    let js_entry = find_package_entry(&package_dir)?;

    info!(
        "Resolved npm package '{}': node={}, entry={}",
        package_name,
        node_exe.display(),
        js_entry.display()
    );

    Ok(NpmPackageInfo {
        node_exe,
        js_entry,
        package_name: package_name.to_string(),
    })
}

/// 查找 node.exe 可执行文件
fn find_node_executable() -> Result<PathBuf, NodeError> {
    // 允许上层（Tauri sidecar）通过环境变量注入固定 node.exe，避免依赖系统 PATH。
    if let Ok(node_from_env) = std::env::var("NUWAX_NODE_EXE") {
        let node_from_env = PathBuf::from(node_from_env);
        if node_from_env.exists() {
            debug!(
                "Using node from NUWAX_NODE_EXE: {}",
                node_from_env.display()
            );
            return Ok(node_from_env);
        }
    }

    // 优先使用本地安装的 Node.js
    let local_node = NodeDetector::get_local_node_path();
    if local_node.exists() {
        debug!("Using local node: {}", local_node.display());
        return Ok(local_node);
    }

    // 使用系统 PATH 中的 node
    #[cfg(windows)]
    let node_cmd = "node.exe";
    #[cfg(not(windows))]
    let node_cmd = "node";

    #[cfg(windows)]
    {
        let output = Command::new("where")
            .no_window()
            .arg(node_cmd)
            .output()
            .map_err(|e| NodeError::CommandFailed(format!("where node failed: {}", e)))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .ok_or(NodeError::NotFound)?
                .trim()
                .to_string();
            return Ok(PathBuf::from(path));
        }
    }

    #[cfg(unix)]
    {
        let output = Command::new("which")
            .no_window()
            .arg(node_cmd)
            .output()
            .map_err(|e| NodeError::CommandFailed(format!("which node failed: {}", e)))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok(PathBuf::from(path));
        }
    }

    Err(NodeError::NotFound)
}

/// 查找 npm 全局包的安装目录
fn find_npm_package_dir(package_name: &str) -> Result<PathBuf, NodeError> {
    // 尝试本地 ~/.local/lib/node_modules（兼容旧路径 ~/.local/bin/node_modules）
    let home_local = dirs::home_dir()
        .ok_or(NodeError::NotFound)?
        .join(".local");
    let local_candidates = [
        home_local.join("lib").join("node_modules").join(package_name),
        home_local.join("bin").join("node_modules").join(package_name),
    ];

    for local_modules in local_candidates {
        if local_modules.exists() {
            debug!("Found package in local: {}", local_modules.display());
            return Ok(local_modules);
        }
    }

    // Windows: %APPDATA%\npm\node_modules
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let app_private_modules = PathBuf::from(&appdata)
                .join("com.nuwax.agent-tauri-client")
                .join("node_modules")
                .join(package_name);
            if app_private_modules.exists() {
                debug!(
                    "Found package in app private node_modules: {}",
                    app_private_modules.display()
                );
                return Ok(app_private_modules);
            }

            let npm_modules = PathBuf::from(appdata)
                .join("npm")
                .join("node_modules")
                .join(package_name);

            if npm_modules.exists() {
                debug!("Found package in APPDATA: {}", npm_modules.display());
                return Ok(npm_modules);
            }
        }
    }

    // Unix: 全局 node_modules
    #[cfg(unix)]
    {
        let global_paths = vec![
            format!("/usr/local/lib/node_modules/{}", package_name),
            format!("/opt/homebrew/lib/node_modules/{}", package_name),
        ];

        for path_str in global_paths {
            let path = PathBuf::from(&path_str);
            if path.exists() {
                debug!("Found package in global: {}", path.display());
                return Ok(path);
            }
        }
    }

    Err(NodeError::NotFound)
}

/// 从 package.json 读取入口文件
fn find_package_entry(package_dir: &Path) -> Result<PathBuf, NodeError> {
    let package_json = package_dir.join("package.json");

    if !package_json.exists() {
        return Err(NodeError::NotFound);
    }

    let content = std::fs::read_to_string(&package_json).map_err(|e| NodeError::IoError(e))?;

    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| NodeError::ParseError(format!("Invalid package.json: {}", e)))?;

    // 查找入口文件字段（按优先级）
    let entry = json
        .get("bin")
        .and_then(|bin| {
            // bin 可以是字符串或对象
            if bin.is_string() {
                bin.as_str()
            } else if bin.is_object() {
                // 如果是对象，取第一个值
                bin.as_object()
                    .and_then(|obj| obj.values().next())
                    .and_then(|v| v.as_str())
            } else {
                None
            }
        })
        .or_else(|| json.get("main").and_then(|v| v.as_str()))
        .ok_or_else(|| NodeError::ParseError("No entry point found in package.json".to_string()))?;

    let entry_path = package_dir.join(entry);

    if !entry_path.exists() {
        return Err(NodeError::NotFound);
    }

    Ok(entry_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_detector_creation() {
        let detector = NodeDetector::new();
        // 只测试创建，不依赖实际安装的 Node.js
        assert!(detector.min_version >= Version::parse("22.0.0").unwrap());
    }

    #[test]
    fn test_local_node_path() {
        let path = NodeDetector::get_local_node_path();
        assert!(path.to_string_lossy().contains(".local"));
    }
}
