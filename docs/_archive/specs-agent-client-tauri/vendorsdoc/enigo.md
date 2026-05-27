# enigo

## 项目概述

跨平台键盘鼠标输入模拟库，支持 Linux (X11/Wayland)、Windows、macOS 和 BSD。

**GitHub**: https://github.com/enigo-rs/enigo
**本地路径**: `vendors/enigo`

## 目录结构

```
enigo/
├── src/
│   ├── lib.rs                    # 公共 API 和 Trait 定义
│   ├── platform.rs               # 平台抽象
│   ├── keycodes.rs               # 键码定义
│   ├── agent.rs                  # Token/Agent 模式
│   ├── errors.rs                 # 错误定义
│   ├── tests/                    # 测试用例
│   │   ├── keyboard.rs
│   │   ├── mouse.rs
│   │   └── text.rs
│   ├── linux/                    # Linux 实现
│   │   ├── mod.rs                # 模块入口
│   │   ├── x11.rs                # X11 实现 (x11rb)
│   │   ├── xdo.rs                # xdo 实现
│   │   ├── wayland.rs            # Wayland 实现
│   │   ├── libei.rs              # libei 实现
│   │   ├── keymap2.rs            # 键码映射
│   │   └── keyboard.rs           # 键盘布局
│   ├── macos/                    # macOS 实现
│   │   ├── mod.rs
│   │   ├── macos_impl.rs         # CoreGraphics 实现
│   │   └── key_layout.rs         # 键盘布局
│   ├── win/                      # Windows 实现
│   │   ├── mod.rs
│   │   ├── win_impl.rs           # SendInput 实现
│   │   └── key_codes.rs          # 虚拟键码
│   └── freebsd/                  # FreeBSD 实现
│       └── mod.rs
├── Cargo.toml
└── README.md
```

## 核心依赖

```toml
[dependencies]
# 平台 API
windows = "0.48"
core-foundation = "0.9"
core-graphics = "0.22"
objc2 = "0.5"

# Linux 平台
x11rb = { version = "0.13", optional = true }
wayland-client = { version = "0.31", optional = true }
ashpd = { version = "0.4", optional = true }
reis = { version = "0.3", optional = true }
libei = { version = "0.3", optional = true }

# 运行时支持
smol = { version = "2.0", optional = true }
tokio = { version = "1.0", optional = true, features = ["rt", "rt-multi-thread", "time"] }

[features]
default = ["smol-runtime"]
smol-runtime = ["smol", "reis"]
tokio-runtime = ["tokio", "reis"]
x11rb = ["x11rb", "reis"]
xdo = ["xdo"]
wayland = ["wayland-client", "reis", "ashpd"]
libei = ["libei", "reis"]
```

## 核心 Trait 和结构体

### Keyboard Trait

```rust
// src/lib.rs

/// 键盘操作 Trait
pub trait Keyboard {
    /// 发送文本（Unicode 支持）
    fn text(&mut self, text: &str) -> InputResult<()>;

    /// 发送单个按键
    fn key(&mut self, key: Key, direction: Direction) -> InputResult<()>;

    /// 发送原始键码
    fn raw(&mut self, keycode: u16, direction: Direction) -> InputResult<()>;

    /// 获取可打印字符
    fn get_char(&self, key: Key, direction: Direction) -> Option<char>;
}
```

### Mouse Trait

```rust
/// 鼠标操作 Trait
pub trait Mouse {
    /// 鼠标按钮点击
    fn button(&mut self, button: Button, direction: Direction) -> InputResult<()>;

    /// 移动鼠标到绝对位置
    fn move_mouse(&mut self, x: i32, y: i32, coordinate: Coordinate) -> InputResult<()>;

    /// 移动鼠标（相对位移）
    fn move_mouse_relative(&mut self, x: i32, y: i32) -> InputResult<()>;

    /// 滚动
    fn scroll(&mut self, length: i32, axis: Axis) -> InputResult<()>;

    /// 水平滚动
    fn scroll_x(&mut self, length: i32) -> InputResult<()> {
        self.scroll(length, Axis::Horizontal)
    }

    /// 垂直滚动
    fn scroll_y(&mut self, length: i32) -> InputResult<()> {
        self.scroll(length, Axis::Vertical)
    }

    /// 获取主显示器尺寸
    fn main_display(&self) -> InputResult<(i32, i32)>;

    /// 获取鼠标当前位置
    fn location(&self) -> InputResult<(i32, i32)>;
}
```

