# gpui-component

## 项目概述

基于 GPUI 的跨平台桌面 UI 组件库，提供 60+ 组件，受 macOS/Windows 控件和 shadcn/ui 启发。

**本地路径**: `vendors/gpui-component`

## 目录结构

```
gpui-component/
├── Cargo.toml                          # workspace 配置
├── crates/
│   ├── ui/                             # 核心 UI 库
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs                  # 库入口
│   │   │   ├── init.rs                 # 初始化
│   │   │   ├── app.rs                  # 应用生命周期
│   │   │   ├── theme/                  # 主题系统
│   │   │   │   ├── mod.rs
│   │   │   │   ├── color.rs
│   │   │   │   ├── registry.rs
│   │   │   │   ├── schema.rs
│   │   │   │   └── theme_color.rs
│   │   │   ├── input/                  # 输入组件
│   │   │   │   ├── mod.rs
│   │   │   │   ├── input.rs
│   │   │   │   ├── number_input.rs
│   │   │   │   ├── state.rs
│   │   │   │   └── lsp/                # LSP 集成
│   │   │   ├── button/                 # 按钮组件
│   │   │   │   └── mod.rs
│   │   │   ├── chart/                  # 图表组件
│   │   │   │   └── mod.rs
│   │   │   ├── dock/                   # 停靠面板
│   │   │   │   └── mod.rs
│   │   │   ├── menu/                   # 菜单系统
│   │   │   │   └── mod.rs
│   │   │   ├── list/                   # 列表组件
│   │   │   │   └── mod.rs
│   │   │   ├── table/                  # 表格组件
│   │   │   │   ├── mod.rs
│   │   │   │   ├── table.rs
│   │   │   │   └── data_table.rs       # 高级表格
│   │   │   ├── dialog/                 # 对话框
│   │   │   │   └── mod.rs
│   │   │   ├── navigation/             # 导航组件
│   │   │   │   ├── mod.rs
│   │   │   │   ├── breadcrumb.rs
│   │   │   │   ├── pagination.rs
│   │   │   │   └── tabs.rs
│   │   │   ├── feedback/               # 反馈组件
│   │   │   │   ├── mod.rs
│   │   │   │   ├── alert.rs
│   │   │   │   ├── loading.rs
│   │   │   │   ├── progress.rs
│   │   │   │   └── toast.rs
│   │   │   ├── overlay/                # 浮层组件
│   │   │   │   ├── mod.rs
│   │   │   │   ├── popover.rs
│   │   │   │   ├── tooltip.rs
│   │   │   │   └── sheet.rs
│   │   │   ├── form/                   # 表单组件
│   │   │   │   ├── mod.rs
│   │   │   │   └── form.rs
│   │   │   ├── scroll/                 # 滚动组件
│   │   │   │   └── mod.rs
│   │   │   ├── avatar/                 # 头像组件
│   │   │   │   └── mod.rs
│   │   │   ├── badge/                  # 徽章组件
│   │   │   │   └── mod.rs
│   │   │   ├── card/                   # 卡片组件
│   │   │   │   └── mod.rs
│   │   │   ├── divider/                # 分隔线
│   │   │   │   └── mod.rs
│   │   │   ├── icon/                   # 图标
│   │   │   │   └── mod.rs
│   │   │   ├── image/                  # 图像
│   │   │   │   └── mod.rs
│   │   │   ├── select/                 # 选择器
│   │   │   │   └── mod.rs
│   │   │   ├── checkbox/               # 复选框
│   │   │   │   └── mod.rs
│   │   │   ├── radio/                  # 单选框
│   │   │   │   └── mod.rs
│   │   │   ├── switch/                 # 开关
│   │   │   │   └── mod.rs
│   │   │   ├── slider/                 # 滑块
│   │   │   │   └── mod.rs
│   │   │   ├── date_picker/            # 日期选择
│   │   │   │   └── mod.rs
│   │   │   ├── color_picker/           # 颜色选择
│   │   │   │   └── mod.rs
│   │   │   ├── tree/                   # 树形组件
│   │   │   │   └── mod.rs
│   │   │   ├── virtual_list/           # 虚拟列表
│   │   │   │   └── mod.rs
│   │   │   ├── markdown/               # Markdown
│   │   │   │   └── mod.rs
│   │   │   └── ...
│   │   └── Cargo.toml
│   │
│   ├── story/                          # 组件展示应用
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── app.rs
│   │   │   ├── storybook.rs            # StoryBook 框架
│   │   │   └── stories/                # 组件示例
│   │   │       ├── button_story.rs
│   │   │       ├── input_story.rs
│   │   │       └── ...
│   │   └── Cargo.toml
│   │
│   ├── macros/                         # 过程宏
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   │
│   ├── assets/                         # 静态资源
│   │   ├── src/
│   │   │   └── lib.rs
│   │   ├── icons/                      # 图标资源
│   │   └── themes/                     # 主题文件
│   │       └── Cargo.toml
│   │
│   └── webview/                        # WebView 支持
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           └── webview.rs
│
└── Cargo.toml
```

