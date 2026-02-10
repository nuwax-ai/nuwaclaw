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
            auto_fixable: true,
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

    // 检查 node
    let node_ok = which::which("node").is_ok();
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
            "Node.js 未安装，部分功能不可用".to_string()
        },
        fix_hint: if node_ok {
            None
        } else {
            Some("请在依赖管理页面安装 Node.js".to_string())
        },
        auto_fixable: false,
    });

    // 检查 uv (Python 包管理器)
    let uv_ok = which::which("uv").is_ok();
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
            "uv 未安装，MCP 工具相关功能不可用".to_string()
        },
        fix_hint: if uv_ok {
            None
        } else {
            Some("请在依赖管理页面安装 uv".to_string())
        },
        auto_fixable: false,
    });

    checks
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
        let config = PreflightConfig::default();
        let result = run_preflight(&config).await;
        // 空配置下没有端口/目录检查，只有依赖检查（可能通过也可能不通过）
        assert!(!result.checks.is_empty());
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

        // 清理
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