### 主结构体

```rust
/// 主入口结构体
pub struct Enigo {
    keyboard: Box<dyn Keyboard + Send>,
    mouse: Box<dyn Mouse + Send>,
}

impl Enigo {
    /// 创建新的 Enigo 实例
    pub fn new(settings: &Settings) -> Self {
        let keyboard = create_keyboard(settings);
        let mouse = create_mouse(settings);
        Self { keyboard, mouse }
    }
}

pub struct Settings {
    /// 跳过的初始化检查
    pub skip_init: bool,
    /// 键盘设置
    pub keyboard: KeyboardSettings,
    /// 鼠标设置
    pub mouse: MouseSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            skip_init: false,
            keyboard: KeyboardSettings::default(),
            mouse: MouseSettings::default(),
        }
    }
}
```

## Key 键码定义

```rust
// src/keycodes.rs

/// 特殊键枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    // 修饰键
    Control,
    Alt,
    Shift,
    AltGr,
    Super,      // Windows/Cmd

    // 功能键
    Function(Fn),  // F1-F24

    // 布局相关字符
    Layout(char),  // 基于当前键盘布局的字符

    // Unicode 字符
    Unicode(char),

    // 特殊键
    Space,
    Enter,
    Tab,
    Escape,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,

    // 方向键
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,

    // 数字行
    F1, F2, F3, F4, F5, F6,
    F7, F8, F9, F10, F11, F12,
    F13, F14, F15, F16,
    F17, F18, F19, F20,
    F21, F22, F23, F24,

    // 音频键
    VolumeUp,
    VolumeDown,
    VolumeMute,

    // 媒体键
    MediaNextTrack,
    MediaPreviousTrack,
    MediaPlay,
    MediaStop,

    // 小键盘
    NumLock,
    Numpad0, Numpad1, Numpad2, Numpad3, Numpad4,
    Numpad5, Numpad6, Numpad7, Numpad8, Numpad9,
    NumpadAdd,
    NumpadSubtract,
    NumpadMultiply,
    NumpadDivide,
    NumpadEnter,
    NumpadDecimal,
}

pub enum Fn {
    F1, F2, F3, F4, F5, F6,
    F7, F8, F9, F10, F11, F12,
    F13, F14, F15, F16,
    F17, F18, F19, F20,
    F21, F22, F23, F24,
}

/// 转换为虚拟键码
impl From<Key> for KeyCode<'_> {
    fn from(key: Key) -> Self {
        match key {
            Key::Control => Self::Control,
            Key::Alt => Self::Alt,
            Key::Shift => Self::Shift,
            Key::Super => Self::Super,
            // ...
        }
    }
}
```

## Direction 和 Button

```rust
/// 按键方向
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Click,   // 点击（按下 + 释放）
    Down,    // 按下
    Up,      // 释放
}

/// 鼠标按钮
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Button {
    Left,
    Right,
    Middle,
    Back,     // 浏览器后退
    Forward,  // 浏览器前进
}

/// 滚动轴
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Horizontal,
    Vertical,
}

/// 坐标系统
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Coordinate {
    Absolute,   // 绝对坐标（屏幕位置）
    Relative,   // 相对坐标（位移）
}
```

## 平台实现详情

### Windows 实现