## 核心依赖

```toml
[workspace]
members = ["crates/*"]

[dependencies]
# GPUI 框架
gpui = "1.0"

# 网络
reqwest = { version = "0.11", features = ["json", "blocking"] }

# 文本处理
ropey = "1.6"
unicode-width = "0.1"

# 文件系统
notify = { version = "6.0", features = ["default"] }

# 序列化
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# 日志
tracing = "0.1"
tracing-subscriber = "0.3"

# 国际化
rust-i18n = "2.0"

# LSP
lsp-types = "0.94"
```

## 主题系统

### 主题结构

```rust
// crates/ui/src/theme/mod.rs

use std::sync::Arc;

/// 主题配置
#[derive(Clone, Debug, Default)]
pub struct Theme {
    /// 颜色配置
    pub colors: ThemeColor,

    /// 亮色主题配置
    pub light_theme: Rc<ThemeConfig>,

    /// 暗色主题配置
    pub dark_theme: Rc<ThemeConfig>,

    /// 当前主题模式
    pub mode: ThemeMode,

    /// 字体配置
    pub font_family: SharedString,
    pub font_size: Pixels,

    /// 圆角
    pub radius: Pixels,

    /// 滚动条显示
    pub scrollbar_show: ScrollbarShow,

    /// 语法高亮主题
    pub highlight_theme: Arc<HighlightTheme>,
}

pub enum ThemeMode {
    Light,
    Dark,
    System,
}

pub struct ThemeConfig {
    /// 背景色
    pub background: Hsla,
    /// 前景色
    pub foreground: Hsla,
    /// 边框色
    pub border: Hsla,
    /// 主要色
    pub primary: Hsla,
    /// 次要色
    pub secondary: Hsla,
    /// 强调色
    pub accent: Hsla,
    /// 成功色
    pub success: Hsla,
    /// 警告色
    pub warning: Hsla,
    /// 错误色
    pub error: Hsla,
    /// 信息色
    pub info: Hsla,
    /// 悬停色
    pub hover: Hsla,
    /// 激活色
    pub active: Hsla,
    /// 选中色
    pub selected: Hsla,
    /// 禁用色
    pub disabled: Hsla,
    /// 边框样式
    pub border: BorderStyle,
    /// 阴影
    pub shadow: Shadow,
}

/// 主题颜色
#[derive(Clone, Debug)]
pub struct ThemeColor {
    pub app_background: Hsla,
    pub sidebar_background: Hsla,
    pub panel_background: Hsla,
    pub editor_background: Hsla,
    pub status_bar_background: Hsla,
    pub title_bar_background: Hsla,
    // ...
}
```

### ActiveTheme Trait

```rust
// 主题 Trait，用于获取当前主题
pub trait ActiveTheme {
    fn theme(&self) -> &Theme;
}

impl ActiveTheme for AppContext {
    fn theme(&self) -> &Theme {
        Theme::global(self)
    }
}

// 使用示例
fn my_component(cx: &mut ViewContext<Self>) -> impl IntoElement {
    div()
        .bg(cx.theme().colors.background)
        .text_color(cx.theme().colors.foreground)
        .border_1()
        .border_color(cx.theme().colors.border)
}
```

## 核心组件

### Button 组件

```rust
// crates/ui/src/button/mod.rs

use gpui::{div, prelude::*, AnyElement, ViewContext};

pub struct Button {
    /// 按钮文本
    label: SharedString,
    /// 图标
    icon: Option<SharedString>,
    /// 变体
    variant: ButtonVariant,
    /// 尺寸
    size: ButtonSize,
    /// 是否加载中
    loading: bool,
    /// 是否禁用
    disabled: bool,
    /// 点击事件
    on_click: Arc<dyn Fn(&mut WindowContext)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonVariant {
    Primary,
    Secondary,
    Outline,
    Ghost,
    Danger,
    Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonSize {
    Small,
    Medium,
    Large,
}

impl Button {
    pub fn new(
        label: impl Into<SharedString>,
        on_click: impl Fn(&mut WindowContext) + 'static,
    ) -> Self {
        Self {
            label: label.into(),
            icon: None,
            variant: ButtonVariant::Primary,
            size: ButtonSize::Medium,
            loading: false,
            disabled: false,
            on_click: Arc::new(on_click),
        }
    }

    pub fn with_icon(mut self, icon: impl Into<SharedString>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: ButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl Render for Button {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        let variant_style = match self.variant {
            ButtonVariant::Primary => button_primary_style(cx),
            ButtonVariant::Secondary => button_secondary_style(cx),
            ButtonVariant::Outline => button_outline_style(cx),
            ButtonVariant::Ghost => button_ghost_style(cx),
            ButtonVariant::Danger => button_danger_style(cx),
            ButtonVariant::Link => button_link_style(cx),
        };

        let size_style = match self.size {
            ButtonSize::Small => button_sm_style(cx),
            ButtonSize::Medium => button_md_style(cx),
            ButtonSize::Large => button_lg_style(cx),
        };

        let disabled = self.disabled || self.loading;

        div()
            .id("button")
            .px_4()
            .py_2()
            .rounded-lg()
            .font_medium()
            .cursor(disabled.then_some(Cursor::NotAllowed))
            .text_color(disabled.then_some(cx.theme().colors.disabled))
            .bg(disabled.then_some(variant_style.bg).unwrap_or(variant_style.bg))
            .border_1()
            .border_color(disabled.then_some(cx.theme().colors.disabled).unwrap_or(variant_style.border))
            .transition()
            .when(!disabled, |this| {
                this.hover(|s| s.bg(variant_style.hover_bg))
                    .active(|s| s.bg(variant_style.active_bg))
            })
            .when(self.loading, |this| {
                this.child(
                    div()
                        .animate()
                        .spin()
                        .w_4()
                        .h_4()
                        .border_2()
                        .border_current()
                        .rounded_full()
                )
            })
            .when(!self.loading && self.icon.is_some(), |this| {
                this.child(div().child(self.icon.clone().unwrap()))
            })
            .when(!self.loading, |this| {
                this.on_click(move |_, cx| {
                    if !disabled {
                        (self.on_click)(cx);
                    }
                })
            })
            .child(self.label.clone())
    }
}

/// 便捷函数
pub fn button(
    label: impl Into<SharedString>,
    on_click: impl Fn(&mut WindowContext) + 'static,
) -> Button {
    Button::new(label, on_click)
}

pub fn primary_button(
    label: impl Into<SharedString>,
    on_click: impl Fn(&mut WindowContext) + 'static,
) -> Button {
    Button::new(label, on_click).variant(ButtonVariant::Primary)
}

pub fn secondary_button(
    label: impl Into<SharedString>,
    on_click: impl Fn(&mut WindowContext) + 'static,
) -> Button {
    Button::new(label, on_click).variant(ButtonVariant::Secondary)
}
```

