//! 预检检查模块
//!
//! 统一聚合依赖检测、端口占用、目录可写性等检查，
//! 提供一键检测与修复能力。

use serde::{Deserialize, Serialize};

/// 检查类别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CheckCategory {
    /// 依赖工具（node、uv 等）
    Dependency,
    /// 网络端口
    Network,
    /// 目录可写性
    Directory,
    /// 系统权限
    Permission,
}

/// 检查状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CheckStatus {
    /// 通过
    Pass,
    /// 警告（非阻塞）
    Warn,
    /// 失败（阻塞）
    Fail,
}

/// 单项检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightCheck {
    /// 检查项唯一 ID（如 "node", "port_60000", "dir_workspace"）
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 检查类别
    pub category: CheckCategory,
    /// 检查状态
    pub status: CheckStatus,
    /// 人类可读的结果信息
    pub message: String,
    /// 修复提示（如有）
    pub fix_hint: Option<String>,
    /// 是否支持自动修复
    pub auto_fixable: bool,
}

/// 预检结果汇总
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightResult {
    /// 是否全部通过
    pub passed: bool,
    /// 各项检查结果
    pub checks: Vec<PreflightCheck>,
}

/// 修复结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixResult {
    /// 检查项 ID
    pub id: String,
    /// 是否修复成功
    pub success: bool,
    /// 修复信息
    pub message: String,
}

/// 预检配置
pub struct PreflightConfig {
    /// 需要检测的端口列表（service_name, port）
    pub ports: Vec<(String, u16)>,
    /// 需要检测可写性的目录列表（name, path）
    pub directories: Vec<(String, std::path::PathBuf)>,
    /// 是否检查依赖工具
    pub check_dependencies: bool,
}

impl Default for PreflightConfig {
    fn default() -> Self {
        Self {
            ports: vec![],
            directories: vec![],
            check_dependencies: true,
        }
    }
}

/// 执行全部预检检查
pub async fn run_preflight(config: &PreflightConfig) -> PreflightResult {
    let mut checks = Vec::new();

    // 1. 端口可用性检查
    for (name, port) in &config.ports {
        let available = crate::platform::check_port_available(*port);
        checks.push(PreflightCheck {
            id: format!("port_{}", port),
            name: format!("端口 {} ({})", port, name),
            category: CheckCategory::Network,
            status: if available {
                CheckStatus::Pass
            } else {
                CheckStatus::Fail
            },
            message: if available {
                format!("端口 {} 可用", port)
            } else {
                format!("端口 {} 已被占用", port)
            },
            fix_hint: if available {
                None
            } else {
                Some(format!(
                    "请关闭占用端口 {} 的进程，或在设置中更换端口",
                    port
                ))
            },
            auto_fixable: false,
        });
    }

    // 2. 目录可写性检查
    for (name, path) in &config.directories {
        let (status, message, fix_hint) = check_directory_writable(name, path);
        checks.push(PreflightCheck {
            id: format!("dir_{}", name),
            name: format!("目录: {}", name),
            category: CheckCategory::Directory,
            status,
            message,
            fix_hint,
            auto_fixable: false,
        });
    }

    // 3. 依赖工具检查
    if config.check_dependencies {
        checks.extend(check_dependency_tools().await);
    }

    let passed = checks.iter().all(|c| c.status != CheckStatus::Fail);

    PreflightResult { passed, checks }
}

/// 修复指定的检查项
pub async fn run_preflight_fix(check_ids: &[String]) -> Vec<FixResult> {
    let mut results = Vec::new();

    for id in check_ids {
        let result = if id.starts_with("dir_") {
            // 目录修复：尝试创建目录
            fix_directory(id).await
        } else if id.starts_with("dep_") {
            // 依赖修复：暂不支持自动修复，引导用户手动安装
            FixResult {
                id: id.clone(),
                success: false,
                message: "请通过依赖管理页面安装此工具".to_string(),
            }
        } else {
            FixResult {
                id: id.clone(),
                success: false,
                message: "此项不支持自动修复".to_string(),
            }
        };
        results.push(result);
    }

    results
}