```rust
// src/win/win_impl.rs

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYBDEVENTFLAGS,
    VkKeyScanW, MapVirtualKeyExW, ToUnicodeEx,
};

pub struct EnigoWindows {
    // 键盘布局
    layout: HKL,
    // 状态
    state: Vec<u8>,
}

impl Keyboard for EnigoWindows {
    fn key(&mut self, key: Key, direction: Direction) -> InputResult<()> {
        let vk = key_to_virtual_key(key, self.layout)?;
        let flags = match direction {
            Direction::Down => KEYBDEVENTFLAGS::empty(),
            Direction::Up => KEYBDEVENTFLAGS::KEYEVENTF_KEYUP,
            Direction::Click => {
                self.key(key, Direction::Down)?;
                self.key(key, Direction::Up)?;
                return Ok(());
            }
        };

        let input = INPUT {
            type_: INPUT_TYPE::INPUT_KEYBOARD,
            Anonymous: input_ki!(vk, 0, flags),
        };

        unsafe {
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }

        Ok(())
    }

    fn text(&mut self, text: &str) -> InputResult<()> {
        // 使用 ToUnicodeEx 处理 Unicode 输入
        let context = 0; // 不获取上下文
        let flags = 0;

        for c in text.chars() {
            let mut buffer = [0u16; 5];
            let len = unsafe {
                ToUnicodeEx(
                    VkKeyScanW(c as u16),
                    0,  // 扫描码
                    &mut [0u8; 256],
                    buffer.as_mut_ptr(),
                    buffer.len() as i32,
                    flags,
                    self.layout,
                )
            };

            if len > 0 {
                for i in 0..len as usize {
                    let vk = buffer[i];
                    self.key(Key::Unicode(c), Direction::Down)?;
                    self.key(Key::Unicode(c), Direction::Up)?;
                }
            }
        }

        Ok(())
    }
}

impl Mouse for EnigoWindows {
    fn move_mouse(&mut self, x: i32, y: i32, coordinate: Coordinate) -> InputResult<()> {
        match coordinate {
            Coordinate::Absolute => {
                // 绝对位置 - 使用 MOUSEINPUT
                let input = INPUT {
                    type_: INPUT_TYPE::INPUT_MOUSE,
                    Anonymous: input_mi!(x, y, 0, MOUSEEVENTF_MOVE, 0),
                };
                unsafe {
                    SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
            }
            Coordinate::Relative => {
                // 相对位移
                let input = INPUT {
                    type_: INPUT_TYPE::INPUT_MOUSE,
                    Anonymous: input_mi!(x, y, 0, MOUSEEVENTF_MOVE, 0),
                };
                unsafe {
                    SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
            }
        }

        Ok(())
    }

    fn button(&mut self, button: Button, direction: Direction) -> InputResult<()> {
        let (flags, data) = match (button, direction) {
            (Button::Left, Direction::Down) => (MOUSEEVENTF_LEFTDOWN, 0),
            (Button::Left, Direction::Up) => (MOUSEEVENTF_LEFTUP, 0),
            (Button::Right, Direction::Down) => (MOUSEEVENTF_RIGHTDOWN, 0),
            (Button::Right, Direction::Up) => (MOUSEEVENTF_RIGHTUP, 0),
            (Button::Middle, Direction::Down) => (MOUSEEVENTF_MIDDLEDOWN, 0),
            (Button::Middle, Direction::Up) => (MOUSEEVENTF_MIDDLEUP, 0),
            _ => return Err(Error::Unimplemented),
        };

        let input = INPUT {
            type_: INPUT_TYPE::INPUT_MOUSE,
            Anonymous: input_mi!(0, 0, 0, flags, data),
        };

        unsafe {
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }

        Ok(())
    }

    fn scroll(&mut self, length: i32, axis: Axis) -> InputResult<()> {
        let flags = match axis {
            Axis::Vertical => MOUSEEVENTF_WHEEL,
            Axis::Horizontal => MOUSEEVENTF_HWHEEL,
        };

        let input = INPUT {
            type_: INPUT_TYPE::INPUT_MOUSE,
            Anonymous: input_mi!(0, 0, length as i16, flags, 0),
        };

        unsafe {
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }

        Ok(())
    }
}
```

### macOS 实现

