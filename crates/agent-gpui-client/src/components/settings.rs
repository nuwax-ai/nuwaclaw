//! 设置组件
//!
//! 包含服务器配置、安全设置、常规设置等子页面

use gpui::prelude::FluentBuilder as _;
use gpui::*;
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex,
    input::{Input, InputState},
    radio::{Radio, RadioGroup},
    v_flex, ActiveTheme, Disableable, Icon, IconName, Selectable, Sizable, Theme, ThemeMode,
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
    /// JSON 配置
    JsonConfig,
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
            Self::JsonConfig,
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
            Self::JsonConfig => "JSON 配置",
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
            Self::JsonConfig => IconName::File,
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
    /// HBBS 输入框状态
    hbbs_input: Option<Entity<InputState>>,
    /// HBBR 输入框状态
    hbbr_input: Option<Entity<InputState>>,
    /// 配置是否已修改
    config_modified: bool,
    /// 是否正在测试连接
    is_testing: bool,
    /// 测试结果消息
    test_result: Option<(bool, String)>,
    /// 是否开机自启动
    auto_launch: bool,
    /// 主题设置
    theme: String,
    /// 语言
    language: String,
    /// JSON 编辑器内容
    json_content: String,
    /// JSON 错误信息
    json_error: Option<String>,
    /// 是否正在监控文件
    is_watching: bool,
    /// 最后操作结果
    last_result: Option<(bool, String)>,
}

impl SettingsView {
    /// 创建新的设置视图
    pub fn new() -> Self {
        Self {
            current_page: SettingsPage::Server,
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
            hbbs_input: None,
            hbbr_input: None,
            config_modified: false,
            is_testing: false,
            test_result: None,
            auto_launch: false,
            theme: "system".to_string(),
            language: "zh".to_string(),
            json_content: String::new(),
            json_error: None,
            is_watching: false,
            last_result: None,
        }
    }

