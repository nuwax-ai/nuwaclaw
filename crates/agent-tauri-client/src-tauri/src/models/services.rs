use nuwax_agent_core::service::ServiceInfo;
use serde::{Deserialize, Serialize};

/// 服务状态 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfoDto {
    pub service_type: String,
    pub state: String,
    pub pid: Option<u32>,
}

impl From<ServiceInfo> for ServiceInfoDto {
    fn from(info: ServiceInfo) -> Self {
        Self {
            service_type: format!("{:?}", info.service_type),
            state: format!("{:?}", info.state),
            pid: info.pid,
        }
    }
}

/// 服务健康检查结果 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealthDto {
    pub service_type: String,
    pub state: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub port_reachable: bool,
}