### Input 组件

```rust
// crates/ui/src/input/mod.rs

use ropey::Rope;

pub struct Input {
    /// 绑定值
    value: SharedString,
    /// 占位符
    placeholder: SharedString,
    /// 是否只读
    readonly: bool,
    /// 是否禁用
    disabled: bool,
    /// 多行模式
    multiline: bool,
    /// 高度（多行模式）
    rows: usize,
    /// 焦点状态
    focused: bool,
    /// 事件
    on_change: Arc<dyn Fn(String, &mut WindowContext)>,
    on_focus: Arc<dyn Fn(&mut WindowContext)>,
    on_blur: Arc<dyn Fn(&mut WindowContext)>,
    on_enter: Arc<dyn Fn(&mut WindowContext)>,
}

impl Input {
    pub fn new(
        value: impl Into<SharedString>,
        on_change: impl Fn(String, &mut WindowContext) + 'static,
    ) -> Self {
        Self {
            value: value.into(),
            placeholder: "".into(),
            readonly: false,
            disabled: false,
            multiline: false,
            rows: 3,
            focused: false,
            on_change: Arc::new(on_change),
            on_focus: Arc::new(|_| {}),
            on_blur: Arc::new(|_| {}),
            on_enter: Arc::new(|_| {}),
        }
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn multiline(mut self, rows: usize) -> Self {
        self.multiline = true;
        self.rows = rows;
        self
    }
}

impl Render for Input {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        let theme = cx.theme();

        div()
            .w_full()
            .bg(theme.colors.surface)
            .border_1()
            .border_color(
                if self.focused {
                    theme.colors.primary
                } else {
                    theme.colors.border
                },
            )
            .rounded_md()
            .px_3()
            .py_2()
            .when(self.multiline, |this| this.min_h_10())
            .when(!self.multiline, |this| this.h_10())
            .child(
                if self.multiline {
                    TextArea::new(self.value.clone(), move |s, _| s)
                        .placeholder(self.placeholder.clone())
                        .disabled(self.disabled)
                        .on_change(self.on_change.clone())
                        .into_any_element()
                } else {
                    TextInput::new(self.value.clone(), move |s, _| s)
                        .placeholder(self.placeholder.clone())
                        .disabled(self.disabled)
                        .on_change(self.on_change.clone())
                        .into_any_element()
                }
            )
    }
}
```

### DataTable 组件

```rust
// crates/ui/src/table/data_table.rs

use std::collections::HashMap;

/// 表格列配置
pub struct TableColumn<T> {
    /// 列标题
    pub title: SharedString,
    /// 列宽
    pub width: Pixels,
    /// 渲染函数
    pub render: Arc<dyn Fn(&T, &mut WindowContext) -> AnyElement>,
    /// 是否可排序
    pub sortable: bool,
    /// 对齐方式
    pub align: Align,
}

/// 表格状态
pub struct DataTableState<T> {
    /// 数据
    data: Vec<T>,
    /// 排序字段
    sort_by: Option<String>,
    /// 排序方向
    sort_direction: SortDirection,
    /// 过滤文本
    filter: String,
    /// 分页
    pagination: Option<PaginationState>,
}

/// 分页状态
pub struct PaginationState {
    pub page: usize,
    pub page_size: usize,
    pub total: usize,
}

pub enum SortDirection {
    Asc,
    Desc,
}
```

