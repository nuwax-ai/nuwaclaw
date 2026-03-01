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

            // 调试日志：追踪进程启动
            #[cfg(debug_assertions)]
            {
                let exe = self.get_program();
                tracing::debug!("[ProcessTrace] std::process::Command::no_window() - {:?}", exe);
            }

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

            // 调试日志：追踪进程启动
            #[cfg(debug_assertions)]
            {
                // tokio::process::Command 没有直接获取 program 的方法
                // 通过 as_std() 获取底层 Command
                tracing::debug!("[ProcessTrace] tokio::process::Command::no_window()");
            }

            self.creation_flags(CREATE_NO_WINDOW)
        }
        #[cfg(not(windows))]
        self
    }
}

/// 创建一个带有 CREATE_NO_WINDOW 的 std::process::Command
///
/// 这是一个便捷函数，会自动添加日志追踪（debug 模式下）
#[cfg(windows)]
pub fn command_no_window(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    tracing::debug!("[ProcessTrace] Creating command with no_window: {}", program);

    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 创建一个带有 CREATE_NO_WINDOW 的 tokio::process::Command
#[cfg(windows)]
pub fn tokio_command_no_window(program: &str) -> tokio::process::Command {
    use std::os::windows::process::CommandExt as _;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    tracing::debug!("[ProcessTrace] Creating tokio command with no_window: {}", program);

    let mut cmd = tokio::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}