```rust
// src/macos/macos_impl.rs

use core_foundation::base::{TCFType, CFTypeRef};
use core_graphics::display::{CGDisplay, CGPoint, CGRect};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, ProtocolObject};
use objc2_foundation::{NSInteger, NSUInteger};

pub struct EnigoMac {
    // CGEventSource
    source: Retained<ProtocolObject<dyn CGEventSourceProtocol>>,
    // 键盘布局
    layout: TISInputSourceRef,
}

impl Keyboard for EnigoMac {
    fn key(&mut self, key: Key, direction: Direction) -> InputResult<()> {
        let (keycode, flags) = key_to_keycode_and_flags(key, self.layout)?;

        let event_type = match direction {
            Direction::Down => CGEventType::KeyDown,
            Direction::Up => CGEventType::KeyUp,
            Direction::Click => {
                self.key(key, Direction::Down)?;
                self.key(key, Direction::Up)?;
                return Ok(());
            }
        };

        let event = CGEvent::new_keyboard_event(self.source.as_ref(), event_type, keycode, true)?;
        event.set_flags(flags);

        unsafe {
            CGEventPost(CGEventSourceStateID::HIDState, event.as_ref());
        }

        Ok(())
    }

    fn text(&mut self, text: &str) -> InputResult<()> {
        for c in text.chars() {
            let event = CGEvent::new_keyboard_event(
                self.source.as_ref(),
                CGEventType::KeyDown,
                c as u64,
                true,
            )?;

            // 设置 Unicode 内容
            event.set_keyboard_type(0); // 使用当前键盘类型
            event.set_string(c.to_string());

            unsafe {
                CGEventPost(CGEventSourceStateID::HIDState, event.as_ref());
            }
        }

        Ok(())
    }
}

impl Mouse for EnigoMac {
    fn button(&mut self, button: Button, direction: Direction) -> InputResult<()> {
        let (button_num, event_type) = match (button, direction) {
            (Button::Left, Direction::Down) => (0, CGEventType::LeftMouseDown),
            (Button::Left, Direction::Up) => (0, CGEventType::LeftMouseUp),
            (Button::Right, Direction::Down) => (1, CGEventType::RightMouseDown),
            (Button::Right, Direction::Up) => (1, CGEventType::RightMouseUp),
            (Button::Middle, Direction::Down) => (2, CGEventType::OtherMouseDown),
            (Button::Middle, Direction::Up) => (2, CGEventType::OtherMouseUp),
            _ => return Err(Error::Unimplemented),
        };

        let point = CGEvent::get_location(self.mouse_event.as_ref().unwrap());
        let event = CGEvent::new_mouse_event(
            self.source.as_ref(),
            event_type,
            point,
            button_num,
        )?;

        unsafe {
            CGEventPost(CGEventSourceStateID::HIDState, event.as_ref());
        }

        Ok(())
    }

    fn move_mouse(&mut self, x: i32, y: i32, coordinate: Coordinate) -> InputResult<()> {
        let point = CGPoint::new(x as f64, y as f64);

        let event_type = match coordinate {
            Coordinate::Absolute => CGEventType::MouseMoved,
            Coordinate::Relative => CGEventType::MouseMoved,
        };

        let event = CGEvent::new_mouse_event(self.source.as_ref(), event_type, point, 0)?;

        unsafe {
            CGEventPost(CGEventSourceStateID::HIDState, event.as_ref());
        }

        Ok(())
    }

    fn scroll(&mut self, length: i32, axis: Axis) -> InputResult<()> {
        let (scroll_type, wheel_count) = match axis {
            Axis::Vertical => (CGEventType::Wheel, 1),
            Axis::Horizontal => (CGEventType::Wheel, 2),
        };

        let point = CGEvent::get_location(self.mouse_event.as_ref().unwrap());
        let event = CGEvent::new_scroll_event(
            self.source.as_ref(),
            scroll_type,
            CGScrollEventUnit::Pixel,
            wheel_count as i32,
            length as i32,
            0,
        )?;

        unsafe {
            CGEventPost(CGEventSourceStateID::HIDState, event.as_ref());
        }

        Ok(())
    }
}
```

### Linux X11 实现