### Dialog 组件

```rust
// crates/ui/src/dialog/mod.rs

pub struct Dialog {
    /// 标题
    title: SharedString,
    /// 内容
    content: AnyElement,
    /// 底部按钮
    actions: Vec<Button>,
    /// 是否模态
    modal: bool,
    /// 关闭回调
    on_close: Option<Arc<dyn Fn(&mut WindowContext)>>,
}

impl Dialog {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            content: div().into_any_element(),
            actions: vec![],
            modal: true,
            on_close: None,
        }
    }

    pub fn content(mut self, content: impl IntoElement) -> Self {
        self.content = content.into_any_element();
        self
    }

    pub fn action(mut self, button: Button) -> Self {
        self.actions.push(button);
        self
    }

    pub fn on_close(mut self, on_close: impl Fn(&mut WindowContext) + 'static) -> Self {
        self.on_close = Some(Arc::new(on_close));
        self
    }
}

impl Render for Dialog {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        let theme = cx.theme();

        // 遮罩层
        div()
            .absolute()
            .inset_0()
            .bg(theme.colors.overlay)
            .flex()
            .items_center()
            .justify_center()
            .when(self.modal, |this| this.on_click_stop_propagation())
            .child(
                // 对话框主体
                div()
                    .w_96()
                    .max_w_80percent()
                    .bg(theme.colors.surface)
                    .rounded_lg()
                    .shadow_lg()
                    .border_1()
                    .border_color(theme.colors.border)
                    .child(
                        div()
                            .px_4()
                            .py_3()
                            .border_b_1()
                            .border_color(theme.colors.border)
                            .child(
                                h3()
                                    .text_lg()
                                    .font_semibold()
                                    .text_color(theme.colors.foreground)
                                    .child(self.title.clone())
                            )
                    )
                    .child(
                        div()
                            .px_4()
                            .py_3()
                            .child(self.content.clone())
                    )
                    .child(
                        div()
                            .px_4()
                            .py_3()
                            .border_t_1()
                            .border_color(theme.colors.border)
                            .flex()
                            .justify_end()
                            .gap_2()
                            .children(self.actions.iter().map(|btn| btn.clone().into_any_element()))
                    )
            )
    }
}
```

## 组件化设计模式

### 无状态组件

```rust
// 使用 RenderOnce trait
impl RenderOnce for StatelessComponent {
    fn render(self, cx: &mut WindowContext) -> impl IntoElement {
        div()
            .bg(cx.theme().colors.surface)
            .child("Content")
    }
}
```

### 有状态组件

```rust
// 使用 Render trait
struct MyComponent {
    count: usize,
    text: SharedString,
}

impl Render for MyComponent {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .child(
                h1()
                    .text_2xl()
                    .font_bold()
                    .child("My Component")
            )
            .child(
                div()
                    .mt_4()
                    .child(format!("Count: {}", self.count))
            )
            .child(
                button("Increment", move |_, cx| {
                    self.count += 1;
                    cx.notify();
                })
            )
    }
}
```

## 样式系统

### 样式链式调用

```rust
div()
    // 尺寸
    .w_full()
    .h_10()
    .min_w_0()
    .max_w_80percent()

    // 间距
    .p_4()
    .px_4()
    .py_2()
    .m_auto()
    .mt_4()

    // 布局
    .flex()
    .flex_col()
    .items_center()
    .justify_center()
    .gap_4()
    .grid()
    .grid_cols_3()

    // 颜色
    .bg(cx.theme().colors.background)
    .text_color(cx.theme().colors.foreground)
    .border_color(cx.theme().colors.border)

    // 边框
    .border_1()
    .border_2()
    .border_t_1()
    .rounded_md()
    .rounded_lg()
    .rounded_full()

    // 阴影
    .shadow_sm()
    .shadow_md()
    .shadow_lg()

    // 交互
    .cursor_pointer()
    .transition()
    .hover(|s| s.bg(cx.theme().colors.hover))
    .active(|s| s.bg(cx.theme().colors.active))
    .focus(|s| s.border_color(cx.theme().colors.primary))

    // 动画
    .animate()
    .duration_150()
    .ease_in_out()
```

## 可复用代码

| 模块 | 路径 | 用途 |
|------|------|------|
| **主题系统** | `crates/ui/src/theme/` | 颜色、字体、样式 |
| **基础组件** | `crates/ui/src/button/input/` | 按钮、输入框 |
| **布局组件** | `crates/ui/src/dialog/dock/` | 对话框、停靠面板 |
| **数据组件** | `crates/ui/src/table/list/` | 表格、列表 |
| **表单组件** | `crates/ui/src/form/` | 表单验证 |
| **导航组件** | `crates/ui/src/navigation/` | 标签页、面包屑 |

## 在本项目中的使用

用于实现 agent-client 的所有 UI 界面：

