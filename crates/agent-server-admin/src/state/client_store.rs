//! 客户端管理方法
//!
//! AppState 上的客户端注册、查询、心跳等操作

use chrono::Utc;

use super::events::ServerEvent;
use super::models::{ClientInfo, ClientRegistration};
use super::AppState;

impl AppState {
    /// 注册客户端
    pub fn register_client(&self, registration: ClientRegistration) -> ClientInfo {
        let client = ClientInfo::from_registration(&registration);
        let id = client.id.clone();

        // 使用 entry API 避免 TOCTOU 竞态
        let is_new = match self.clients.entry(id.clone()) {
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                entry.insert(client.clone());
                true
            }
            dashmap::mapref::entry::Entry::Occupied(mut entry) => {
                entry.insert(client.clone());
                false
            }
        };

        if is_new {
            let _ = self.event_tx.send(ServerEvent::ClientOnline(id));
        }

        client
    }

    /// 获取客户端列表
    pub fn list_clients(&self) -> Vec<ClientInfo> {
        self.clients
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 获取在线客户端列表
    pub fn list_online_clients(&self) -> Vec<ClientInfo> {
        self.clients
            .iter()
            .filter(|entry| entry.value().online)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 获取单个客户端
    pub fn get_client(&self, id: &str) -> Option<ClientInfo> {
        self.clients.get(id).map(|entry| entry.value().clone())
    }

    /// 添加客户端
    pub fn add_client(&self, client: ClientInfo) {
        let id = client.id.clone();
        self.clients.insert(id.clone(), client);
        let _ = self.event_tx.send(ServerEvent::ClientOnline(id));
    }

    /// 移除客户端
    pub fn remove_client(&self, id: &str) {
        if self.clients.remove(id).is_some() {
            let _ = self
                .event_tx
                .send(ServerEvent::ClientOffline(id.to_string()));
        }
    }

    /// 更新客户端心跳
    pub fn update_heartbeat(&self, id: &str) -> bool {
        if let Some(mut client) = self.clients.get_mut(id) {
            client.last_heartbeat = Utc::now();
            client.online = true;
            true
        } else {
            false
        }
    }

    /// 设置客户端离线
    pub fn set_client_offline(&self, id: &str) {
        if let Some(mut client) = self.clients.get_mut(id) {
            client.online = false;
            let _ = self
                .event_tx
                .send(ServerEvent::ClientOffline(id.to_string()));
        }
    }
}