```rust
// src/linux/x11.rs

use x11rb::connection::Connection;
use x11rb::protocol::xproto::*;
use x11rb::wrapper::ConnectionExt as _;

pub struct EnigoX11<'a, C: Connection> {
    conn: &'a C,
    screen: usize,
    root: Window,
    // 键盘状态
    keyboard_state: Vec<u8>,
    // 修饰键状态
    modifiers: ModifiersState,
}

impl<C: Connection> Keyboard for EnigoX11<'_, C> {
    fn key(&mut self, key: Key, direction: Direction) -> InputResult<()> {
        let keycode = self.key_to_keycode(key)?;

        let event_detail = match direction {
            Direction::Down => keycode,
            Direction::Up => keycode + 8, // X11: keyup = keycode + 8
            Direction::Click => {
                self.key(key, Direction::Down)?;
                self.key(key, Direction::Up)?;
                return Ok(());
            }
        };

        let event = InputEvent::new(
            self.conn.get_input_focus().reply()?.focus,
            event_detail,
            self.root,
            state: self.get_current_state(),
            event_type: match direction {
                Direction::Down => EventType::KEY_PRESS,
                Direction::Up => EventType::KEY_RELEASE,
                _ => unreachable!(),
            },
        );

        self.conn.send_event(false, event, EventType::KEY_PRESS as u8)?;

        Ok(())
    }
}

impl<C: Connection> Mouse for EnigoX11<'_, C> {
    fn move_mouse(&mut self, x: i32, y: i32, coordinate: Coordinate) -> InputResult<()> {
        let (root_x, root_y) = match coordinate {
            Coordinate::Absolute => {
                // 转换屏幕坐标
                (x, y)
            }
            Coordinate::Relative => {
                // 相对位移需要获取当前位置
                let (current_x, _) = self.query_pointer()?;
                (current_x + x, y)
            }
        };

        let event = InputEvent::new(
            self.root,
            EventType::MOTION_NOTIFY,
            self.root,
            root_x as u16,
            root_y as u16,
            state: self.get_current_state(),
        );

        self.conn.send_event(false, event, EventType::MOTION_NOTIFY as u8)?;

        Ok(())
    }

    fn button(&mut self, button: Button, direction: Direction) -> InputResult<()> {
        let button_code = button_to_x11(button)?;

        let event = InputEvent::new(
            self.root,
            match direction {
                Direction::Down => EventType::BUTTON_PRESS,
                Direction::Up => EventType::BUTTON_RELEASE,
                Direction::Click => {
                    self.button(button, Direction::Down)?;
                    self.button(button, Direction::Up)?;
                    return Ok(());
                }
            },
            self.root,
            0, 0,
            state: self.get_current_state(),
            detail: button_code,
        );

        self.conn.send_event(false, event, EventType::BUTTON_PRESS as u8)?;

        Ok(())
    }

    fn scroll(&mut self, length: i32, axis: Axis) -> InputResult<()> {
        let button = match axis {
            Axis::Vertical => {
                if length > 0 { ButtonCode::4 } else { ButtonCode::5 }
            }
            Axis::Horizontal => {
                if length > 0 { ButtonCode::6 } else { ButtonCode::7 }
            }
        };

        let event = InputEvent::new(
            self.root,
            EventType::BUTTON_PRESS,
            self.root,
            0, 0,
            state: self.get_current_state(),
            detail: button as u16,
        );

        self.conn.send_event(false, event, EventType::BUTTON_PRESS as u8)?;

        Ok(())
    }
}
```

## 使用示例

```rust
use enigo::{Enigo, Key, Button, Direction, Coordinate, KeyboardControllable, MouseControllable};

fn main() {
    let mut enigo = Enigo::new(&enigo::Settings::default());

    // 键盘模拟
    enigo.key_click(Key::Space);
    enigo.key_down(Key::Control);
    enigo.key_click(Key::C);
    enigo.key_up(Key::Control);

    // 文本输入
    enigo.text("Hello, World!");

    // 鼠标移动（绝对位置）
    enigo.move_mouse(100, 200, Coordinate::Absolute);

    // 鼠标移动（相对位移）
    enigo.move_mouse_relative(10, 10);

    // 鼠标点击
    enigo.click(Button::Left);
    enigo.click(Button::Right);

    // 鼠标按下/释放
    enigo.button(Button::Left, Direction::Down);
    enigo.button(Button::Left, Direction::Up);

    // 滚动
    enigo.scroll(5, Axis::Vertical);   // 向下滚动
    enigo.scroll(-3, Axis::Vertical);  // 向上滚动
    enigo.scroll(2, Axis::Horizontal); // 向右滚动

    // 组合键
    enigo.key_down(Key::Shift);
    enigo.text("a");
    enigo.key_up(Key::Shift);  // 输入 "A"

    // 快捷键：Ctrl+S 保存
    enigo.key_down(Key::Control);
    enigo.key_click(Key::S);
    enigo.key_up(Key::Control);
}
```

