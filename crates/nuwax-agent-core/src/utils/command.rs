use std::process::Command;

/// Command 扩展 trait，用于在 Windows 上隐藏控制台窗口
pub trait CommandNoWindowExt {
    /// 设置 CREATE_NO_WINDOW 标志 (Windows only)
    fn no_window(&mut self) -> &mut Self;
}

impl CommandNoWindowExt for Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            self.creation_flags(CREATE_NO_WINDOW)
        }
        #[cfg(not(windows))]
        self
    }
}

// 为 tokio::process::Command 实现同样的 trait
impl CommandNoWindowExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            self.creation_flags(CREATE_NO_WINDOW)
        }
        #[cfg(not(windows))]
        self
    }
}
