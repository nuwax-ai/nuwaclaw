//! 跨平台路径抽象
//!
//! 统一处理不同平台的配置、日志、缓存路径
//!
//! # 路径规范
//!
//! | 平台 | 配置 | 日志 | 缓存 | 数据 |
//! |------|------|------|------|------|
//! | macOS | ~/Library/Application Support/nuwax-agent | 同上 | ~/Library/Caches/nuwax-agent | ~/Library/Application Support/nuwax-agent |
//! | Windows | %APPDATA%\nuwax-agent | %APPDATA%\nuwax-agent\logs | %LOCALAPPDATA%\nuwax-agent\cache | %APPDATA%\nuwax-agent |
//! | Linux | ~/.config/nuwax-agent | ~/.config/nuwax-agent/logs | ~/.cache/nuwax-agent | ~/.local/share/nuwax-agent |

use std::path::PathBuf;

/// 应用标识符
const APP_ID: &str = "nuwax-agent";

/// 路径类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathType {
    Config,      // 配置目录
    Log,         // 日志目录
    Cache,       // 缓存目录
    Data,        // 数据目录
    Runtime,     // 运行时目录
    Executable,  // 可执行文件所在目录
}

/// 路径提供者 trait
pub trait PathProvider {
    /// 获取指定类型的路径
    fn get_path(&self, path_type: PathType) -> PathBuf;

    /// 获取应用根目录
    fn app_root(&self) -> PathBuf;

    /// 检查路径是否可写
    fn is_writable(&self, path: &PathBuf) -> bool;
}

/// 平台路径配置
pub struct PlatformPaths;

impl PathProvider for PlatformPaths {
    #[inline]
    fn get_path(&self, path_type: PathType) -> PathBuf {
        match path_type {
            #[cfg(target_os = "macos")]
            PathType::Config => {
                let mut path = home::home_dir().unwrap_or_default();
                path.push("Library/Application Support/");
                path.push(APP_ID);
                path
            }

            #[cfg(target_os = "windows")]
            PathType::Config => {
                let mut path = dirs::data_dir().unwrap_or_default();
                path.push(APP_ID);
                path
            }

            #[cfg(target_os = "linux")]
            PathType::Config => {
                let mut path = xdg::BaseDirectories::with_prefix(APP_ID)
                    .unwrap_or_else(|_| xdg::BaseDirectories::new().unwrap())
                    .get_config_home();
                path
            }

            // Log paths
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            PathType::Log => {
                let mut path = self.get_path(PathType::Config);
                path.push("logs");
                path
            }

            #[cfg(target_os = "linux")]
            PathType::Log => {
                xdg::BaseDirectories::with_prefix(APP_ID)
                    .unwrap_or_else(|_| xdg::BaseDirectories::new().unwrap())
                    .get_cache_home()
                    .join("logs")
            }

            // Cache paths
            #[cfg(target_os = "macos")]
            PathType::Cache => {
                let mut path = home::home_dir().unwrap_or_default();
                path.push("Library/Caches/");
                path.push(APP_ID);
                path
            }

            #[cfg(target_os = "windows")]
            PathType::Cache => {
                let mut path = dirs::cache_dir().unwrap_or_default();
                path.push(APP_ID);
                path
            }

            #[cfg(target_os = "linux")]
            PathType::Cache => {
                xdg::BaseDirectories::with_prefix(APP_ID)
                    .unwrap_or_else(|_| xdg::BaseDirectories::new().unwrap())
                    .get_cache_home()
            }

            // Data paths
            #[cfg(target_os = "macos")]
            PathType::Data => self.get_path(PathType::Config),

            #[cfg(target_os = "windows")]
            PathType::Data => self.get_path(PathType::Config),

            #[cfg(target_os = "linux")]
            PathType::Data => {
                xdg::BaseDirectories::with_prefix(APP_ID)
                    .unwrap_or_else(|_| xdg::BaseDirectories::new().unwrap())
                    .get_data_home()
            }

            // Runtime paths
            #[cfg(target_os = "macos")]
            PathType::Runtime => {
                let mut path = home::home_dir().unwrap_or_default();
                path.push("Library/Caches/");
                path.push(APP_ID);
                path.push("runtime");
                path
            }

            #[cfg(target_os = "windows")]
            PathType::Runtime => {
                let mut path = dirs::data_dir().unwrap_or_default();
                path.push(APP_ID);
                path.push("runtime");
                path
            }

            #[cfg(target_os = "linux")]
            PathType::Runtime => {
                let mut path = xdg::BaseDirectories::with_prefix(APP_ID)
                    .unwrap_or_else(|_| xdg::BaseDirectories::new().unwrap())
                    .get_cache_home();
                path.push("runtime");
                path
            }

            // Executable path (current binary's directory)
            #[cfg(target_os = "macos")]
            PathType::Executable => {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                    .unwrap_or_else(|| {
                        let mut path = home::home_dir().unwrap_or_default();
                        path.push(".cargo/bin");
                        path
                    })
            }

            #[cfg(target_os = "windows")]
            PathType::Executable => {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                    .unwrap_or_default()
            }

            #[cfg(target_os = "linux")]
            PathType::Executable => {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                    .unwrap_or_else(|| {
                        let mut path = PathBuf::from("/usr/local/bin");
                        if !path.exists() {
                            path = PathBuf::from("/opt/nuwax/bin");
                        }
                        path
                    })
            }
        }
    }

    #[inline]
    fn app_root(&self) -> PathBuf {
        self.get_path(PathType::Config)
    }

    #[inline]
    fn is_writable(&self, path: &PathBuf) -> bool {
        std::fs::metadata(path)
            .map(|m| m.permissions().readonly())
            .unwrap_or(true) == false
    }
}

/// 获取标准路径的工具函数
#[inline]
pub fn get_path(path_type: PathType) -> PathBuf {
    PlatformPaths.get_path(path_type)
}

/// 确保目录存在（递归创建）
#[inline]
pub fn ensure_dir(path: &PathBuf) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

/// 获取日志文件路径
#[inline]
pub fn log_file_path(name: &str) -> PathBuf {
    let mut path = get_path(PathType::Log);
    ensure_dir(&path).ok();
    path.push(format!("{}.log", name));
    path
}