## 可复用代码

| 模块 | 文件 | 用途 |
|------|------|------|
| **平台抽象** | `src/platform.rs` | 统一的平台接口 |
| **键码映射** | `src/keycodes.rs` | 跨平台键码转换 |
| **Windows 实现** | `src/win/` | Windows API |
| **macOS 实现** | `src/macos/` | Core Graphics |
| **Linux 实现** | `src/linux/` | X11/Wayland |

## 在本项目中的使用

用于实现远程桌面控制时的键盘鼠标模拟：

```
agent-server-admin (远程控制端)
    │
    ├── 输入事件 --> hbb_common (Protocol Buffers)
    │                      │
    └── 屏幕画面 <─── nuwax-rustdesk (scrap)
                              │
                              └── enigo (输入模拟)
                                      │
                                      └── 客户端本地执行输入
```

## 与 agent-client 集成场景

### 场景1：远程桌面输入模拟

```rust
// agent-client 接收远程输入事件并执行

use enigo::{Enigo, Key, Button, Direction, Coordinate};
use std::sync::{Arc, Mutex};

pub struct RemoteInputHandler {
    enigo: Mutex<Enigo>,
    // 输入队列（处理高频输入）
    input_queue: Arc<Mutex<Vec<InputEvent>>>,
    // 处理任务
    _task: JoinHandle<()>,
}

pub enum InputEvent {
    Keyboard {
        key: Key,
        direction: Direction,
    },
    Text {
        text: String,
    },
    Mouse {
        button: Option<Button>,
        direction: Option<Direction>,
        x: Option<i32>,
        y: Option<i32>,
        scroll_x: Option<i32>,
        scroll_y: Option<i32>,
    },
}

impl RemoteInputHandler {
    pub fn new() -> Result<Self> {
        let enigo = Enigo::new(&enigo::Settings::default());
        let input_queue = Arc::new(Mutex::new(Vec::new()));

        let this = Self {
            enigo: Mutex::new(enigo),
            input_queue: input_queue.clone(),
            _task: tokio::spawn(Self::process_loop(input_queue)),
        };

        Ok(this)
    }

    /// 处理远程输入事件
    pub fn handle_input(&self, event: InputEvent) {
        let mut queue = self.input_queue.lock().unwrap();
        queue.push(event);
    }

    /// 执行键盘事件
    pub fn key_event(&self, key: Key, direction: Direction) {
        let mut enigo = self.enigo.lock().unwrap();
        enigo.key(key, direction).ok();
    }

    /// 执行文本输入
    pub fn text_input(&self, text: &str) {
        let mut enigo = self.enigo.lock().unwrap();
        enigo.text(text).ok();
    }

    /// 执行鼠标事件
    pub fn mouse_event(
        &self,
        button: Option<Button>,
        direction: Option<Direction>,
        x: Option<i32>,
        y: Option<i32>,
        scroll_x: Option<i32>,
        scroll_y: Option<i32>,
    ) {
        let mut enigo = self.enigo.lock().unwrap();

        // 鼠标移动
        if let (Some(x), Some(y)) = (x, y) {
            enigo.move_mouse(x, y, Coordinate::Absolute).ok();
        }

        // 鼠标点击
        if let (Some(btn), Some(dir)) = (button, direction) {
            enigo.button(btn, dir).ok();
        }

        // 滚动
        if let Some(y) = scroll_y {
            enigo.scroll(y, enigo::Axis::Vertical).ok();
        }
        if let Some(x) = scroll_x {
            enigo.scroll(x, enigo::Axis::Horizontal).ok();
        }
    }

    /// 组合键处理（Ctrl+C, Ctrl+V 等）
    pub fn shortcut(&self, modifier: Key, key: Key) {
        let mut enigo = self.enigo.lock().unwrap();
        enigo.key(modifier, Direction::Down).ok();
        enigo.key(key, Direction::Click).ok();
        enigo.key(modifier, Direction::Up).ok();
    }

    /// 获取鼠标位置
    pub fn get_mouse_position(&self) -> (i32, i32) {
        let enigo = self.enigo.lock().unwrap();
        enigo.location().unwrap_or((0, 0))
    }

    /// 获取主显示器尺寸
    pub fn get_display_size(&self) -> (i32, i32) {
        let enigo = self.enigo.lock().unwrap();
        enigo.main_display().unwrap_or((1920, 1080))
    }

    /// 输入处理循环
    async fn process_loop(input_queue: Arc<Mutex<Vec<InputEvent>>>) {
        let mut interval = tokio::time::interval(Duration::from_millis(16)); // ~60fps

        loop {
            interval.tick().await;

            let events = {
                let mut queue = input_queue.lock().unwrap();
                std::mem::take(&mut *queue)
            };

            for event in events {
                // 根据事件类型执行输入
                match event {
                    InputEvent::Keyboard { key, direction } => {
                        // 执行键盘输入
                    }
                    InputEvent::Text { text } => {
                        // 执行文本输入
                    }
                    InputEvent::Mouse { button, direction, x, y, scroll_x, scroll_y } => {
                        // 执行鼠标输入
                    }
                }
            }
        }
    }
}
```

