use serde::{Deserialize, Serialize};

/// 诊断开机自启动配置
/// 返回自启动的后端类型、配置路径和当前状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutolaunchDiagnoseResult {
    pub enabled: bool,
    pub backend: String,
    pub config_path: String,
    pub config_exists: bool,
}

/// 查询系统托盘状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayStatusResult {
    pub available: bool,
    pub reason: Option<String>,
}