```
agent-client (GPUI 应用)
    │
    ├── gpui-component (UI 组件库)
    │       │
    │       ├── 聊天对话界面 (List, Input, Button)
    │       ├── 设置界面 (Form, Select, Switch)
    │       ├── 关于界面 (Dialog, Card)
    │       ├── 依赖管理 (DataTable, Badge)
    │       └── 状态栏 (Icon, Tooltip)
    │
    └── 自定义组件
            ├── 连接状态指示器
            ├── ID/密码显示
            └── 主题切换
```

## 与 agent-client 集成场景

### 场景1：Tab 导航布局

```rust
// agent-client 主界面 Tab 导航

use gpui::{div, h1, h2, p, prelude::*, tabs, TabBar, TabPosition};

pub struct AgentClientApp {
    // 当前选中的 Tab
    active_tab: usize,
    // Tab 配置
    tabs: Vec<TabConfig>,
}

struct TabConfig {
    id: usize,
    title: &'static str,
    icon: &'static str,
    enabled: bool,
}

impl AgentClientApp {
    pub fn new() -> Self {
        Self {
            active_tab: 0,
            tabs: vec![
                TabConfig { id: 0, title: "Agent", icon: "agent_icon", enabled: cfg!(feature = "agent-chat") },
                TabConfig { id: 1, title: "Dependencies", icon: "deps_icon", enabled: true },
                TabConfig { id: 2, title: "Settings", icon: "settings_icon", enabled: true },
                TabConfig { id: 3, title: "About", icon: "about_icon", enabled: true },
            ],
        }
    }
}

impl Render for AgentClientApp {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .h_full()
            .w_full()
            .bg(cx.theme().colors.app_background)
            .child(
                // 顶部标题栏
                self.render_title_bar(cx)
            )
            .child(
                // Tab 导航
                self.render_tabs(cx)
            )
            .child(
                // Tab 内容区
                self.render_tab_content(cx)
            )
            .child(
                // 底部状态栏
                self.render_status_bar(cx)
            )
    }

    fn render_tabs(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_row()
            .bg(cx.theme().colors.surface)
            .border_b_1()
            .border_color(cx.theme().colors.border)
            .children(self.tabs.iter().filter(|t| t.enabled).enumerate().map(|(idx, tab)| {
                let tab_id = tab.id;
                let is_active = self.active_tab == tab_id;

                div()
                    .px_4()
                    .py_3()
                    .cursor_pointer()
                    .text_color(if is_active {
                        cx.theme().colors.primary
                    } else {
                        cx.theme().colors.foreground
                    })
                    .border_b_2()
                    .border_color(if is_active {
                        cx.theme().colors.primary
                    } else {
                        cx.transparent()
                    })
                    .font_medium()
                    .when(is_active, |this| this.bg(cx.theme().colors.hover))
                    .on_click(cx.listener(move |this, _, _cx| {
                        this.active_tab = tab_id;
                    }))
                    .child(tab.title)
            }))
    }

    fn render_tab_content(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex_1()
            .overflow_hidden()
            .child(match self.active_tab {
                0 => self.render_agent_tab(cx).into_any_element(),
                1 => self.render_dependencies_tab(cx).into_any_element(),
                2 => self.render_settings_tab(cx).into_any_element(),
                3 => self.render_about_tab(cx).into_any_element(),
                _ => div().into_any_element(),
            })
    }
}
```

### 场景2：连接状态指示器