### 场景2：从 Protocol Buffers 消息解析输入

```rust
// 解析来自 nuwax-rustdesk 的 protobuf 输入消息

use hbb_common::protobuf::RemoteInput;

// 从 protobuf 消息转换为 enigo 输入事件
impl From<RemoteInput> for InputEvent {
    fn from(msg: RemoteInput) -> Self {
        match msg.input_type {
            Some(InputType::Key(key)) => InputEvent::Keyboard {
                key: convert_key(key.name()),
                direction: convert_direction(key.down()),
            },
            Some(InputType::Text(text)) => InputEvent::Text {
                text: text.content(),
            },
            Some(InputType::Mouse(mouse)) => InputEvent::Mouse {
                button: mouse.button().map(convert_button),
                direction: mouse.down().map(convert_direction),
                x: if mouse.x() != 0 { Some(mouse.x() as i32) } else { None },
                y: if mouse.y() != 0 { Some(mouse.y() as i32) } else { None },
                scroll_x: None, // 需要从 protobuf 定义中添加
                scroll_y: None,
            },
            Some(InputType::Scroll(scroll)) => InputEvent::Mouse {
                button: None,
                direction: None,
                x: None,
                y: None,
                scroll_x: Some(scroll.x() as i32),
                scroll_y: Some(scroll.y() as i32),
            },
            _ => unreachable!(),
        }
    }
}

/// 转换键码
fn convert_key(name: &str) -> Key {
    match name {
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Shift" => Key::Shift,
        "Super" => Key::Super,
        "Enter" => Key::Enter,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "ArrowUp" => Key::ArrowUp,
        "ArrowDown" => Key::ArrowDown,
        "ArrowLeft" => Key::ArrowLeft,
        "ArrowRight" => Key::ArrowRight,
        _ => Key::Layout(name.chars().next().unwrap_or(' ')),
    }
}

/// 转换鼠标按钮
fn convert_button(btn: MouseButton) -> Button {
    match btn {
        MouseButton::Left => Button::Left,
        MouseButton::Right => Button::Right,
        MouseButton::Middle => Button::Middle,
        MouseButton::Back => Button::Back,
        MouseButton::Forward => Button::Forward,
        _ => Button::Left,
    }
}

/// 转换按键方向
fn convert_direction(down: bool) -> Direction {
    if down { Direction::Down } else { Direction::Up }
}
```

### 场景3：输入事件序列化与传输

```rust
// 输入事件序列化为 protobuf 用于网络传输

#[derive(Debug, Clone)]
pub struct SerializedInput {
    pub event_type: String,
    pub key: Option<String>,
    pub text: Option<String>,
    pub button: Option<String>,
    pub direction: Option<String>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub scroll_x: Option<i32>,
    pub scroll_y: Option<i32>,
}

impl SerializedInput {
    pub fn from_input_event(event: &InputEvent) -> Self {
        match event {
            InputEvent::Keyboard { key, direction } => Self {
                event_type: "key".to_string(),
                key: Some(format!("{:?}", key)),
                text: None,
                button: None,
                direction: Some(format!("{:?}", direction)),
                x: None,
                y: None,
                scroll_x: None,
                scroll_y: None,
            },
            InputEvent::Text { text } => Self {
                event_type: "text".to_string(),
                key: None,
                text: Some(text.clone()),
                button: None,
                direction: None,
                x: None,
                y: None,
                scroll_x: None,
                scroll_y: None,
            },
            InputEvent::Mouse { button, direction, x, y, scroll_x, scroll_y } => Self {
                event_type: "mouse".to_string(),
                key: None,
                text: None,
                button: button.map(|b| format!("{:?}", b)),
                direction: direction.map(|d| format!("{:?}", d)),
                x: *x,
                y: *y,
                scroll_x: *scroll_x,
                scroll_y: *scroll_y,
            },
        }
    }
}
```

