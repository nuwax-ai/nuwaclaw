//! npm 工具安装器
//!
//! 管理 npm 全局工具的安装（opencode, claude-code 等）
//! 国内环境使用 npmmirror 镜像，加速安装与下载。

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};
use which::which;

use crate::utils::CommandNoWindowExt;

/// 国内 npm 镜像（npmmirror），安装/更新时使用以加速
const NPM_REGISTRY_CN: &str = "https://registry.npmmirror.com/";

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

    /// 使用 tty-which 检测可执行文件是否在 PATH 中
    fn detect_in_path(executable: &str) -> bool {
        which(executable).is_ok()
    }

    /// 检测 Homebrew 安装的工具 (macOS)
    fn detect_brew_tool(executable: &str) -> bool {
        if cfg!(target_os = "macos") {
            // 方式 1: 直接检测可执行文件
            if Self::detect_in_path(executable) {
                return true;
            }

            // 方式 2: 使用 brew --prefix 检测
            // 方式 2: 使用 brew --prefix 检测
            let output = Command::new("brew")
                .no_window()
                .args(["--prefix", executable])
                .output();

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

        // 方式 2: 检测 npm 全局安装
        if let Ok(info) = self.check_npm_global("@anthropic-ai/claude-code") {
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
    /// 获取 Claude CLI 版本
    fn get_claude_version(&self) -> Option<String> {
        let output = Command::new("claude")
            .no_window()
            .args(["--version"])
            .output();

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

        // 方式 2: 检测 npm 全局安装
        self.check_npm_global("opencode")
    }

    /// 检测 npm 全局安装的工具
    fn check_npm_global(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        let output = Command::new(&npm_path)
            .no_window()
            .args(["list", "-g", tool_name, "--depth=0", "--json"])
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

    /// 获取 npm 路径
    fn get_npm_path(&self) -> PathBuf {
        if let Some(ref node_path) = self.node_path {
            // 假设 npm 和 node 在同一目录
            let parent = node_path.parent().unwrap_or(node_path.as_path());
            #[cfg(unix)]
            {
                parent.join("npm")
            }
            #[cfg(windows)]
            {
                parent.join("npm.cmd")
            }
        } else {
            #[cfg(unix)]
            {
                PathBuf::from("npm")
            }
            #[cfg(windows)]
            {
                PathBuf::from("npm.cmd")
            }
        }
    }

    /// 检查工具是否已安装（返回 NpmToolInfo，向后兼容）
    pub fn check_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        let output = Command::new(&npm_path)
            .no_window()
            .args(["list", "-g", tool_name, "--depth=0", "--json"])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        // 解析输出
        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.contains(tool_name) {
            // 尝试获取版本
            let version = self.get_tool_version(tool_name).ok();

            info!("Tool {} is installed: {:?}", tool_name, version);

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

    /// 获取工具版本
    fn get_tool_version(&self, tool_name: &str) -> Result<String, NpmToolError> {
        let npm_path = self.get_npm_path();

        let output = Command::new(&npm_path)
            .no_window()
            .args(["list", "-g", tool_name, "--depth=0"])
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
    /// 优先使用 npm 全局检测，失败后回退到 CLI 命令检测
    pub fn check_tool_with_fallback(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        // 特殊处理 Claude Code 和 OpenCode（支持多种安装方式）
        match tool_name {
            "@anthropic-ai/claude-code" => self.detect_claude_code(),
            "opencode" => self.detect_opencode(),
            _ => {
                // 首先尝试 npm 全局检测
                if let Ok(info) = self.check_npm_global(tool_name) {
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

    /// 安装工具（返回 NpmToolInfo，向后兼容）
    /// 使用国内 npmmirror 镜像，便于国内环境安装
    pub fn install_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        info!(
            "Installing npm tool: {} (registry: {})",
            tool_name, NPM_REGISTRY_CN
        );

        let output = Command::new(&npm_path)
            .no_window()
            .args(["install", "-g", tool_name, "--registry", NPM_REGISTRY_CN])
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

    /// 卸载工具
    pub fn uninstall_tool(&self, tool_name: &str) -> Result<(), NpmToolError> {
        let npm_path = self.get_npm_path();

        info!("Uninstalling npm tool: {}", tool_name);

        let output = Command::new(&npm_path)
            .no_window()
            .args(["uninstall", "-g", tool_name])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(NpmToolError::InstallFailed(stderr.to_string()));
        }

        Ok(())
    }

    /// 更新工具
    /// 使用国内 npmmirror 镜像
    pub fn update_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        info!(
            "Updating npm tool: {} (registry: {})",
            tool_name, NPM_REGISTRY_CN
        );

        let output = Command::new(&npm_path)
            .no_window()
            .args(["update", "-g", tool_name, "--registry", NPM_REGISTRY_CN])
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
