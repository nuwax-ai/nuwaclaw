//! 设置组件
//!
//! 包含服务器配置、安全设置、常规设置等子页面

use gpui::*;
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex, v_flex, ActiveTheme, Icon, IconName, Selectable, Sizable,
};

/// 设置子页面
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsPage {
    /// 服务器配置
    Server,
    /// 安全设置
    Security,
    /// 常规设置
    General,
    /// 外观设置
    Appearance,
    /// 日志设置
    Logging,
}

impl SettingsPage {
    /// 获取所有设置页面
    pub fn all() -> Vec<Self> {
        vec![
            Self::Server,
            Self::Security,
            Self::General,
            Self::Appearance,
            Self::Logging,
        ]
    }

    /// 获取页面标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Server => "服务器",
            Self::Security => "安全",
            Self::General => "常规",
            Self::Appearance => "外观",
            Self::Logging => "日志",
        }
    }

    /// 获取页面图标
    pub fn icon(&self) -> IconName {
        match self {
            Self::Server => IconName::Globe,
            Self::Security => IconName::Eye,
            Self::General => IconName::Settings,
            Self::Appearance => IconName::Palette,
            Self::Logging => IconName::File,
        }
    }
}

/// 设置视图
pub struct SettingsView {
    /// 当前页面
    current_page: SettingsPage,
    /// 服务器地址
    hbbs_addr: String,
    /// 中继服务器地址
    hbbr_addr: String,
    /// 是否开机自启动
    auto_launch: bool,
    /// 主题设置
    theme: String,
    /// 语言
    language: String,
}

impl SettingsView {
    /// 创建新的设置视图
    pub fn new() -> Self {
        Self {
            current_page: SettingsPage::Server,
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
            auto_launch: false,
            theme: "system".to_string(),
            language: "zh".to_string(),
        }
    }

    /// 切换页面
    fn switch_page(&mut self, page: SettingsPage, cx: &mut Context<Self>) {
        self.current_page = page;
        cx.notify();
    }

    /// 渲染侧边导航
    fn render_nav(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let current = self.current_page;

        v_flex()
            .w(px(180.0))
            .gap_1()
            .children(SettingsPage::all().into_iter().map(|page| {
                let is_active = page == current;

                Button::new(SharedString::from(page.label()))
                    .label(page.label())
                    .icon(Icon::new(page.icon()).small())
                    .ghost()
                    .selected(is_active)
                    .w_full()
                    .on_click(cx.listener(move |this, _, _window, cx| {
                        this.switch_page(page, cx);
                    }))
            }))
    }

    /// 渲染服务器设置页
    fn render_server_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("服务器配置"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        v_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("信令服务器 (HBBS)"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child(self.hbbs_addr.clone()),
                            ),
                    )
                    .child(
                        v_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("中继服务器 (HBBR)"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child(self.hbbr_addr.clone()),
                            ),
                    ),
            )
    }

    /// 渲染安全设置页
    fn render_security_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("安全设置"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child("连接密码"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child("修改客户端连接密码"),
                                    ),
                            )
                            .child(
                                Button::new("change-password")
                                    .label("修改密码")
                                    .small(),
                            ),
                    ),
            )
    }

    /// 渲染常规设置页
    fn render_general_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("常规设置"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child("开机自启动"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child("系统启动时自动运行客户端"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if self.auto_launch {
                                        theme.success
                                    } else {
                                        theme.muted_foreground
                                    })
                                    .child(if self.auto_launch { "已启用" } else { "已禁用" }),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child("语言"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child("界面显示语言"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(if self.language == "zh" { "中文" } else { "English" }),
                            ),
                    ),
            )
    }

    /// 渲染外观设置页
    fn render_appearance_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("外观设置"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child("主题"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child("选择浅色、深色或跟随系统"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(match self.theme.as_str() {
                                        "light" => "浅色",
                                        "dark" => "深色",
                                        _ => "跟随系统",
                                    }),
                            ),
                    ),
            )
    }

    /// 渲染日志设置页
    fn render_logging_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("日志设置"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child("日志级别"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child("设置日志输出详细程度"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child("Info"),
                            ),
                    )
                    .child(
                        Button::new("export-logs")
                            .label("导出日志")
                            .icon(Icon::new(IconName::ExternalLink).small()),
                    ),
            )
    }
}

impl Default for SettingsView {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for SettingsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = cx.theme();

        h_flex()
            .gap_6()
            .child(self.render_nav(cx))
            .child(
                v_flex()
                    .flex_1()
                    .child(match self.current_page {
                        SettingsPage::Server => self.render_server_page(cx).into_any_element(),
                        SettingsPage::Security => self.render_security_page(cx).into_any_element(),
                        SettingsPage::General => self.render_general_page(cx).into_any_element(),
                        SettingsPage::Appearance => self.render_appearance_page(cx).into_any_element(),
                        SettingsPage::Logging => self.render_logging_page(cx).into_any_element(),
                    }),
            )
    }
}