```rust
// 连接状态组件

use crate::ui::{icon::Icon, tooltip::Tooltip};

pub struct ConnectionStatus {
    // 连接状态
    status: ConnectionState,
    // 最后更新时间
    last_update: DateTime<Utc>,
    // 提示文本
    tooltip_text: SharedString,
}

pub enum ConnectionState {
    Connected {
        mode: ConnectionMode,
        latency: u32,
    },
    Connecting,
    Disconnected {
        reason: DisconnectReason,
    },
    Error {
        message: String,
    },
}

pub enum ConnectionMode {
    P2P,
    Relay,
}

pub enum DisconnectReason {
    NetworkUnavailable,
    ServerUnreachable,
    AuthenticationFailed,
    SessionTimeout,
}

impl ConnectionStatus {
    pub fn new() -> Self {
        Self {
            status: ConnectionState::Disconnected {
                reason: DisconnectReason::NetworkUnavailable,
            },
            last_update: Utc::now(),
            tooltip_text: "Disconnected".into(),
        }
    }

    /// 更新连接状态
    pub fn update_status(&mut self, status: ConnectionState) {
        self.status = status;
        self.last_update = Utc::now();
        self.tooltip_text = self.generate_tooltip_text();
    }

    fn generate_tooltip_text(&self) -> SharedString {
        match &self.status {
            ConnectionState::Connected { mode, latency } => {
                match mode {
                    ConnectionMode::P2P => format!("Connected (P2P) - {}ms", latency),
                    ConnectionMode::Relay => format!("Connected (Relay) - {}ms", latency),
                }
            }
            ConnectionState::Connecting => "Connecting...".into(),
            ConnectionState::Disconnected { reason } => {
                match reason {
                    DisconnectReason::NetworkUnavailable => "No network connection",
                    DisconnectReason::ServerUnreachable => "Cannot reach server",
                    DisconnectReason::AuthenticationFailed => "Authentication failed",
                    DisconnectReason::SessionTimeout => "Session timed out",
                }.into()
            }
            ConnectionState::Error { message } => message.as_str().into(),
        }
    }
}

impl Render for ConnectionStatus {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        let (icon, color) = match &self.status {
            ConnectionState::Connected { mode, .. } => (
                match mode {
                    ConnectionMode::P2P => "wifi",
                    ConnectionMode::Relay => "relay",
                },
                cx.theme().colors.success,
            ),
            ConnectionState::Connecting => ("loading", cx.theme().colors.info),
            ConnectionState::Disconnected { .. } => ("offline", cx.theme().colors.error),
            ConnectionState::Error { .. } => ("error", cx.theme().colors.warning),
        };

        Tooltip::new(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    Icon::new(icon)
                        .size(IconSize::Small)
                        .color(color)
                )
                .child(
                    // 状态文字
                    div()
                        .text_sm()
                        .text_color(color)
                        .child(self.tooltip_text.clone())
                ),
            self.tooltip_text.clone()
        )
    }
}

/// 状态栏组件
pub struct StatusBar {
    // 连接状态
    connection_status: View<ConnectionStatus>,
    // 客户端 ID
    client_id: SharedString,
    // 当前时间
    current_time: SharedString,
}

impl Render for StatusBar {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .px_4()
            .py_2()
            .h_10()
            .bg(cx.theme().colors.status_bar_background)
            .border_t_1()
            .border_color(cx.theme().colors.border)
            .child(
                // 左侧：客户端 ID
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        Icon::new("id")
                            .size(IconSize::Small)
                            .color(cx.theme().colors.muted)
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().colors.muted)
                            .child(format!("ID: {}", self.client_id))
                    )
            )
            .child(
                // 中间：连接状态
                self.connection_status.clone()
            )
            .child(
                // 右侧：当前时间
                div()
                    .text_sm()
                    .text_color(cx.theme().colors.muted)
                    .child(self.current_time.clone())
            )
    }
}
```

### 场景3：ID/密码显示组件

```rust
// 客户端 ID 和密码显示

pub struct IdPasswordDisplay {
    // 客户端 ID
    client_id: SharedString,
    // 密码（是否显示）
    password_masked: bool,
    // 当前密码
    password: SharedString,
}

impl IdPasswordDisplay {
    pub fn new(client_id: &str, password: &str) -> Self {
        Self {
            client_id: client_id.into(),
            password: password.into(),
            password_masked: true,
        }
    }

    /// 复制 ID 到剪贴板
    pub fn copy_id(&self, cx: &mut WindowContext) {
        cx.write_to_clipboard(ClipboardItem::new(self.client_id.to_string()));
    }

    /// 复制密码到剪贴板
    pub fn copy_password(&self, cx: &mut WindowContext) {
        cx.write_to_clipboard(ClipboardItem::new(self.password.to_string()));
    }

    /// 切换密码可见性
    pub fn toggle_password_visibility(&mut self) {
        self.password_masked = !self.password_masked;
    }

    /// 修改密码
    pub fn update_password(&mut self, new_password: &str) {
        self.password = new_password.into();
    }
}

impl Render for IdPasswordDisplay {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap_6()
            .p_6()
            .rounded_lg()
            .bg(cx.theme().colors.surface)
            .border_1()
            .border_color(cx.theme().colors.border)
            .child(
                // ID 显示区
                self.render_id_section(cx)
            )
            .child(
                // 密码显示区
                self.render_password_section(cx)
            )
    }

    fn render_id_section(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .font_medium()
                    .text_color(cx.theme().colors.muted)
                    .child("Your Client ID")
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .p_3()
                    .rounded_md()
                    .bg(cx.theme().colors.editor_background)
                    .child(
                        div()
                            .text_xl()
                            .font_bold()
                            .font_mono()
                            .text_color(cx.theme().colors.foreground)
                            .child(self.client_id.clone())
                    )
                    .child(
                        Button::new("copy-id", cx, |_, cx| {
                            self.copy_id(cx);
                        })
                        .icon("copy")
                        .variant(ButtonVariant::Ghost)
                        .into_any_element()
                    )
            )
    }

    fn render_password_section(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .font_medium()
                    .text_color(cx.theme().colors.muted)
                    .child("Access Password")
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .p_3()
                    .rounded_md()
                    .bg(cx.theme().colors.editor_background)
                    .child(
                        div()
                            .text_lg()
                            .font_mono()
                            .text_color(cx.theme().colors.foreground)
                            .child(if self.password_masked {
                                "••••••••".to_string()
                            } else {
                                self.password.clone()
                            })
                    )
                    .child(
                        Button::new("toggle-visibility", cx, |_, _| {
                            self.toggle_password_visibility();
                        })
                        .icon(if self.password_masked { "eye" } else { "eye-off" })
                        .variant(ButtonVariant::Ghost)
                        .into_any_element()
                    )
                    .child(
                        Button::new("copy-password", cx, |_, cx| {
                            self.copy_password(cx);
                        })
                        .icon("copy")
                        .variant(ButtonVariant::Ghost)
                        .into_any_element()
                    )
            )
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().colors.warning)
                    .child("Share this password with administrators to allow remote access")
            )
    }
}
```

