//! 客户端信息组件
//!
//! 显示客户端 ID 和密码信息

use gpui::*;
use gpui_component::{ActiveTheme, Icon, IconName, Sizable, button::Button, h_flex, v_flex};

use crate::core::crypto::CryptoManager;
use crate::core::password::PasswordManager;

/// 客户端信息组件
pub struct ClientInfoView {
    /// 客户端 ID
    client_id: Option<String>,
    /// 连接密码
    password: String,
    /// 是否显示密码
    show_password: bool,
}

impl ClientInfoView {
    /// 创建新的客户端信息视图
    pub fn new() -> Self {
        // 从配置加载密码，如果不存在则生成新密码
        let password = Self::load_or_generate_password();

        Self {
            client_id: None,
            password,
            show_password: false,
        }
    }

    /// 从配置加载或生成新密码
    fn load_or_generate_password() -> String {
        // 尝试从配置文件加载
        let config_dir = dirs::config_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("nuwax-agent");

        let password_file = config_dir.join("client_password.enc");

        // 尝试初始化加密管理器
        let crypto = match CryptoManager::new() {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!("Failed to initialize crypto manager: {}", e);
                None
            }
        };

        // 尝试从加密文件加载
        if password_file.exists() {
            if let Ok(encrypted_content) = std::fs::read_to_string(&password_file) {
                let encrypted_content = encrypted_content.trim();
                if !encrypted_content.is_empty() {
                    if let Some(ref crypto) = crypto {
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
                        crypto.as_ref(),
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
        Self::save_password_encrypted(&config_dir, &password_file, &new_password, crypto.as_ref());

        new_password
    }

    /// 保存加密后的密码到文件
    fn save_password_encrypted(
        config_dir: &std::path::Path,
        password_file: &std::path::Path,
        password: &str,
        crypto: Option<&CryptoManager>,
    ) {
        // 创建配置目录
        if let Err(e) = std::fs::create_dir_all(config_dir) {
            tracing::warn!("Failed to create config dir: {}", e);
            return;
        }

        // 加密密码
        let content_to_save = if let Some(crypto) = crypto {
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

    /// 设置客户端 ID
    pub fn set_client_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        self.client_id = id;
        cx.notify();
    }

    /// 切换密码显示
    fn toggle_password_visibility(&mut self, cx: &mut Context<Self>) {
        self.show_password = !self.show_password;
        cx.notify();
    }

    /// 复制客户端 ID 到剪贴板
    fn copy_client_id(&self, cx: &mut Context<Self>) {
        if let Some(ref id) = self.client_id {
            cx.write_to_clipboard(ClipboardItem::new_string(id.clone()));
            tracing::info!("Client ID copied to clipboard");
        }
    }

    /// 复制密码到剪贴板
    fn copy_password(&self, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(self.password.clone()));
        tracing::info!("Password copied to clipboard");
    }
}

impl Default for ClientInfoView {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for ClientInfoView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let client_id = self
            .client_id
            .clone()
            .unwrap_or_else(|| "--------".to_string());
        let password_display = if self.show_password {
            self.password.clone()
        } else {
            "••••••••".to_string()
        };
        let show_password = self.show_password;

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("客户端信息"),
            )
            // Info card
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    // 客户端 ID 行
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("客户端 ID"),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_2xl()
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.foreground)
                                            .child(client_id),
                                    )
                                    .child(
                                        Button::new("copy-id")
                                            .icon(Icon::new(IconName::Copy).small())
                                            .small()
                                            .on_click(cx.listener(|this, _, _window, cx| {
                                                this.copy_client_id(cx);
                                            })),
                                    ),
                            ),
                    )
                    // 分隔线
                    .child(div().h(px(1.0)).w_full().bg(theme.border))
                    // 密码行
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("连接密码"),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_xl()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child(password_display),
                                    )
                                    .child(
                                        h_flex()
                                            .gap_1()
                                            .child(
                                                Button::new("toggle-password")
                                                    .icon(
                                                        Icon::new(if show_password {
                                                            IconName::EyeOff
                                                        } else {
                                                            IconName::Eye
                                                        })
                                                        .small(),
                                                    )
                                                    .small()
                                                    .on_click(cx.listener(
                                                        |this, _, _window, cx| {
                                                            this.toggle_password_visibility(cx);
                                                        },
                                                    )),
                                            )
                                            .child(
                                                Button::new("copy-password")
                                                    .icon(Icon::new(IconName::Copy).small())
                                                    .small()
                                                    .on_click(cx.listener(
                                                        |this, _, _window, cx| {
                                                            this.copy_password(cx);
                                                        },
                                                    )),
                                            ),
                                    ),
                            ),
                    ),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("提示：将客户端 ID 分享给管理端以建立连接"),
            )
    }
}
