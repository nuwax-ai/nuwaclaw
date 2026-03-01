use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// CREATE_NO_WINDOW 标志常量
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// CREATE_NEW_PROCESS_GROUP 标志常量（用于孙进程也继承无窗口属性）
#[cfg(windows)]
pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

/// 组合标志：同时使用 CREATE_NO_WINDOW 和 CREATE_NEW_PROCESS_GROUP
/// 这样子进程和孙进程都不会弹出控制台窗口
#[cfg(windows)]
pub const CREATE_NO_WINDOW_WITH_PROCESS_GROUP: u32 = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;

/// 进程追踪上下文
///
/// 用于追踪进程创建和启动的上下文信息。
/// 可以在未来用于更细粒度的进程追踪和调试。
///
/// # Example
/// ```ignore
/// let ctx = ProcessTraceContext::new("node");
/// ctx.log_spawn();
/// ```
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ProcessTraceContext {
    /// 程序名
    pub program: String,
    /// 参数列表
    pub args: Vec<String>,
    /// 是否设置了 no_window
    pub no_window_set: bool,
    /// 创建时间
    pub created_at: SystemTime,
}

impl ProcessTraceContext {
    /// 创建新的追踪上下文
    #[allow(dead_code)]
    pub fn new(program: &str) -> Self {
        Self {
            program: program.to_string(),
            args: vec![],
            no_window_set: false,
            created_at: SystemTime::now(),
        }
    }

    /// 记录 spawn 日志
    #[allow(dead_code)]
    pub fn log_spawn(&self) {
        let timestamp = self
            .created_at
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        #[cfg(windows)]
        {
            if !self.no_window_set {
                tracing::warn!(
                    "[ProcessTrace] ⚠️ SPAWN_WITHOUT_NO_WINDOW | {}ms | program={} | args={:?}",
                    timestamp,
                    self.program,
                    self.args
                );
            } else {
                tracing::info!(
                    "[ProcessTrace] SPAWN | {}ms | no_window=true | program={} | args={:?}",
                    timestamp,
                    self.program,
                    self.args
                );
            }
        }

        #[cfg(not(windows))]
        {
            tracing::debug!(
                "[ProcessTrace] SPAWN | {}ms | program={} | args={:?}",
                timestamp,
                self.program,
                self.args
            );
        }
    }
}

/// Command 扩展 trait，用于在 Windows 上隐藏控制台窗口
pub trait CommandNoWindowExt {
    /// 设置 CREATE_NO_WINDOW 标志 (Windows only)
    fn no_window(&mut self) -> &mut Self;

    /// 设置 CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP 组合标志
    /// 这样子进程和孙进程都不会弹出控制台窗口
    fn no_window_with_process_group(&mut self) -> &mut Self;
}

impl CommandNoWindowExt for Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            // 调试日志：追踪进程启动
            {
                let exe = self.get_program();
                let args: Vec<_> = self
                    .get_args()
                    .map(|a| a.to_string_lossy().to_string())
                    .collect();
                tracing::debug!(
                    "[ProcessTrace] SET_NO_WINDOW | program={} | args={:?}",
                    exe.to_string_lossy(),
                    args
                );
            }

            self.creation_flags(CREATE_NO_WINDOW)
        }
        #[cfg(not(windows))]
        self
    }

    fn no_window_with_process_group(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            // 调试日志：追踪进程启动
            {
                let exe = self.get_program();
                let args: Vec<_> = self
                    .get_args()
                    .map(|a| a.to_string_lossy().to_string())
                    .collect();
                tracing::debug!(
                    "[ProcessTrace] SET_NO_WINDOW_WITH_PROCESS_GROUP | program={} | args={:?}",
                    exe.to_string_lossy(),
                    args
                );
            }

            self.creation_flags(CREATE_NO_WINDOW_WITH_PROCESS_GROUP)
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

            // 调试日志：追踪进程启动
            tracing::debug!("[ProcessTrace] tokio::process::Command::no_window()");

            self.creation_flags(CREATE_NO_WINDOW)
        }
        #[cfg(not(windows))]
        self
    }

    fn no_window_with_process_group(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;

            // 调试日志：追踪进程启动
            tracing::debug!("[ProcessTrace] tokio::process::Command::no_window_with_process_group()");

            self.creation_flags(CREATE_NO_WINDOW_WITH_PROCESS_GROUP)
        }
        #[cfg(not(windows))]
        self
    }
}

/// 创建一个带有 CREATE_NO_WINDOW 的 std::process::Command
///
/// 这是一个便捷函数，会自动添加日志追踪
#[cfg(windows)]
pub fn command_no_window(program: &str) -> Command {
    use std::os::windows::process::CommandExt;

    tracing::info!("[ProcessTrace] Creating command with no_window: {}", program);

    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 创建一个带有 CREATE_NO_WINDOW 的 tokio::process::Command
#[cfg(windows)]
pub fn tokio_command_no_window(program: &str) -> tokio::process::Command {
    use std::os::windows::process::CommandExt as _;

    tracing::info!("[ProcessTrace] Creating tokio command with no_window: {}", program);

    let mut cmd = tokio::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 创建一个带有 CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP 的 std::process::Command
///
/// 这样子进程和孙进程都不会弹出控制台窗口
#[cfg(windows)]
pub fn command_no_window_with_process_group(program: &str) -> Command {
    use std::os::windows::process::CommandExt;

    tracing::info!(
        "[ProcessTrace] Creating command with no_window+process_group: {}",
        program
    );

    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW_WITH_PROCESS_GROUP);
    cmd
}

/// 创建一个带有 CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP 的 tokio::process::Command
#[cfg(windows)]
pub fn tokio_command_no_window_with_process_group(program: &str) -> tokio::process::Command {
    use std::os::windows::process::CommandExt as _;

    tracing::info!(
        "[ProcessTrace] Creating tokio command with no_window+process_group: {}",
        program
    );

    let mut cmd = tokio::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW_WITH_PROCESS_GROUP);
    cmd
}

// 非 Windows 平台的占位实现
#[cfg(not(windows))]
pub fn command_no_window(program: &str) -> Command {
    Command::new(program)
}

#[cfg(not(windows))]
pub fn tokio_command_no_window(program: &str) -> tokio::process::Command {
    tokio::process::Command::new(program)
}

#[cfg(not(windows))]
pub fn command_no_window_with_process_group(program: &str) -> Command {
    Command::new(program)
}

#[cfg(not(windows))]
pub fn tokio_command_no_window_with_process_group(program: &str) -> tokio::process::Command {
    tokio::process::Command::new(program)
}