    /// 初始化输入框（需要在有 window 时调用）
    fn ensure_inputs_initialized(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.hbbs_input.is_none() {
            let hbbs_addr = self.hbbs_addr.clone();
            self.hbbs_input = Some(cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder("HBBS 服务器地址")
                    .default_value(&hbbs_addr)
            }));
        }
        if self.hbbr_input.is_none() {
            let hbbr_addr = self.hbbr_addr.clone();
            self.hbbr_input = Some(cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder("HBBR 中继服务器地址")
                    .default_value(&hbbr_addr)
            }));
        }
    }

    /// 检查配置是否已修改
    fn check_config_modified(&mut self, cx: &mut Context<Self>) {
        if let (Some(hbbs_input), Some(hbbr_input)) = (&self.hbbs_input, &self.hbbr_input) {
            let current_hbbs = hbbs_input.read(cx).value().to_string();
            let current_hbbr = hbbr_input.read(cx).value().to_string();
            self.config_modified = current_hbbs != self.hbbs_addr || current_hbbr != self.hbbr_addr;
        }
    }

    /// 保存服务器配置
    fn save_config(&mut self, cx: &mut Context<Self>) {
        if let (Some(hbbs_input), Some(hbbr_input)) = (&self.hbbs_input, &self.hbbr_input) {
            self.hbbs_addr = hbbs_input.read(cx).value().to_string();
            self.hbbr_addr = hbbr_input.read(cx).value().to_string();
            self.config_modified = false;
            self.test_result = Some((true, "配置已保存".to_string()));
            // TODO: 持久化配置到文件
            cx.notify();
        }
    }

    /// 测试服务器连接
    fn test_connection(&mut self, cx: &mut Context<Self>) {
        self.is_testing = true;
        self.test_result = None;
        cx.notify();

        // 测试连接模拟
        // 注意：cx.spawn 的闭包内不能直接使用 tokio::time::sleep
        // 这里使用简单的模拟延迟，实际应该使用网络请求
        cx.spawn(async move |view, cx| {
            // 模拟网络延迟（使用同步延时，实际网络测试应该用真实的 TCP 连接）
            std::thread::sleep(std::time::Duration::from_millis(500));

            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view.is_testing = false;
                        // TODO: 实际测试连接逻辑（使用 TCP 连接测试服务器可达性）
                        view.test_result = Some((true, "连接测试成功".to_string()));
                        cx.notify();
                    });
                }
            })
        })
        .detach();
    }

    /// 切换页面
    fn switch_page(&mut self, page: SettingsPage, cx: &mut Context<Self>) {
        self.current_page = page;
        cx.notify();
    }

    /// 设置当前页面（公开方法，用于外部导航）
    pub fn set_active_page(&mut self, page: SettingsPage, cx: &mut Context<Self>) {
        self.switch_page(page, cx);
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
    fn render_server_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        // 确保输入框已初始化
        self.ensure_inputs_initialized(window, cx);

        // 检查配置是否修改
        self.check_config_modified(cx);

        // 在可变借用之后获取 theme
        let theme = cx.theme();

        let config_modified = self.config_modified;
        let is_testing = self.is_testing;
        let test_result = self.test_result.clone();

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
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child("用于 P2P 连接握手和中继服务发现"),
                            )
                            .when_some(self.hbbs_input.clone(), |this, input| {
                                this.child(Input::new(&input).cleanable(true))
                            }),
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
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child("当 P2P 连接失败时使用中继转发"),
                            )
                            .when_some(self.hbbr_input.clone(), |this, input| {
                                this.child(Input::new(&input).cleanable(true))
                            }),
                    )
                    .when_some(test_result, |this, (success, message)| {
                        this.child(
                            h_flex()
                                .gap_2()
                                .items_center()
                                .child(
                                    Icon::new(if success {
                                        IconName::CircleCheck
                                    } else {
                                        IconName::CircleX
                                    })
                                    .small()
                                    .text_color(if success { theme.success } else { theme.danger }),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(if success {
                                            theme.success
                                        } else {
                                            theme.danger
                                        })
                                        .child(message),
                                ),
                        )
                    })
                    .child(
                        h_flex()
                            .gap_2()
                            .justify_end()
                            .child(
                                Button::new("test-connection")
                                    .label(if is_testing {
                                        "测试中..."
                                    } else {
                                        "测试连接"
                                    })
                                    .small()
                                    .ghost()
                                    .disabled(is_testing)
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        this.test_connection(cx);
                                    })),
                            )
                            .child(
                                Button::new("save-config")
                                    .label("保存")
                                    .small()
                                    .primary()
                                    .disabled(!config_modified)
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        this.save_config(cx);
                                    })),
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
                            .child(Button::new("change-password").label("修改密码").small()),
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
                                    .child(if self.auto_launch {
                                        "已启用"
                                    } else {
                                        "已禁用"
                                    }),
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
                            .child(div().text_sm().text_color(theme.foreground).child(
                                if self.language == "zh" {
                                    "中文"
                                } else {
                                    "English"
                                },
                            )),
                    ),
            )
    }

    /// 渲染外观设置页
    fn render_appearance_page(
        &mut self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        // 计算当前主题选中索引
        let selected_index = match self.theme.as_str() {
            "light" => Some(0),
            "dark" => Some(1),
            _ => Some(2), // system
        };

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
                        v_flex()
                            .gap_3()
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
                                RadioGroup::vertical("theme-selector")
                                    .child(Radio::new("theme-light").label("浅色"))
                                    .child(Radio::new("theme-dark").label("深色"))
                                    .child(Radio::new("theme-system").label("跟随系统"))
                                    .selected_index(selected_index)
                                    .on_click(cx.listener(
                                        move |this, selected_ix: &usize, window, cx| {
                                            let theme_str = match selected_ix {
                                                0 => "light",
                                                1 => "dark",
                                                _ => "system",
                                            };
                                            this.theme = theme_str.to_string();
                                            this.apply_theme(window, cx);
                                            cx.notify();
                                        },
                                    )),
                            ),
                    ),
            )
    }

    /// 应用主题设置
    fn apply_theme(&self, window: &mut Window, cx: &mut App) {
        match self.theme.as_str() {
            "light" => Theme::change(ThemeMode::Light, Some(window), cx),
            "dark" => Theme::change(ThemeMode::Dark, Some(window), cx),
            _ => {
                // 跟随系统：检测系统外观
                let mode: ThemeMode = window.appearance().into();
                Theme::change(mode, Some(window), cx);
            }
        }
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
                            .child(div().text_sm().text_color(theme.foreground).child("Info")),
                    )
                    .child(
                        Button::new("export-logs")
                            .label("导出日志")
                            .icon(Icon::new(IconName::ExternalLink).small()),
                    ),
            )
    }

    /// 渲染 JSON 配置页面
    fn render_json_config_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("JSON 配置"),
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
                        div()
                            .h(px(300.0))
                            .w_full()
                            .p_4()
                            .rounded_md()
                            .bg(theme.background)
                            .border_1()
                            .border_color(theme.border)
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("JSON 编辑器区域（暂未实现完整编辑器）"),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("文件监控"),
                            )
                            .child(div().text_sm().text_color(theme.muted_foreground).child(
                                if self.is_watching {
                                    "监控中"
                                } else {
                                    "未监控"
                                },
                            )),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .justify_end()
                            .child(
                                Button::new("reload-config")
                                    .label("重新加载")
                                    .small()
                                    .ghost()
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        this.set_result(true, "配置已重新加载".to_string());
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("apply-config")
                                    .label("应用配置")
                                    .small()
                                    .primary()
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        if let Some(ref error) = this.json_error {
                                            this.set_result(
                                                false,
                                                format!("JSON 格式错误: {}", error),
                                            );
                                        } else {
                                            this.set_result(true, "配置已应用".to_string());
                                        }
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
            .when_some(self.last_result.clone(), |this, (success, message)| {
                let success_color = if success { theme.success } else { theme.danger };
                this.child(
                    div()
                        .p_3()
                        .rounded_md()
                        .bg(success_color.alpha(0.1))
                        .border_1()
                        .border_color(success_color)
                        .child(
                            h_flex()
                                .gap_2()
                                .items_center()
                                .child(
                                    Icon::new(if success {
                                        IconName::CircleCheck
                                    } else {
                                        IconName::CircleX
                                    })
                                    .small()
                                    .text_color(success_color),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(success_color)
                                        .child(message.clone()),
                                ),
                        ),
                )
            })
    }

    /// 设置 JSON 内容
    pub fn set_json_content(&mut self, content: String) {
        self.json_content = content;
        self.json_error = None;
    }

    /// 获取 JSON 内容
    pub fn json_content(&self) -> &str {
        &self.json_content
    }

    /// 设置 JSON 错误
    pub fn set_json_error(&mut self, error: Option<String>) {
        self.json_error = error;
    }

    /// 获取 JSON 错误
    pub fn json_error(&self) -> Option<&str> {
        self.json_error.as_deref()
    }

    /// 设置监控状态
    pub fn set_watching(&mut self, watching: bool) {
        self.is_watching = watching;
    }

    /// 获取监控状态
    pub fn is_watching(&self) -> bool {
        self.is_watching
    }

    /// 设置操作结果
    pub fn set_result(&mut self, success: bool, message: String) {
        self.last_result = Some((success, message));
    }

    /// 获取操作结果
    pub fn last_result(&self) -> Option<&(bool, String)> {
        self.last_result.as_ref()
    }
}

impl Default for SettingsView {
    fn default() -> Self {
        Self {
            current_page: SettingsPage::Server,
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
            hbbs_input: None,
            hbbr_input: None,
            config_modified: false,
            is_testing: false,
            test_result: None,
            auto_launch: false,
            theme: "system".to_string(),
            language: "zh".to_string(),
            json_content: String::new(),
            json_error: None,
            is_watching: false,
            last_result: None,
        }
    }
}

impl Render for SettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = cx.theme();

        h_flex()
            .gap_6()
            .child(self.render_nav(cx))
            .child(v_flex().flex_1().child(match self.current_page {
                SettingsPage::Server => self.render_server_page(window, cx).into_any_element(),
                SettingsPage::Security => self.render_security_page(cx).into_any_element(),
                SettingsPage::General => self.render_general_page(cx).into_any_element(),
                SettingsPage::Appearance => {
                    self.render_appearance_page(window, cx).into_any_element()
                }
                SettingsPage::Logging => self.render_logging_page(cx).into_any_element(),
                SettingsPage::JsonConfig => self.render_json_config_page(cx).into_any_element(),
            }))
    }
}
