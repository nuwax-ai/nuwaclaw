//! 版本信息和更新状态

use serde::{Deserialize, Serialize};

/// 版本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    /// 版本号
    pub version: String,
    /// 更新说明
    pub release_notes: String,
    /// 下载 URL
    pub download_url: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 发布日期
    pub release_date: String,
    /// 是否强制更新
    pub mandatory: bool,
    /// SHA256 校验和
    #[serde(default)]
    pub sha256: String,
}

/// 更新状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStatus {
    /// 未检查
    Unknown,
    /// 检查中
    Checking,
    /// 已是最新
    UpToDate,
    /// 有可用更新
    UpdateAvailable(String),
    /// 下载中
    Downloading(u8),
    /// 准备安装
    ReadyToInstall,
    /// 检查失败
    Failed(String),
}
