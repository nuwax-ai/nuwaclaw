//! 关于页面组件

use gpui::*;
use gpui_component::button::Button;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable};

/// 关于页面视图
pub struct AboutView {
    /// 应用版本
    version: String,
    /// 构建信息
    build_info: String,
    /// Git commit SHA
    git_sha: String,
}

impl Default for AboutView {
    fn default() -> Self {
        Self::new()
    }
}

impl AboutView {
    pub fn new() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            build_info: Self::build_info(),
            git_sha: option_env!("VERGEN_GIT_SHA")
                .unwrap_or("unknown")
                .to_string(),
        }
    }

    fn build_info() -> String {
        let target = if cfg!(target_os = "macos") {
            "macOS"
        } else if cfg!(target_os = "windows") {
            "Windows"
        } else if cfg!(target_os = "linux") {
            "Linux"
        } else {
            "Unknown"
        };

        let arch = if cfg!(target_arch = "x86_64") {
            "x64"
        } else if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "unknown"
        };

        format!("{} {}", target, arch)
    }

    fn render_info_row(
        &self,
        label: &str,
        value: &str,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        h_flex()
            .gap_2()
            .child(
                div()
                    .w(px(100.0))
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child(label.to_string()),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .child(value.to_string()),
            )
    }
}

impl Render for AboutView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .p_6()
            .gap_6()
            .child(
                // 标题区
                v_flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .text_color(theme.foreground)
                            .child(Icon::new(IconName::Bot).small()),
                    )
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.foreground)
                            .child("Nuwax Agent"),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.muted_foreground)
                            .child("跨平台 AI Agent 客户端"),
                    ),
            )
            .child(
                // 版本信息
                v_flex()
                    .gap_2()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.background)
                    .border_1()
                    .border_color(theme.border)
                    .child(self.render_info_row("版本", &self.version, cx))
                    .child(self.render_info_row("平台", &self.build_info, cx))
                    .child(self.render_info_row("Git SHA", &self.git_sha, cx)),
            )
            .child(
                // 操作按钮
                v_flex()
                    .gap_2()
                    .child(
                        Button::new("export-logs")
                            .label("导出日志")
                            .icon(Icon::new(IconName::Folder))
                            .small(),
                    )
                    .child(
                        Button::new("check-update")
                            .label("检查更新")
                            .icon(Icon::new(IconName::Redo))
                            .small(),
                    ),
            )
    }
}
