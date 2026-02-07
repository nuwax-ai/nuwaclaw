//! npm 工具安装器
//!
//! 管理 npm 工具的本地安装（opencode, claude-code 等）
//! 所有安装都使用 --prefix 到应用本地目录，不使用全局 -g

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};
use which;

use super::detector::{InstallerError, ToolInfo, ToolInstaller};

/// npm 工具错误
#[derive(Error, Debug)]
pub enum NpmToolError {
    #[error("npm 未找到")]
    NpmNotFound,
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("命令执行失败: {0}")]
    CommandFailed(String),
}

/// npm 工具信息（向后兼容）
#[derive(Debug, Clone)]
pub struct NpmToolInfo {
    /// 工具名称
    pub name: String,
    /// 版本
    pub version: Option<String>,
    /// 是否已安装
    pub installed: bool,
}

impl From<NpmToolInfo> for ToolInfo {
    fn from(info: NpmToolInfo) -> Self {
        ToolInfo {
            name: info.name,
            version: info.version,
            installed: info.installed,
        }
    }
}

impl From<ToolInfo> for NpmToolInfo {
    fn from(info: ToolInfo) -> Self {
        NpmToolInfo {
            name: info.name,
            version: info.version,
            installed: info.installed,
        }
    }
}

/// npm 工具安装器
pub struct NpmToolInstaller {
    /// node 可执行文件路径
    node_path: Option<PathBuf>,
}

impl NpmToolInstaller {
    /// 创建新的安装器
    pub fn new(node_path: Option<PathBuf>) -> Self {
        Self { node_path }
    }

    /// 检测可执行文件是否在 PATH 中（使用 NUWAX_LOCAL_PATH_ENV）
    fn detect_in_path(executable: &str) -> bool {
        if let Ok(local_path) = std::env::var("NUWAX_LOCAL_PATH_ENV") {
            let found = which::which_in(executable, Some(&local_path), ".");
            match &found {
                Ok(path) => info!(
                    "[NpmToolInstaller] detect_in_path '{}' => 本地PATH命中: {}",
                    executable,
                    path.display()
                ),
                Err(_) => info!(
                    "[NpmToolInstaller] detect_in_path '{}' => 本地PATH未找到",
                    executable
                ),
            }
            found.is_ok()
        } else {
            let found = which::which(executable);
            match &found {
                Ok(path) => info!("[NpmToolInstaller] detect_in_path '{}' => 系统PATH命中: {} (NUWAX_LOCAL_PATH_ENV 未设置)", executable, path.display()),
                Err(_) => info!("[NpmToolInstaller] detect_in_path '{}' => 系统PATH未找到 (NUWAX_LOCAL_PATH_ENV 未设置)", executable),
            }
            found.is_ok()
        }
    }

    /// 检测 Homebrew 安装的工具 (macOS)
    fn detect_brew_tool(executable: &str) -> bool {
        if cfg!(target_os = "macos") {
            // 方式 1: 直接检测可执行文件
            if Self::detect_in_path(executable) {
                return true;
            }

            // 方式 2: 使用 brew --prefix 检测
            let output = Command::new("brew").args(["--prefix", executable]).output();

            match output {
                Ok(output) if output.status.success() => {
                    let prefix = String::from_utf8_lossy(&output.stdout);
                    !prefix.trim().is_empty()
                        && std::path::Path::new(prefix.trim().trim_end_matches('/')).exists()
                }
                _ => false,
            }
        } else {
            Self::detect_in_path(executable)
        }
    }

