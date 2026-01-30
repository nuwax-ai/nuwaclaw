//! npm 工具安装器
//!
//! 管理 npm 全局工具的安装（opencode, claude-code 等）

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};

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

/// npm 工具信息
#[derive(Debug, Clone)]
pub struct NpmToolInfo {
    /// 工具名称
    pub name: String,
    /// 版本
    pub version: Option<String>,
    /// 是否已安装
    pub installed: bool,
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

    /// 检查工具是否已安装
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

    /// 安装工具
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_npm_tool_installer_creation() {
        let installer = NpmToolInstaller::new(None);
        // 只测试创建
        assert!(installer.node_path.is_none());
    }
}
