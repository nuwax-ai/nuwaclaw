use serde::{Deserialize, Serialize};

/// Node.js 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// npm 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmPackageResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// npm 包安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
    pub error: Option<String>,
}

/// Shell Installer 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInstallerResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// Node.js 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// uv 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// uv 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}
