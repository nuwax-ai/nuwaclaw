//! 客户端信息 ViewModel
//!
//! 负责管理客户端 ID 和密码的业务逻辑

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::core::crypto::CryptoManager;
use crate::core::password::PasswordManager;

/// 客户端操作
#[derive(Debug, Clone)]
pub enum ClientInfoAction {
    /// 切换密码可见性
    TogglePasswordVisibility,
    /// 复制客户端 ID
    CopyClientId,
    /// 复制密码
    CopyPassword,
}

/// 客户端信息 ViewModel 状态
#[derive(Debug, Clone)]
pub struct ClientInfoViewModelState {
    /// 客户端 ID
    pub client_id: Option<String>,
    /// 连接密码
    pub password: String,
    /// 是否显示密码
    pub show_password: bool,
}

impl Default for ClientInfoViewModelState {
    fn default() -> Self {
        Self {
            client_id: None,
            password: String::new(),
            show_password: false,
        }
    }
}

/// 客户端信息 ViewModel
///
/// 负责：
/// - 管理客户端 ID 和密码的加载/保存
/// - 处理密码加密存储
/// - 提供 UI 状态
pub struct ClientInfoViewModel {
    /// UI 状态
    state: Arc<RwLock<ClientInfoViewModelState>>,
    /// 加密管理器
    crypto_manager: Option<Arc<CryptoManager>>,
}

impl ClientInfoViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        let crypto_manager = CryptoManager::new().ok().map(Arc::new);

        // 加载或生成密码
        let password = Self::load_or_generate_password(crypto_manager.as_ref());

        Self {
            state: Arc::new(RwLock::new(ClientInfoViewModelState {
                client_id: None,
                password,
                show_password: false,
            })),
            crypto_manager,
        }
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> ClientInfoViewModelState {
        self.state.read().await.clone()
    }

    /// 获取客户端 ID
    pub async fn client_id(&self) -> Option<String> {
        self.state.read().await.client_id.clone()
    }

    /// 获取密码
    pub async fn password(&self) -> String {
        self.state.read().await.password.clone()
    }

    /// 检查是否显示密码
    pub async fn show_password(&self) -> bool {
        self.state.read().await.show_password
    }

    /// 设置客户端 ID
    pub async fn set_client_id(&self, id: Option<String>) {
        let mut state = self.state.write().await;
        state.client_id = id;
    }

    /// 处理用户操作
    pub async fn handle_action(&self, action: ClientInfoAction) {
        match action {
            ClientInfoAction::TogglePasswordVisibility => {
                let mut state = self.state.write().await;
                state.show_password = !state.show_password;
            }
            ClientInfoAction::CopyClientId => {
                // 由 UI 层处理剪贴板操作
            }
            ClientInfoAction::CopyPassword => {
                // 由 UI 层处理剪贴板操作
            }
        }
    }

    /// 切换密码可见性
    pub async fn toggle_password_visibility(&self) {
        let mut state = self.state.write().await;
        state.show_password = !state.show_password;
    }

    /// 从配置加载或生成新密码
    fn load_or_generate_password(crypto_manager: Option<&Arc<CryptoManager>>) -> String {
        // 尝试从配置文件加载
        let config_dir = dirs::config_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        let password_file = config_dir.join("client_password.enc");

        // 尝试从加密文件加载
        if password_file.exists() {
            if let Ok(encrypted_content) = std::fs::read_to_string(&password_file) {
                let encrypted_content = encrypted_content.trim();
                if !encrypted_content.is_empty() {
                    if let Some(crypto) = crypto_manager {
                        match crypto.decrypt_string(encrypted_content) {
                            Ok(password) if !password.is_empty() => {
                                return password;
                            }
                            Ok(_) => {
                                tracing::warn!("Decrypted password is empty, generating new one");
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Failed to decrypt password: {}, generating new one",
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }

        // 检查是否存在旧的明文密码文件并迁移
        let legacy_password_file = config_dir.join("client_password");
        if legacy_password_file.exists() {
            if let Ok(plain_password) = std::fs::read_to_string(&legacy_password_file) {
                let plain_password = plain_password.trim();
                if !plain_password.is_empty() {
                    tracing::info!("Migrating legacy plaintext password to encrypted storage");
                    // 保存加密版本
                    Self::save_password_encrypted(
                        &config_dir,
                        &password_file,
                        plain_password,
                        crypto_manager,
                    );
                    // 删除旧的明文文件
                    if let Err(e) = std::fs::remove_file(&legacy_password_file) {
                        tracing::warn!("Failed to remove legacy password file: {}", e);
                    }
                    return plain_password.to_string();
                }
            }
        }

        // 生成新密码
        let new_password = PasswordManager::generate_password(12);

        // 保存加密后的密码
        Self::save_password_encrypted(&config_dir, &password_file, &new_password, crypto_manager);

        new_password
    }

    /// 保存加密后的密码到文件
    fn save_password_encrypted(
        config_dir: &Path,
        password_file: &Path,
        password: &str,
        crypto_manager: Option<&Arc<CryptoManager>>,
    ) {
        // 创建配置目录
        if let Err(e) = std::fs::create_dir_all(config_dir) {
            tracing::warn!("Failed to create config dir: {}", e);
            return;
        }

        // 加密密码
        let content_to_save = if let Some(crypto) = crypto_manager {
            match crypto.encrypt_string(password) {
                Ok(encrypted) => encrypted,
                Err(e) => {
                    tracing::warn!(
                        "Failed to encrypt password: {}, storing with base64 encoding",
                        e
                    );
                    // Fallback: 至少做 base64 编码，不存明文
                    base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        password.as_bytes(),
                    )
                }
            }
        } else {
            // 没有加密管理器时，至少做 base64 编码
            tracing::warn!("Crypto manager not available, storing with base64 encoding");
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                password.as_bytes(),
            )
        };

        // 保存文件
        if let Err(e) = std::fs::write(password_file, &content_to_save) {
            tracing::warn!("Failed to save password: {}", e);
            return;
        }

        // 设置文件权限 (Unix only: 0600)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = std::fs::Permissions::from_mode(0o600);
            if let Err(e) = std::fs::set_permissions(password_file, permissions) {
                tracing::warn!("Failed to set password file permissions: {}", e);
            }
        }
    }
}

impl Default for ClientInfoViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = ClientInfoViewModel::new();
        let state = vm.get_state().await;

        assert!(state.client_id.is_none());
        assert!(!state.password.is_empty()); // 应该生成了密码
        assert!(!state.show_password);
    }

    #[tokio::test]
    async fn test_toggle_password_visibility() {
        let vm = ClientInfoViewModel::new();

        // 初始状态
        assert!(!vm.show_password().await);

        // 切换后
        vm.toggle_password_visibility().await;
        assert!(vm.show_password().await);

        // 再切换
        vm.toggle_password_visibility().await;
        assert!(!vm.show_password().await);
    }

    #[tokio::test]
    async fn test_set_client_id() {
        let vm = ClientInfoViewModel::new();

        // 初始为空
        assert!(vm.client_id().await.is_none());

        // 设置 ID
        vm.set_client_id(Some("test-client-id".to_string())).await;
        assert_eq!(vm.client_id().await, Some("test-client-id".to_string()));

        // 清空 ID
        vm.set_client_id(None).await;
        assert!(vm.client_id().await.is_none());
    }

    #[tokio::test]
    async fn test_handle_action_toggle() {
        let vm = ClientInfoViewModel::new();

        assert!(!vm.show_password().await);

        vm.handle_action(ClientInfoAction::TogglePasswordVisibility)
            .await;
        assert!(vm.show_password().await);
    }
}