### 场景4：平台特定的权限处理

```rust
// 不同平台的输入权限获取

#[cfg(target_os = "macos")]
mod macos_permissions {
    use crate::Result;

    pub fn request_accessibility() -> bool {
        // macOS 需要用户授权辅助功能权限
        // 可以通过 AXIsProcessTrustedWithOptions() 检查
        // 需要引导用户到系统设置中启用
        unsafe {
            let options: CFDictionaryRef = core_foundation::base::CFDictionaryCreateMutable(
                core_foundation::base::kCFAllocatorDefault,
                0,
                &core_foundation::base::kCFTypeDictionaryKeyCallBacks,
                &core_foundation::base::kCFTypeDictionaryValueCallBacks,
            );

            let key = core_foundation::string::CFStringCreateWithCString(
                core_foundation::base::kCFAllocatorDefault,
                "AXTrustedCheckPurposeOptionKey\0".as_ptr() as *const _,
                core_foundation::base::kCFStringEncodingUTF8,
            );

            let value = core_foundation::boolean::kCFBooleanTrue;

            CFDictionarySetValue(options, key as *const _, value as *const _);
            let trusted = AXIsProcessTrustedWithOptions(options);

            CFRelease(options as *const _);
            trusted
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_permissions {
    pub fn check_accessibility() -> bool {
        // Windows 需要启用"允许应用控制鼠标键盘"
        // 通过 OpenInputDesktop 检查
        true
    }
}

#[cfg(target_os = "linux")]
mod linux_permissions {
    pub fn check_accessibility() -> bool {
        // Linux 需要 X11/Wayland 权限
        // 可以通过 WAYLAND_DISPLAY 环境变量检查
        std::env::var("WAYLAND_DISPLAY").is_ok()
    }
}
```

### 场景5：输入频率限制与平滑

```rust
// 防止高频输入导致的问题

pub struct InputRateLimiter {
    // 上一条输入的时间戳
    last_input: AtomicU64,
    // 最小输入间隔（毫秒）
    min_interval: u64,
    // 输入平滑因子
    smoothing: f32,
    // 累积的位移
    pending_movement: AtomicI32,
}

impl InputRateLimiter {
    pub fn new(min_interval_ms: u64) -> Self {
        Self {
            last_input: AtomicU64::new(0),
            min_interval: min_interval_ms,
            smoothing: 0.8,
            pending_movement: AtomicI32::new(0),
        }
    }

    /// 检查是否可以执行输入
    pub fn can_input(&self) -> bool {
        let now = current_time_millis();
        let last = self.last_input.load(Ordering::SeqCst);
        (now - last) >= self.min_interval
    }

    /// 执行带速率限制的输入
    pub fn execute_with_rate_limit<F, T>(&self, f: F) -> Option<T>
    where
        F: FnOnce() -> T,
    {
        if self.can_input() {
            self.last_input.store(current_time_millis(), Ordering::SeqCst);
            Some(f())
        } else {
            None
        }
    }

    /// 平滑鼠标移动
    pub fn smooth_mouse_move(&self, target_x: i32, target_y: i32, current_x: i32, current_y: i32) -> (i32, i32) {
        let dx = target_x - current_x;
        let dy = target_y - current_y;

        // 应用平滑因子
        let smooth_x = (dx as f32 * self.smoothing) as i32;
        let smooth_y = (dy as f32 * self.smoothing) as i32;

        // 累积未移动的距离
        let pending = self.pending_movement.load(Ordering::SeqCst);
        self.pending_movement.store(pending + dx - smooth_y, Ordering::SeqCst);

        (smooth_x, smooth_y)
    }
}
```
