use serde::{Deserialize, Serialize};

// 依赖项 DTO（用于 Tauri IPC）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyItemDto {
    pub name: String,
    pub display_name: String,
    pub version: Option<String>,
    pub status: String,
    pub required: bool,
    pub description: String,
}

// 依赖统计 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencySummaryDto {
    pub total: usize,
    pub installed: usize,
    pub missing: usize,
}

impl From<&nuwax_agent_core::dependency::DependencyItem> for DependencyItemDto {
    fn from(item: &nuwax_agent_core::dependency::DependencyItem) -> Self {
        Self {
            name: item.name.clone(),
            display_name: item.display_name.clone(),
            version: item.version.clone(),
            status: format!("{:?}", item.status),
            required: item.required,
            description: item.description.clone(),
        }
    }
}