    /// 检测 Claude Code 安装（支持多种安装方式）
    fn detect_claude_code(&self) -> Result<NpmToolInfo, NpmToolError> {
        // 方式 1: 检测 claude CLI (Homebrew 或手动安装)
        if Self::detect_brew_tool("claude") {
            let version = self.get_claude_version();
            return Ok(NpmToolInfo {
                name: "@anthropic-ai/claude-code".to_string(),
                version,
                installed: true,
            });
        }

        // 方式 2: 检测本地安装
        if let Ok(info) = self.check_npm_local("@anthropic-ai/claude-code") {
            return Ok(info);
        }

        // 方式 3: 检测手动安装路径 (macOS)
        if cfg!(target_os = "macos") {
            let home = std::env::var("HOME").unwrap_or_default();
            let app_path = format!("{}/Applications/Claude.app", home);
            if std::path::Path::new(&app_path).exists() {
                return Ok(NpmToolInfo {
                    name: "@anthropic-ai/claude-code".to_string(),
                    version: None,
                    installed: true,
                });
            }
        }

        Ok(NpmToolInfo {
            name: "@anthropic-ai/claude-code".to_string(),
            version: None,
            installed: false,
        })
    }

    /// 获取 Claude CLI 版本
    fn get_claude_version(&self) -> Option<String> {
        let output = Command::new("claude").args(["--version"]).output();

        match output {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout);
                Some(version.trim().to_string())
            }
            _ => None,
        }
    }

    /// 检测 OpenCode 安装（支持多种安装方式）
    fn detect_opencode(&self) -> Result<NpmToolInfo, NpmToolError> {
        // 方式 1: 检测 opencode CLI (Homebrew)
        if Self::detect_brew_tool("opencode") {
            return Ok(NpmToolInfo {
                name: "opencode".to_string(),
                version: None,
                installed: true,
            });
        }

        // 方式 2: 检测本地安装
        self.check_npm_local("opencode")
    }

    /// 检测本地安装的工具（使用 --prefix）
    fn check_npm_local(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let mut cmd = self.npm_command();

        let mut args: Vec<String> = vec![
            "list".to_string(),
            "--depth=0".to_string(),
            "--json".to_string(),
        ];
        if let Some(prefix) = Self::get_local_prefix() {
            info!(
                "[NpmToolInstaller] check_npm_local '{}' 使用 --prefix {}",
                tool_name, prefix
            );
            args.push("--prefix".to_string());
            args.push(prefix);
        } else {
            warn!("[NpmToolInstaller] check_npm_local '{}' NUWAX_LOCAL_NPM_PREFIX 未设置，将检查默认位置", tool_name);
        }
        args.push(tool_name.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = cmd
            .args(&args_ref)
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.contains(tool_name) {
            let version = self.get_tool_version(tool_name).ok();
            Ok(NpmToolInfo {
                name: tool_name.to_string(),
                version,
                installed: true,
            })
        } else {
            Ok(NpmToolInfo {
                name: tool_name.to_string(),
                version: None,
                installed: false,
            })
        }
    }

    /// 获取 npm 路径（优先使用打包的 npm）
    fn get_npm_path(&self) -> PathBuf {
        // 1. 优先使用打包的 npm
        if let Ok(bundled) = std::env::var("NUWAX_BUNDLED_NPM_PATH") {
            let p = PathBuf::from(&bundled);
            if p.exists() {
                info!("[NpmToolInstaller] 使用打包的 npm: {}", p.display());
                return p;
            }
            warn!(
                "[NpmToolInstaller] NUWAX_BUNDLED_NPM_PATH={} 但文件不存在，回退",
                bundled
            );
        }
        // 2. 使用 node_path 推导
        if let Some(ref node_path) = self.node_path {
            let parent = node_path.parent().unwrap_or(node_path.as_path());
            #[cfg(unix)]
            let npm = { parent.join("npm") };
            #[cfg(windows)]
            let npm = { parent.join("npm.cmd") };
            info!(
                "[NpmToolInstaller] 使用 node_path 推导的 npm: {}",
                npm.display()
            );
            return npm;
        }
        #[cfg(unix)]
        let fallback = { PathBuf::from("npm") };
        #[cfg(windows)]
        let fallback = { PathBuf::from("npm.cmd") };
        warn!("[NpmToolInstaller] 回退到系统 npm: {}", fallback.display());
        fallback
    }

    /// 创建注入了本地 PATH 和 npm 缓存目录的 Command
    fn npm_command(&self) -> Command {
        let npm_path = self.get_npm_path();
        let mut cmd = Command::new(&npm_path);
        if let Ok(local_path) = std::env::var("NUWAX_LOCAL_PATH_ENV") {
            info!("[NpmToolInstaller] npm_command 注入 PATH (本地)");
            cmd.env("PATH", &local_path);
        } else {
            warn!("[NpmToolInstaller] npm_command NUWAX_LOCAL_PATH_ENV 未设置，使用系统PATH");
        }
        if let Ok(npm_cache) = std::env::var("NUWAX_NPM_CACHE_DIR") {
            info!(
                "[NpmToolInstaller] npm_command 注入 NPM_CONFIG_CACHE={}",
                npm_cache
            );
            cmd.env("NPM_CONFIG_CACHE", &npm_cache);
        }
        cmd
    }

    /// 获取本地 npm prefix 目录
    fn get_local_prefix() -> Option<String> {
        std::env::var("NUWAX_LOCAL_NPM_PREFIX").ok()
    }

    /// 检查工具是否已安装（返回 NpmToolInfo，向后兼容）
    pub fn check_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        self.check_npm_local(tool_name)
    }

    /// 获取工具版本
    fn get_tool_version(&self, tool_name: &str) -> Result<String, NpmToolError> {
        let mut cmd = self.npm_command();

        let mut args: Vec<String> = vec!["list".to_string(), "--depth=0".to_string()];
        if let Some(prefix) = Self::get_local_prefix() {
            args.push("--prefix".to_string());
            args.push(prefix);
        }
        args.push(tool_name.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = cmd
            .args(&args_ref)
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 解析版本，格式如：└── tool@1.0.0
        for line in stdout.lines() {
            if line.contains(tool_name) {
                if let Some(version_part) = line.split('@').next_back() {
                    return Ok(version_part.trim().to_string());
                }
            }
        }

        Err(NpmToolError::CommandFailed("Version not found".to_string()))
    }

    /// 检测工具（支持多种安装方式）
    ///
    /// 优先使用本地安装检测，失败后回退到 CLI 命令检测
    pub fn check_tool_with_fallback(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        // 特殊处理 Claude Code 和 OpenCode（支持多种安装方式）
        match tool_name {
            "@anthropic-ai/claude-code" => return self.detect_claude_code(),
            "opencode" => return self.detect_opencode(),
            _ => {
                // 首先尝试本地安装检测
                if let Ok(info) = self.check_npm_local(tool_name) {
                    if info.installed {
                        return Ok(info);
                    }
                }

                // 其他工具不支持回退检测
                Ok(NpmToolInfo {
                    name: tool_name.to_string(),
                    version: None,
                    installed: false,
                })
            }
        }
    }

    /// 安装工具到本地目录（使用 --prefix）
    pub fn install_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let prefix = Self::get_local_prefix().ok_or_else(|| {
            NpmToolError::InstallFailed("NUWAX_LOCAL_NPM_PREFIX not set".to_string())
        })?;

        info!(
            "Installing npm tool locally: {} (prefix: {})",
            tool_name, prefix
        );

        let mut cmd = self.npm_command();
        let output = cmd
            .args(["install", "--prefix", &prefix, tool_name])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("Failed to install {}: {}", tool_name, stderr);
            return Err(NpmToolError::InstallFailed(stderr.to_string()));
        }

        info!("Successfully installed: {}", tool_name);

        // 返回安装后的信息
        self.check_tool(tool_name)
    }

    /// 卸载工具（从本地目录）
    pub fn uninstall_tool(&self, tool_name: &str) -> Result<(), NpmToolError> {
        let prefix = Self::get_local_prefix().ok_or_else(|| {
            NpmToolError::InstallFailed("NUWAX_LOCAL_NPM_PREFIX not set".to_string())
        })?;

        info!("Uninstalling npm tool: {} (prefix: {})", tool_name, prefix);

        let mut cmd = self.npm_command();
        let output = cmd
            .args(["uninstall", "--prefix", &prefix, tool_name])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(NpmToolError::InstallFailed(stderr.to_string()));
        }

        Ok(())
    }

    /// 更新工具到最新版本（本地安装）
    pub fn update_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let prefix = Self::get_local_prefix().ok_or_else(|| {
            NpmToolError::InstallFailed("NUWAX_LOCAL_NPM_PREFIX not set".to_string())
        })?;

        info!("Updating npm tool: {} (prefix: {})", tool_name, prefix);

        let package_spec = format!("{}@latest", tool_name);
        let mut cmd = self.npm_command();
        let output = cmd
            .args(["install", "--prefix", &prefix, &package_spec])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(NpmToolError::InstallFailed(stderr.to_string()));
        }

        // 返回更新后的信息
        self.check_tool(tool_name)
    }
}

