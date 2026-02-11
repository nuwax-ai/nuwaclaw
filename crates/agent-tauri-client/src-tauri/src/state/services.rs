use nuwax_agent_core::agent_runner::RcoderAgentRunner;
use nuwax_agent_core::service::ServiceManager;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 服务管理器状态
///
/// 注意：服务配置在启动时从 Tauri store 动态读取，
/// 不在此处设置默认配置
pub struct ServiceManagerState {
    pub manager: Mutex<ServiceManager>,
    /// 保存当前的 RcoderAgentRunner，用于在重启时正确停止旧实例（包括 Pingora 代理）
    pub agent_runner: Mutex<Option<Arc<RcoderAgentRunner>>>,
}

impl Default for ServiceManagerState {
    fn default() -> Self {
        // 使用默认配置初始化，运行时通过 start_*_with_config 方法传入实际配置
        let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig::default();
        Self {
            manager: Mutex::new(ServiceManager::new(None, Some(lanproxy_config), None)),
            agent_runner: Mutex::new(None),
        }
    }
}