/// 检查目录是否可写
fn check_directory_writable(
    name: &str,
    path: &std::path::Path,
) -> (CheckStatus, String, Option<String>) {
    if !path.exists() {
        match std::fs::create_dir_all(path) {
            Ok(_) => (CheckStatus::Pass, format!("{} 目录已创建", name), None),
            Err(e) => (
                CheckStatus::Fail,
                format!("{} 目录不存在且无法创建: {}", name, e),
                Some(format!("请手动创建目录: {}", path.display())),
            ),
        }
    } else {
        // 尝试写入临时文件验证可写性
        let test_file = path.join(".nuwax_preflight_test");
        match std::fs::write(&test_file, "test") {
            Ok(_) => {
                let _ = std::fs::remove_file(&test_file);
                (CheckStatus::Pass, format!("{} 目录可写", name), None)
            }
            Err(e) => (
                CheckStatus::Fail,
                format!("{} 目录不可写: {}", name, e),
                Some(format!("请检查目录权限: chmod 755 {}", path.display())),
            ),
        }
    }
}

/// 检查依赖工具
async fn check_dependency_tools() -> Vec<PreflightCheck> {
    let mut checks = Vec::new();

    // 检查 node（本地安装路径 → ~/.local/bin/ → PATH）
    let node_ok = check_node_available();
    checks.push(PreflightCheck {
        id: "dep_node".to_string(),
        name: "Node.js".to_string(),
        category: CheckCategory::Dependency,
        status: if node_ok {
            CheckStatus::Pass
        } else {
            CheckStatus::Warn
        },
        message: if node_ok {
            "Node.js 已安装".to_string()
        } else {
            "Node.js 未安装，将在下一步自动安装".to_string()
        },
        fix_hint: if node_ok {
            None
        } else {
            Some("将在依赖安装阶段自动安装".to_string())
        },
        auto_fixable: false,
    });

    // 检查 uv（~/.local/bin/ → PATH）
    let uv_ok = check_uv_available();
    checks.push(PreflightCheck {
        id: "dep_uv".to_string(),
        name: "uv (Python)".to_string(),
        category: CheckCategory::Dependency,
        status: if uv_ok {
            CheckStatus::Pass
        } else {
            CheckStatus::Warn
        },
        message: if uv_ok {
            "uv 已安装".to_string()
        } else {
            "uv 未安装，将在下一步自动安装".to_string()
        },
        fix_hint: if uv_ok {
            None
        } else {
            Some("将在依赖安装阶段自动安装".to_string())
        },
        auto_fixable: false,
    });

    // 检查 mcp-proxy
    let mcp_ok = which::which("mcp-proxy").is_ok();
    checks.push(PreflightCheck {
        id: "dep_mcp_proxy".to_string(),
        name: "MCP Proxy".to_string(),
        category: CheckCategory::Dependency,
        status: if mcp_ok {
            CheckStatus::Pass
        } else {
            CheckStatus::Warn
        },
        message: if mcp_ok {
            "MCP Proxy 已安装".to_string()
        } else {
            "MCP Proxy 未安装，将在下一步自动安装".to_string()
        },
        fix_hint: if mcp_ok {
            None
        } else {
            Some("将在依赖安装阶段自动安装".to_string())
        },
        auto_fixable: false,
    });

    checks
}

/// 检查 node 是否可用（~/.local/bin/ → PATH）
fn check_node_available() -> bool {
    // 1. ~/.local/bin/node
    let local_node = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin")
        .join("node");
    if local_node.exists() {
        return true;
    }

    // 2. PATH
    which::which("node").is_ok()
}

/// 检查 uv 是否可用（~/.local/bin/ → PATH）
fn check_uv_available() -> bool {
    // 1. ~/.local/bin/
    let local_uv = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin")
        .join("uv");
    if local_uv.exists() {
        return true;
    }

    // 2. PATH
    which::which("uv").is_ok()
}