impl Default for NpmToolInstaller {
    fn default() -> Self {
        Self::new(None)
    }
}

// ============================================================================
// ToolInstaller trait implementation
// ============================================================================

impl ToolInstaller for NpmToolInstaller {
    fn check_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
        NpmToolInstaller::check_tool(self, name)
            .map(|info| info.into())
            .map_err(|e| match e {
                NpmToolError::NpmNotFound => InstallerError::NotFound("npm".to_string()),
                NpmToolError::InstallFailed(msg) => InstallerError::InstallFailed(msg),
                NpmToolError::CommandFailed(msg) => InstallerError::CommandFailed(msg),
            })
    }

    fn install_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
        NpmToolInstaller::install_tool(self, name)
            .map(|info| info.into())
            .map_err(|e| match e {
                NpmToolError::NpmNotFound => InstallerError::NotFound("npm".to_string()),
                NpmToolError::InstallFailed(msg) => InstallerError::InstallFailed(msg),
                NpmToolError::CommandFailed(msg) => InstallerError::CommandFailed(msg),
            })
    }

    fn uninstall_tool(&self, name: &str) -> Result<(), InstallerError> {
        NpmToolInstaller::uninstall_tool(self, name).map_err(|e| match e {
            NpmToolError::NpmNotFound => InstallerError::NotFound("npm".to_string()),
            NpmToolError::InstallFailed(msg) => InstallerError::InstallFailed(msg),
            NpmToolError::CommandFailed(msg) => InstallerError::CommandFailed(msg),
        })
    }

    fn update_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
        NpmToolInstaller::update_tool(self, name)
            .map(|info| info.into())
            .map_err(|e| match e {
                NpmToolError::NpmNotFound => InstallerError::NotFound("npm".to_string()),
                NpmToolError::InstallFailed(msg) => InstallerError::InstallFailed(msg),
                NpmToolError::CommandFailed(msg) => InstallerError::CommandFailed(msg),
            })
    }

    fn check_tool_with_fallback(&self, name: &str) -> Result<ToolInfo, InstallerError> {
        NpmToolInstaller::check_tool_with_fallback(self, name)
            .map(|info| info.into())
            .map_err(|e| match e {
                NpmToolError::NpmNotFound => InstallerError::NotFound("npm".to_string()),
                NpmToolError::InstallFailed(msg) => InstallerError::InstallFailed(msg),
                NpmToolError::CommandFailed(msg) => InstallerError::CommandFailed(msg),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_npm_tool_installer_creation() {
        let installer = NpmToolInstaller::new(None);
        // 只测试创建
        assert!(installer.node_path.is_none());
    }

    #[test]
    fn test_tool_info_conversion() {
        let npm_info = NpmToolInfo {
            name: "test".to_string(),
            version: Some("1.0.0".to_string()),
            installed: true,
        };

        let tool_info: ToolInfo = npm_info.into();
        assert_eq!(tool_info.name, "test");
        assert_eq!(tool_info.version, Some("1.0.0".to_string()));
        assert!(tool_info.installed);
    }
}
