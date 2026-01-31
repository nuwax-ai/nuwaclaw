//! npm 工具安装器
//!
//! 管理 npm 全局工具的安装（opencode, claude-code 等）

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};

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
            .args(["list", "-g", tool_name, "--depth=0"])
            .output()
            .map_err(|e| NpmToolError::CommandFailed(e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 解析版本，格式如：└── tool@1.0.0
        for line in stdout.lines() {
            if line.contains(tool_name) {
                if let Some(version_part) = line.split('@').last() {
                    return Ok(version_part.trim().to_string());
                }
            }
        }

        Err(NpmToolError::CommandFailed("Version not found".to_string()))
    }

    /// 安装工具（返回 NpmToolInfo，向后兼容）
    pub fn install_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        info!("Installing npm tool: {}", tool_name);

        let output = Command::new(&npm_path)
            .args(["install", "-g", tool_name])
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
    pub fn update_tool(&self, tool_name: &str) -> Result<NpmToolInfo, NpmToolError> {
        let npm_path = self.get_npm_path();

        info!("Updating npm tool: {}", tool_name);

        let output = Command::new(&npm_path)
            .args(["update", "-g", tool_name])
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
