//! 远程输入模拟
//!
//! 将远程输入事件转为本地 enigo 操作

use tracing::{debug, warn};

/// 鼠标按键
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Back,
    Forward,
}

/// 输入事件
#[derive(Debug, Clone)]
pub enum InputEvent {
    /// 鼠标移动（绝对坐标）
    MouseMove { x: i32, y: i32 },
    /// 鼠标按下
    MouseDown { button: MouseButton },
    /// 鼠标释放
    MouseUp { button: MouseButton },
    /// 鼠标滚轮
    MouseScroll { dx: i32, dy: i32 },
    /// 键盘按下（key code）
    KeyDown { key_code: u32 },
    /// 键盘释放（key code）
    KeyUp { key_code: u32 },
    /// 文本输入
    TextInput { text: String },
}

/// 远程输入管理器
pub struct RemoteInputManager {
    #[cfg(feature = "remote-desktop")]
    enigo: Option<enigo::Enigo>,
    /// 是否启用输入
    enabled: bool,
}

impl RemoteInputManager {
    /// 创建新的输入管理器
    pub fn new() -> Self {
        #[cfg(feature = "remote-desktop")]
        let enigo = {
            use enigo::Settings;
            match enigo::Enigo::new(&Settings::default()) {
                Ok(e) => Some(e),
                Err(e) => {
                    warn!("Failed to create Enigo instance: {:?}", e);
                    None
                }
            }
        };

        Self {
            #[cfg(feature = "remote-desktop")]
            enigo,
            enabled: false,
        }
    }

    /// 启用输入模拟
    pub fn enable(&mut self) {
        self.enabled = true;
        debug!("Remote input simulation enabled");
    }

    /// 禁用输入模拟
    pub fn disable(&mut self) {
        self.enabled = false;
        debug!("Remote input simulation disabled");
    }

    /// 是否已启用
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 处理输入事件
    pub fn handle_event(&mut self, event: &InputEvent) {
        if !self.enabled {
            return;
        }

        #[cfg(feature = "remote-desktop")]
        {
            use enigo::{Axis, Button, Coordinate, Direction, Keyboard, Mouse};

            let Some(ref mut enigo) = self.enigo else {
                warn!("Enigo not initialized, cannot handle input event");
                return;
            };

            match event {
                InputEvent::MouseMove { x, y } => {
                    if let Err(e) = enigo.move_mouse(*x, *y, Coordinate::Abs) {
                        debug!("Failed to move mouse: {:?}", e);
                    }
                }
                InputEvent::MouseDown { button } => {
                    let btn = Self::map_mouse_button(*button);
                    if let Err(e) = enigo.button(btn, Direction::Press) {
                        debug!("Failed to press mouse button: {:?}", e);
                    }
                }
                InputEvent::MouseUp { button } => {
                    let btn = Self::map_mouse_button(*button);
                    if let Err(e) = enigo.button(btn, Direction::Release) {
                        debug!("Failed to release mouse button: {:?}", e);
                    }
                }
                InputEvent::MouseScroll { dx, dy } => {
                    if *dy != 0 {
                        if let Err(e) = enigo.scroll(*dy, Axis::Vertical) {
                            debug!("Failed to scroll vertically: {:?}", e);
                        }
                    }
                    if *dx != 0 {
                        if let Err(e) = enigo.scroll(*dx, Axis::Horizontal) {
                            debug!("Failed to scroll horizontally: {:?}", e);
                        }
                    }
                }
                InputEvent::KeyDown { key_code } => {
                    if let Some(key) = Self::map_key_code(*key_code) {
                        if let Err(e) = enigo.key(key, Direction::Press) {
                            debug!("Failed to press key: {:?}", e);
                        }
                    } else {
                        debug!("Unknown key code for key down: {}", key_code);
                    }
                }
                InputEvent::KeyUp { key_code } => {
                    if let Some(key) = Self::map_key_code(*key_code) {
                        if let Err(e) = enigo.key(key, Direction::Release) {
                            debug!("Failed to release key: {:?}", e);
                        }
                    } else {
                        debug!("Unknown key code for key up: {}", key_code);
                    }
                }
                InputEvent::TextInput { text } => {
                    if let Err(e) = enigo.text(text) {
                        debug!("Failed to input text: {:?}", e);
                    }
                }
            }
        }

        #[cfg(not(feature = "remote-desktop"))]
        {
            warn!("Remote input not available: remote-desktop feature not enabled");
            let _ = event;
        }
    }

    /// 映射鼠标按键
    #[cfg(feature = "remote-desktop")]
    fn map_mouse_button(button: MouseButton) -> enigo::Button {
        use enigo::Button;
        match button {
            MouseButton::Left => Button::Left,
            MouseButton::Right => Button::Right,
            MouseButton::Middle => Button::Middle,
            MouseButton::Back => Button::Back,
            MouseButton::Forward => Button::Forward,
        }
    }

