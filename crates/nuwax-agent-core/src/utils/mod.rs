//! 工具函数模块

pub mod clipboard;
pub mod notification;
pub mod path_env;

pub use notification::{Notification, NotificationType};
pub use path_env::{
    build_base_env, build_full_path_env, build_node_path_env, ensure_local_bin_env,
    setup_mirror_env, DEFAULT_MCP_PROXY_CONFIG, DEFAULT_NPM_REGISTRY, DEFAULT_PYPI_INDEX_URL,
};
#[cfg(windows)]
pub use path_env::find_git_bash_path;

pub mod command;
pub use command::CommandNoWindowExt;