### 场景4：依赖管理界面

```rust
// 依赖管理 Tab

pub struct DependenciesTab {
    // 依赖列表状态
    dependencies: Vec<DependencyInfo>,
    // 正在安装的依赖
    installing: Arc<DashMap<String, f32>>, // name -> progress
    // 刷新任务
    refresh_task: Option<Task<()>>,
}

pub struct DependencyInfo {
    pub name: String,
    pub display_name: String,
    pub version: Option<String>,
    pub source: DependencySource,
    pub status: DependencyStatus,
    pub required_version: Option<String>,
    pub install_command: Option<String>,
}

pub enum DependencySource {
    System,      // 系统全局
    Client,      // 客户端隔离目录
    NotInstalled,
}

pub enum DependencyStatus {
    Installed,
    Installing { progress: f32 },
    NotInstalled,
    UpdateAvailable { current: String, latest: String },
    Error { message: String },
}

impl DependenciesTab {
    pub fn new() -> Self {
        let mut this = Self {
            dependencies: Vec::new(),
            installing: Arc::new(DashMap::new()),
            refresh_task: None,
        };
        this.refresh_dependencies();
        this
    }

    /// 刷新依赖状态
    pub fn refresh_dependencies(&mut self) {
        let installing = self.installing.clone();
        self.refresh_task = Some(cx.spawn(|this, mut cx| async move {
            // 模拟检查依赖状态
            let deps = vec![
                DependencyInfo {
                    name: "node".into(),
                    display_name: "Node.js".into(),
                    version: Some("v20.10.0".into()),
                    source: DependencySource::System,
                    status: DependencyStatus::Installed,
                    required_version: Some(">=18.0.0".into()),
                    install_command: None,
                },
                DependencyInfo {
                    name: "npm".into(),
                    display_name: "npm".into(),
                    version: Some("10.2.0".into()),
                    source: DependencySource::System,
                    status: DependencyStatus::Installed,
                    required_version: None,
                    install_command: None,
                },
                DependencyInfo {
                    name: "opencode".into(),
                    display_name: "opencode".into(),
                    version: None,
                    source: DependencySource::NotInstalled,
                    status: DependencyStatus::NotInstalled,
                    required_version: None,
                    install_command: Some("npm install -g opencode".into()),
                },
            ];

            this.update(&mut cx, |this, _| {
                this.dependencies = deps;
            });
        }));
    }

    /// 安装依赖
    pub fn install_dependency(&mut self, name: &str) {
        let name = name.to_string();
        let installing = self.installing.clone();

        cx.spawn(|this, mut cx| async move {
            installing.insert(name.clone(), 0.0);

            // 模拟安装过程
            for i in 0..=100 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                installing.insert(name.clone(), i as f32 / 100.0);
            }

            installing.remove(&name);

            this.update(&mut cx, |this, _| {
                this.refresh_dependencies();
            });
        });
    }
}

impl Render for DependenciesTab {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .h_full()
            .p_6()
            .gap_4()
            .child(
                // 标题和操作
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        h2()
                            .text-xl()
                            .font_semibold()
                            .child("Dependency Management")
                    )
                    .child(
                        Button::new("refresh", cx, |_, _| {
                            self.refresh_dependencies();
                        })
                        .icon("refresh")
                        .variant(ButtonVariant::Secondary)
                    )
            )
            .child(
                // 依赖列表
                DataTable::new()
                    .columns(vec![
                        TableColumn::new("name", "Name", px(200.), |d: &DependencyInfo, _| {
                            div().child(d.display_name.clone()).into_any_element()
                        }),
                        TableColumn::new("version", "Version", px(150.), |d: &DependencyInfo, _| {
                            div().child(d.version.clone().unwrap_or("-".into())).into_any_element()
                        }),
                        TableColumn::new("source", "Source", px(120.), |d: &DependencyInfo, _| {
                            let source_label = match d.source {
                                DependencySource::System => "System",
                                DependencySource::Client => "Client",
                                DependencySource::NotInstalled => "-",
                            };
                            div()
                                .text_sm()
                                .text_color(cx.theme().colors.muted)
                                .child(source_label)
                                .into_any_element()
                        }),
                        TableColumn::new("status", "Status", px(150.), |d: &DependencyInfo, _| {
                            self.render_status_badge(d, cx).into_any_element()
                        }),
                        TableColumn::new("actions", "Actions", px(200.), |d: &DependencyInfo, _| {
                            self.render_action_buttons(d, cx).into_any_element()
                        }),
                    ])
                    .items(self.dependencies.clone())
            )
    }

    fn render_status_badge(&self, dep: &DependencyInfo, cx: &mut WindowContext) -> impl IntoElement {
        match &dep.status {
            DependencyStatus::Installed => Badge::new("Installed")
                .variant(BadgeVariant::Success),
            DependencyStatus::Installing { progress } => Badge::new(&format!("Installing {:.0}%", progress * 100.0))
                .variant(BadgeVariant::Info),
            DependencyStatus::NotInstalled => Badge::new("Not Installed")
                .variant(BadgeVariant::Warning),
            DependencyStatus::UpdateAvailable { current, latest } => Badge::new(&format!("Update to {}", latest))
                .variant(BadgeVariant::Secondary),
            DependencyStatus::Error { message } => Badge::new(message)
                .variant(BadgeVariant::Danger),
        }
    }

    fn render_action_buttons(&self, dep: &DependencyInfo, cx: &mut WindowContext) -> impl IntoElement {
        match &dep.status {
            DependencyStatus::Installed => div()
                .flex()
                .gap_2()
                .child(
                    Button::new("update", cx, |_, _| {})
                        .icon("download")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                )
                .child(
                    Button::new("uninstall", cx, |_, _| {})
                        .icon("trash")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                ),
            DependencyStatus::NotInstalled => Button::new("install", cx, |_, _| {
                self.install_dependency(&dep.name);
            })
                .icon("install")
                .variant(ButtonVariant::Primary)
                .size(ButtonSize::Small),
            DependencyStatus::Installing { .. } => Button::new("cancel", cx, |_, _| {})
                .icon("x")
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small),
            _ => div(),
        }
    }
}
```