    /// 映射键盘按键（虚拟键码 -> enigo::Key）
    /// 使用 Windows 虚拟键码标准（VK_*）
    #[cfg(feature = "remote-desktop")]
    fn map_key_code(key_code: u32) -> Option<enigo::Key> {
        use enigo::Key;

        match key_code {
            // 控制键
            8 => Some(Key::Backspace),
            9 => Some(Key::Tab),
            13 => Some(Key::Return),
            16 => Some(Key::Shift),
            17 => Some(Key::Control),
            18 => Some(Key::Alt),
            19 => Some(Key::Other(19)), // Pause - use raw keycode
            20 => Some(Key::CapsLock),
            27 => Some(Key::Escape),
            32 => Some(Key::Space),

            // 导航键
            33 => Some(Key::PageUp),
            34 => Some(Key::PageDown),
            35 => Some(Key::End),
            36 => Some(Key::Home),
            37 => Some(Key::LeftArrow),
            38 => Some(Key::UpArrow),
            39 => Some(Key::RightArrow),
            40 => Some(Key::DownArrow),
            45 => Some(Key::Other(45)), // Insert - use raw keycode
            46 => Some(Key::Delete),

            // 数字键 0-9 (ASCII: 48-57)
            48..=57 => {
                let c = (key_code as u8) as char;
                Some(Key::Unicode(c))
            }

            // 字母键 A-Z (ASCII: 65-90)
            65..=90 => {
                // 转为小写字母
                let c = ((key_code as u8) + 32) as char;
                Some(Key::Unicode(c))
            }

            // 小键盘数字 0-9 (96-105)
            96..=105 => {
                let c = ((key_code - 96) as u8 + b'0') as char;
                Some(Key::Unicode(c))
            }

            // 小键盘运算符
            106 => Some(Key::Unicode('*')), // Numpad *
            107 => Some(Key::Unicode('+')), // Numpad +
            109 => Some(Key::Unicode('-')), // Numpad -
            110 => Some(Key::Unicode('.')), // Numpad .
            111 => Some(Key::Unicode('/')), // Numpad /

            // 功能键 F1-F12 (112-123)
            112 => Some(Key::F1),
            113 => Some(Key::F2),
            114 => Some(Key::F3),
            115 => Some(Key::F4),
            116 => Some(Key::F5),
            117 => Some(Key::F6),
            118 => Some(Key::F7),
            119 => Some(Key::F8),
            120 => Some(Key::F9),
            121 => Some(Key::F10),
            122 => Some(Key::F11),
            123 => Some(Key::F12),

            // 符号键（US 键盘布局）
            186 => Some(Key::Unicode(';')),  // ;:
            187 => Some(Key::Unicode('=')),  // =+
            188 => Some(Key::Unicode(',')),  // ,<
            189 => Some(Key::Unicode('-')),  // -_
            190 => Some(Key::Unicode('.')),  // .>
            191 => Some(Key::Unicode('/')),  // /?
            192 => Some(Key::Unicode('`')),  // `~
            219 => Some(Key::Unicode('[')),  // [{
            220 => Some(Key::Unicode('\\')), // \|
            221 => Some(Key::Unicode(']')),  // ]}
            222 => Some(Key::Unicode('\'')), // '"

            // 修饰键
            91 => Some(Key::Meta),  // Left Windows/Command
            92 => Some(Key::Meta),  // Right Windows/Command

            // 未知键码
            _ => None,
        }
    }
}

impl Default for RemoteInputManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_input_manager_creation() {
        let manager = RemoteInputManager::new();
        assert!(!manager.is_enabled());
    }

    #[test]
    fn test_enable_disable() {
        let mut manager = RemoteInputManager::new();
        manager.enable();
        assert!(manager.is_enabled());
        manager.disable();
        assert!(!manager.is_enabled());
    }

    #[test]
    fn test_input_events_disabled() {
        let mut manager = RemoteInputManager::new();
        // 禁用状态下处理事件不应 panic
        let events = vec![
            InputEvent::MouseMove { x: 100, y: 200 },
            InputEvent::MouseDown { button: MouseButton::Left },
            InputEvent::MouseUp { button: MouseButton::Left },
            InputEvent::MouseScroll { dx: 0, dy: 3 },
            InputEvent::KeyDown { key_code: 65 }, // 'A'
            InputEvent::KeyUp { key_code: 65 },
            InputEvent::TextInput { text: "test".to_string() },
        ];
        for event in &events {
            manager.handle_event(event);
        }
    }

    #[test]
    fn test_mouse_button_enum() {
        // 验证 MouseButton 枚举值
        assert_eq!(MouseButton::Left, MouseButton::Left);
        assert_ne!(MouseButton::Left, MouseButton::Right);
    }

    #[test]
    fn test_input_event_clone() {
        let event = InputEvent::KeyDown { key_code: 65 };
        let cloned = event.clone();
        match cloned {
            InputEvent::KeyDown { key_code } => assert_eq!(key_code, 65),
            _ => panic!("Expected KeyDown event"),
        }
    }
}