/// 修复目录问题
async fn fix_directory(id: &str) -> FixResult {
    // id 格式: "dir_<name>"，实际路径需要从上下文获取
    // 这里只能做通用修复（创建目录），具体路径由调用方传入
    FixResult {
        id: id.to_string(),
        success: false,
        message: "目录修复需要通过 preflight_fix 命令传入具体路径".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_preflight_with_empty_config() {
        let config = PreflightConfig {
            ports: vec![],
            directories: vec![],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert!(result.checks.is_empty());
        assert!(result.passed);
    }

    #[tokio::test]
    async fn test_preflight_with_dependency_check() {
        let config = PreflightConfig::default();
        let result = run_preflight(&config).await;
        // 默认检查依赖，至少有 node 和 uv 两项
        assert!(result.checks.len() >= 2);
        assert!(result.checks.iter().any(|c| c.id == "dep_node"));
        assert!(result.checks.iter().any(|c| c.id == "dep_uv"));
    }

    #[tokio::test]
    async fn test_port_check_available() {
        let config = PreflightConfig {
            // 使用一个不太可能被占用的高端口
            ports: vec![("test".to_string(), 59999)],
            directories: vec![],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert_eq!(result.checks.len(), 1);
        // 端口可能可用也可能不可用，只验证结构完整
        assert_eq!(result.checks[0].id, "port_59999");
        assert_eq!(result.checks[0].category, CheckCategory::Network);
    }

    #[tokio::test]
    async fn test_port_check_occupied() {
        // 绑定一个端口使其被占用
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let config = PreflightConfig {
            ports: vec![("occupied".to_string(), port)],
            directories: vec![],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert_eq!(result.checks.len(), 1);
        assert_eq!(result.checks[0].status, CheckStatus::Fail);
        assert!(!result.passed);
        assert!(result.checks[0].fix_hint.is_some());
        drop(listener);
    }

    #[tokio::test]
    async fn test_directory_writable() {
        let temp_dir = std::env::temp_dir().join("nuwax_preflight_test_dir");
        let config = PreflightConfig {
            ports: vec![],
            directories: vec![("test".to_string(), temp_dir.clone())],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert_eq!(result.checks.len(), 1);
        assert_eq!(result.checks[0].status, CheckStatus::Pass);
        assert_eq!(result.checks[0].category, CheckCategory::Directory);

        // 清理
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_directory_unwritable_path() {
        // 使用一个不可能存在且无法创建的路径
        let impossible_path = std::path::PathBuf::from("/nonexistent_root_dir_12345/subdir/deep");
        let config = PreflightConfig {
            ports: vec![],
            directories: vec![("impossible".to_string(), impossible_path)],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert_eq!(result.checks.len(), 1);
        assert_eq!(result.checks[0].status, CheckStatus::Fail);
        assert!(!result.passed);
    }

    #[tokio::test]
    async fn test_multiple_checks_combined() {
        let temp_dir = std::env::temp_dir().join("nuwax_preflight_multi_test");
        let config = PreflightConfig {
            ports: vec![("svc1".to_string(), 59990), ("svc2".to_string(), 59991)],
            directories: vec![("workspace".to_string(), temp_dir.clone())],
            check_dependencies: true,
        };
        let result = run_preflight(&config).await;
        // 至少 2 端口 + 1 目录 + 2 依赖 = 5 项
        assert!(result.checks.len() >= 5);

        // 清理
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_passed_flag_all_pass() {
        let temp_dir = std::env::temp_dir().join("nuwax_preflight_pass_test");
        let config = PreflightConfig {
            ports: vec![],
            directories: vec![("ok".to_string(), temp_dir.clone())],
            check_dependencies: false,
        };
        let result = run_preflight(&config).await;
        assert!(result.passed);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_fix_unknown_check_id() {
        let results = run_preflight_fix(&["unknown_id_123".to_string()]).await;
        assert_eq!(results.len(), 1);
        assert!(!results[0].success);
    }

    #[tokio::test]
    async fn test_fix_directory_returns_message() {
        let results = run_preflight_fix(&["dir_workspace".to_string()]).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "dir_workspace");
    }

    #[tokio::test]
    async fn test_fix_dependency_not_auto_fixable() {
        let results = run_preflight_fix(&["dep_node".to_string()]).await;
        assert_eq!(results.len(), 1);
        assert!(!results[0].success);
        assert!(results[0].message.contains("依赖管理"));
    }

    #[tokio::test]
    async fn test_check_status_equality() {
        assert_eq!(CheckStatus::Pass, CheckStatus::Pass);
        assert_ne!(CheckStatus::Pass, CheckStatus::Fail);
        assert_ne!(CheckStatus::Warn, CheckStatus::Fail);
    }

    #[tokio::test]
    async fn test_check_category_equality() {
        assert_eq!(CheckCategory::Network, CheckCategory::Network);
        assert_ne!(CheckCategory::Network, CheckCategory::Directory);
    }

    #[test]
    fn test_preflight_config_default() {
        let config = PreflightConfig::default();
        assert!(config.ports.is_empty());
        assert!(config.directories.is_empty());
        assert!(config.check_dependencies);
    }

    #[test]
    fn test_check_directory_writable_creates_dir() {
        let dir = std::env::temp_dir().join("nuwax_preflight_create_test");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!dir.exists());

        let (status, _msg, _hint) = check_directory_writable("test", &dir);
        assert_eq!(status, CheckStatus::Pass);
        assert!(dir.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_check_directory_writable_existing_dir() {
        let dir = std::env::temp_dir();
        let (status, msg, _hint) = check_directory_writable("tmp", &dir);
        assert_eq!(status, CheckStatus::Pass);
        assert!(msg.contains("可写"));
    }
}