### 场景5：设置界面

```rust
// 设置 Tab

pub struct SettingsTab {
    // data-server 配置
    server_address: SharedString,
    // 自动启动
    auto_launch: bool,
    // 主题模式
    theme_mode: ThemeMode,
    // 工作目录
    work_directory: SharedString,
}

impl SettingsTab {
    pub fn new() -> Self {
        Self {
            server_address: "hbbs.example.com:21116".into(),
            auto_launch: false,
            theme_mode: ThemeMode::System,
            work_directory: "~/.nuwax-agent".into(),
        }
    }
}

impl Render for SettingsTab {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        Form::new()
            .section(
                FormSection::new("Server Configuration")
                    .description("Configure the data-server connection")
                    .child(
                        FormItem::new("Server Address")
                            .input(Input::new(self.server_address.clone(), |s, _| {
                                self.server_address = s.into();
                            }).placeholder("hbbs.example.com:21116"))
                    )
                    .child(
                        FormItem::new("Relay Server")
                            .input(Input::new("", |_, _| {}).placeholder("hbbr.example.com:21117"))
                    )
            )
            .section(
                FormSection::new("Startup")
                    .child(
                        FormItem::new("Auto Launch")
                            .description("Start the application when system boots")
                            .control(
                                Switch::new(self.auto_launch, |enabled, _| {
                                    self.auto_launch = enabled;
                                })
                            )
                    )
            )
            .section(
                FormSection::new("Appearance")
                    .child(
                        FormItem::new("Theme")
                            .control(
                                Select::new(vec![
                                    ("Light", "light"),
                                    ("Dark", "dark"),
                                    ("System", "system"),
                                ], &format!("{:?}", self.theme_mode))
                            )
                    )
            )
            .section(
                FormSection::new("Files")
                    .child(
                        FormItem::new("Work Directory")
                            .description("Directory for storing files and cache")
                            .input(Input::new(self.work_directory.clone(), |s, _| {
                                self.work_directory = s.into();
                            }))
                    )
            )
            .action(
                Button::new("save", cx, |_, _| {
                    // 保存设置
                })
                    .icon("save")
                    .variant(ButtonVariant::Primary)
            )
    }
}
```

### 场景6：关于对话框

```rust
// 关于 Tab

pub struct AboutTab {
    // 版本信息
    version: String,
    // 构建信息
    build_info: String,
}

impl AboutTab {
    pub fn new() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            build_info: format!("Built on {}", chrono::Utc::now().format("%Y-%m-%d")),
        }
    }
}

impl Render for AboutTab {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .items_center()
            .gap_6()
            .p_8()
            .child(
                // 应用图标
                div()
                    .w_24()
                    .h_24()
                    .rounded_xl()
                    .bg(cx.theme().colors.primary)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        Icon::new("app_logo")
                            .size(IconSize::Large)
                            .color(gpui::white())
                    )
            )
            .child(
                // 应用名称
                h1()
                    .text_2xl()
                    .font_bold()
                    .child("nuwax-agent")
            )
            .child(
                // 版本信息
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().colors.muted)
                            .child(format!("Version {}", self.version))
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().colors.muted)
                            .child(self.build_info.clone())
                    )
            )
            .child(
                // 链接
                div()
                    .flex()
                    .gap_4()
                    .child(
                        Link::new("Website", "https://example.com")
                    )
                    .child(
                        Link::new("Documentation", "https://docs.example.com")
                    )
                    .child(
                        Link::new("Report Issue", "https://github.com/example/issues")
                    )
            )
            .child(
                // 许可证
                div()
                    .text_sm()
                    .text_color(cx.theme().colors.muted)
                    .child("Licensed under MIT License")
            )
    }
}
```
