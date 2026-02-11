use crate::commands::setup_wizard::app_data_dir_get;
use crate::models::*;
use crate::utils::*;
use nuwax_agent_core::dependency::DependencyManager as CoreDependencyManager;
use serde::{Deserialize, Serialize};
use std::env;
use std::process::Command;
use tauri::Manager;

// ========== 基础依赖命令 ==========

/// 获取所有依赖列表
#[tauri::command]
pub async fn dependency_list() -> Result<Vec<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    let dependencies = manager.get_all_dependencies().await;
    Ok(dependencies.iter().map(DependencyItemDto::from).collect())
}

/// 获取依赖统计
#[tauri::command]
pub async fn dependency_summary() -> Result<DependencySummaryDto, String> {
    let manager = CoreDependencyManager::new();
    let summary = manager.get_summary().await;
    Ok(DependencySummaryDto {
        total: summary.total,
        installed: summary.installed,
        missing: summary.missing,
    })
}

/// 安装指定依赖
#[tauri::command]
pub async fn dependency_install(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 安装所有缺失依赖
#[tauri::command]
pub async fn dependency_install_all() -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install_all_missing()
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 卸载指定依赖
#[tauri::command]
pub async fn dependency_uninstall(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .uninstall(&name)
        .await
        .map_err(|e| format!("卸载失败: {}", e))?;
    Ok(true)
}

/// 检查单个依赖状态
#[tauri::command]
pub async fn dependency_check(name: String) -> Result<Option<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(Some(DependencyItemDto::from(&item))),
        None => Ok(None),
    }
}

// ========== NPM 相关命令 ==========

/// 安装 npm 依赖
#[tauri::command]
pub async fn dependency_npm_install(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 查询 npm 依赖版本
#[tauri::command]
pub async fn dependency_npm_query_version(name: String) -> Result<Option<String>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(item.version),
        None => Ok(None),
    }
}

/// 重新安装 npm 依赖
#[tauri::command]
pub async fn dependency_npm_reinstall(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .uninstall(&name)
        .await
        .map_err(|e| format!("卸载失败: {}", e))?;
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

// ========== 初始化和检测命令 ==========

/// Node.js 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// npm 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmPackageResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// npm 包安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
    pub error: Option<String>,
}

/// Shell Installer 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInstallerResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// Node.js 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// uv 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// uv 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 跨平台查找可执行文件路径
/// macOS/Linux 使用 `which`，Windows 使用 `where`
fn which_command(bin_name: &str) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        Command::new("where").arg(bin_name).output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which").arg(bin_name).output()
    }
}

/// 跨平台解析 Node.js bin 目录
fn resolve_node_bin(bin_name: &str) -> String {
    // 1. 优先使用 ~/.local/bin 下的二进制（我们的安装路径）
    let local_bin_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin");

    #[cfg(windows)]
    let bin_path = local_bin_dir.join(format!("{}.exe", bin_name));
    #[cfg(not(windows))]
    let bin_path = local_bin_dir.join(bin_name);

    if bin_path.exists() {
        info!("[resolve_node_bin] {} -> {:?}", bin_name, bin_path);
        return bin_path.to_string_lossy().to_string();
    }

    // 2. 降级到 PATH
    info!("[resolve_node_bin] {} -> fallback to PATH", bin_name);
    bin_name.to_string()
}

/// 构建包含 node bin 目录的 PATH 环境变量
fn build_node_path_env() -> String {
    nuwax_agent_core::utils::build_node_path_env()
}

/// 获取包的 bin 文件路径
fn get_package_bin_path(app_dir: &str, package_name: &str) -> Option<String> {
    let pkg_json_path = std::path::Path::new(app_dir)
        .join("node_modules")
        .join(package_name)
        .join("package.json");

    if !pkg_json_path.exists() {
        return None;
    }

    if let Ok(content) = std::fs::read_to_string(&pkg_json_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(bin) = json.get("bin") {
                if let Some(bin_str) = bin.as_str() {
                    let bin_path = std::path::Path::new(app_dir)
                        .join("node_modules")
                        .join(package_name)
                        .join(bin_str);
                    return Some(bin_path.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

/// 初始化本地 npm 环境（创建 package.json）
#[tauri::command]
pub async fn dependency_local_env_init(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app_data_dir_get(app)?;
    let package_json_path = std::path::Path::new(&app_dir).join("package.json");

    // 检查是否已存在
    if package_json_path.exists() {
        return Ok(true);
    }

    // 创建 package.json
    let content = r#"{
  "name": "nuwax-agent-deps",
  "version": "1.0.0",
  "private": true,
  "description": "NuWax Agent 本地依赖"
}"#;

    std::fs::write(&package_json_path, content)
        .map_err(|e| format!("创建 package.json 失败: {}", e))?;

    Ok(true)
}

/// 检测 Node.js 版本
/// 检测顺序: 1) ~/.local/bin/node 2) 系统 PATH
#[tauri::command]
pub async fn dependency_node_detect(_app: tauri::AppHandle) -> Result<NodeVersionResult, String> {
    // 1. 检测 ~/.local/bin/node（我们的安装路径）
    let local_node_bin = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin")
        .join(if cfg!(windows) { "node.exe" } else { "node" });

    if local_node_bin.exists() {
        let output = Command::new(&local_node_bin).arg("--version").output();
        if let Ok(out) = output {
            if out.status.success() {
                let version_str = String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .trim_start_matches('v')
                    .to_string();
                let meets = check_version_meets_requirement(&version_str, "22.0.0");
                info!(
                    "[NodeDetect] ~/.local/bin/node: v{} (满足要求: {})",
                    version_str, meets
                );
                return Ok(NodeVersionResult {
                    installed: true,
                    version: Some(version_str),
                    meets_requirement: meets,
                });
            }
        }
    }

    // 2. 检测系统 PATH
    let output = Command::new("node").arg("--version").output();

    match output {
        Ok(out) if out.status.success() => {
            let version_str = String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_start_matches('v')
                .to_string();

            // 检查版本是否 >= 22.0.0
            let meets = check_version_meets_requirement(&version_str, "22.0.0");

            Ok(NodeVersionResult {
                installed: true,
                version: Some(version_str),
                meets_requirement: meets,
            })
        }
        _ => Ok(NodeVersionResult {
            installed: false,
            version: None,
            meets_requirement: false,
        }),
    }
}

/// 自动安装 Node.js（从打包资源复制到应用数据目录）
#[tauri::command]
pub async fn node_install_auto(app: tauri::AppHandle) -> Result<NodeInstallResult, String> {
    info!("[NodeInstall] 开始自动安装 Node.js...");

    // 1. 解析打包资源目录中的 node 路径
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("获取资源目录失败: {}", e))?;

    // 资源目录结构: $RESOURCE/resources/node/{bin,lib}
    let bundled_node_dir = resource_dir.join("resources").join("node");

    // 开发模式下的回退路径
    let bundled_node_dir = if !bundled_node_dir.exists() {
        // 开发模式: 直接使用 src-tauri/resources/node
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("node");
        if dev_path.exists() {
            info!("[NodeInstall] 使用开发模式资源路径: {:?}", dev_path);
            dev_path
        } else {
            // 再尝试从 cargo manifest 目录
            let manifest_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("node");
            if manifest_path.exists() {
                info!(
                    "[NodeInstall] 使用 CARGO_MANIFEST_DIR 资源路径: {:?}",
                    manifest_path
                );
                manifest_path
            } else {
                return Ok(NodeInstallResult {
                    success: false,
                    version: None,
                    error: Some("未找到打包的 Node.js 资源".to_string()),
                });
            }
        }
    } else {
        bundled_node_dir
    };

    // 2. 安装到 ~/.local/bin 和 ~/.local/lib
    match nuwax_agent_core::utils::install_bundled_node(&bundled_node_dir) {
        Ok(info) => {
            info!(
                "[NodeInstall] Node.js 安装成功，版本: {}，路径: {}",
                info.version, info.bin_path
            );
            Ok(NodeInstallResult {
                success: true,
                version: Some(info.version),
                error: None,
            })
        }
        Err(e) => {
            error!("[NodeInstall] 安装失败: {}", e);
            Ok(NodeInstallResult {
                success: false,
                version: None,
                error: Some(format!("安装失败: {}", e)),
            })
        }
    }
}

/// 检测 uv 版本
/// uv 是高性能的 Python 包管理器
#[tauri::command]
pub async fn dependency_uv_detect() -> Result<UvVersionResult, String> {
    // 辅助闭包: 从 uv --version 输出中提取版本号
    fn parse_uv_version(stdout: &[u8]) -> Option<String> {
        let output_str = String::from_utf8_lossy(stdout).trim().to_string();
        output_str
            .split_whitespace()
            .nth(1)
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    }

    // 1. 检测全局安装路径（优先级最高）
    // 使用 ~/.local/bin/ 与 UvInstaller 保持一致的路径
    let local_uv_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin");

    #[cfg(unix)]
    let local_uv_bin = local_uv_dir.join("uv");
    #[cfg(windows)]
    let local_uv_bin = local_uv_dir.join("uv.exe");

    if local_uv_bin.exists() {
        let output = Command::new(&local_uv_bin).arg("--version").output();
        if let Ok(out) = output {
            if out.status.success() {
                if let Some(version_str) = parse_uv_version(&out.stdout) {
                    let meets = check_version_meets_requirement(&version_str, "0.5.0");
                    info!("[UvDetect] 本地 uv: v{} (满足要求: {})", version_str, meets);
                    return Ok(UvVersionResult {
                        installed: true,
                        version: Some(version_str),
                        meets_requirement: meets,
                    });
                }
            }
        }
    }

    // 2. 检测系统 PATH
    let output = Command::new("uv").arg("--version").output();

    match output {
        Ok(out) if out.status.success() => {
            // uv 输出格式: "uv 0.10.0 (homebrew)"
            let version_str = parse_uv_version(&out.stdout);
            let meets = version_str
                .as_ref()
                .map(|v| check_version_meets_requirement(v, "0.5.0"))
                .unwrap_or(false);

            Ok(UvVersionResult {
                installed: true,
                version: version_str,
                meets_requirement: meets,
            })
        }
        _ => Ok(UvVersionResult {
            installed: false,
            version: None,
            meets_requirement: false,
        }),
    }
}

/// 自动安装 uv（从打包资源复制到应用数据目录）
#[tauri::command]
pub async fn uv_install_auto(app: tauri::AppHandle) -> Result<UvInstallResult, String> {
    info!("[UvInstall] 开始自动安装 uv...");

    // 1. 解析打包资源目录中的 uv 路径
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("获取资源目录失败: {}", e))?;

    let bundled_uv_dir = resource_dir.join("resources").join("uv");
    info!(
        "[UvInstall] 打包资源路径: {:?}, exists={}",
        bundled_uv_dir,
        bundled_uv_dir.exists()
    );

    // 开发模式下的回退路径
    let bundled_uv_dir = if !bundled_uv_dir.exists() {
        // 开发模式: 尝试 cwd/resources/uv (Tauri dev 从 src-tauri/ 启动)
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("uv");
        info!(
            "[UvInstall] 开发模式路径1: {:?}, exists={}",
            dev_path,
            dev_path.exists()
        );

        if dev_path.exists() {
            info!("[UvInstall] 使用开发模式资源路径: {:?}", dev_path);
            dev_path
        } else {
            // 再尝试从 cargo manifest 目录
            let manifest_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("uv");
            info!(
                "[UvInstall] 开发模式路径2: {:?}, exists={}",
                manifest_path,
                manifest_path.exists()
            );
            if manifest_path.exists() {
                info!(
                    "[UvInstall] 使用 CARGO_MANIFEST_DIR 资源路径: {:?}",
                    manifest_path
                );
                manifest_path
            } else {
                return Ok(UvInstallResult {
                    success: false,
                    version: None,
                    error: Some("未找到打包的 uv 资源".to_string()),
                });
            }
        }
    } else {
        bundled_uv_dir
    };

    // 2. 安装到 ~/.local/bin
    match nuwax_agent_core::utils::install_bundled_uv(&bundled_uv_dir) {
        Ok(info) => {
            info!(
                "[UvInstall] uv 安装成功，版本: {}，路径: {}",
                info.version, info.bin_path
            );
            Ok(UvInstallResult {
                success: true,
                version: Some(info.version),
                error: None,
            })
        }
        Err(e) => {
            error!("[UvInstall] 安装失败: {}", e);
            Ok(UvInstallResult {
                success: false,
                version: None,
                error: Some(format!("安装失败: {}", e)),
            })
        }
    }
}

/// 检测本地 npm 包是否已安装
#[tauri::command]
pub async fn dependency_local_check(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<NpmPackageResult, String> {
    let app_dir = app_data_dir_get(app)?;
    let node_modules = std::path::Path::new(&app_dir).join("node_modules");
    let package_dir = node_modules.join(&package_name);

    // 检查包目录是否存在
    if !package_dir.exists() {
        return Ok(NpmPackageResult {
            installed: false,
            version: None,
            bin_path: None,
        });
    }

    // 读取 package.json 获取版本
    let pkg_json_path = package_dir.join("package.json");
    let version = if pkg_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json_path) {
            serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v["version"].as_str().map(String::from))
        } else {
            None
        }
    } else {
        None
    };

    // 获取 bin 路径
    let bin_path = get_package_bin_path(&app_dir, &package_name);

    Ok(NpmPackageResult {
        installed: true,
        version,
        bin_path,
    })
}

/// 安装 npm 包到本地目录（使用 npmmirror）
#[tauri::command]
pub async fn dependency_local_install(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<InstallResult, String> {
    let app_dir = app_data_dir_get(app.clone())?;
    let registry = "https://registry.npmmirror.com/";

    // 确保 npm 环境已初始化
    dependency_local_env_init(app.clone()).await?;

    // 执行 npm install
    let npm_bin = resolve_node_bin("npm");
    let node_path = build_node_path_env();
    let output = Command::new(&npm_bin)
        .env("PATH", &node_path)
        .args([
            "install",
            &package_name,
            "--prefix",
            &app_dir,
            "--registry",
            registry,
        ])
        .output()
        .map_err(|e| format!("执行 npm install 失败: {}", e))?;

    if output.status.success() {
        // 获取安装的版本
        let result = dependency_local_check(app, package_name.clone()).await?;

        Ok(InstallResult {
            success: true,
            version: result.version,
            bin_path: result.bin_path,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(stderr),
        })
    }
}

/// 查询 npm 包的最新版本号
#[tauri::command]
pub async fn dependency_local_check_latest(package_name: String) -> Result<Option<String>, String> {
    let registry = "https://registry.npmmirror.com/";
    let npm_bin = resolve_node_bin("npm");
    let node_path = build_node_path_env();
    let output = Command::new(&npm_bin)
        .env("PATH", &node_path)
        .args(["view", &package_name, "version", "--registry", registry])
        .output()
        .map_err(|e| format!("执行 npm view 失败: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            Ok(None)
        } else {
            Ok(Some(version))
        }
    } else {
        Ok(None)
    }
}

/// 检测 Shell Installer 安装的包是否已安装
#[tauri::command]
pub async fn dependency_shell_installer_check(
    bin_name: String,
) -> Result<ShellInstallerResult, String> {
    // 跨平台检查二进制文件是否存在
    let which_output = which_command(&bin_name);

    match which_output {
        Ok(out) if out.status.success() => {
            let bin_path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // Windows `where` 可能返回多行，取第一行
            let bin_path = bin_path.lines().next().unwrap_or(&bin_path).to_string();

            // 尝试获取版本信息
            let version = Command::new(&bin_name)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    let output = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // 尝试从输出中提取版本号
                    // 常见格式: "mcp-proxy 0.1.27" 或 "v0.1.27"
                    output
                        .split_whitespace()
                        .find(|s| {
                            s.chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || c == 'v')
                                .unwrap_or(false)
                        })
                        .map(|s| s.trim_start_matches('v').to_string())
                        .unwrap_or(output)
                });

            Ok(ShellInstallerResult {
                installed: true,
                version,
                bin_path: Some(bin_path),
            })
        }
        _ => Ok(ShellInstallerResult {
            installed: false,
            version: None,
            bin_path: None,
        }),
    }
}

/// 使用 Shell 脚本安装包
/// macOS/Linux: curl ... | sh
/// Windows: powershell irm ... | iex
#[tauri::command]
pub async fn dependency_shell_installer_install(
    installer_url: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    info!("[Dependency] 执行安装脚本: {}", installer_url);

    #[cfg(not(target_os = "windows"))]
    let output = {
        // 先检查 curl 是否可用
        let curl_check = Command::new("curl").arg("--version").output();

        if curl_check.is_err() || !curl_check.unwrap().status.success() {
            return Ok(InstallResult {
                success: false,
                version: None,
                bin_path: None,
                error: Some("curl 未安装。请先安装 curl".to_string()),
            });
        }

        // 执行: curl --proto '=https' --tlsv1.2 -LsSf <url> | sh
        Command::new("sh")
            .arg("-c")
            .arg(format!(
                "curl --proto '=https' --tlsv1.2 -LsSf {} | sh",
                installer_url
            ))
            .output()
            .map_err(|e| format!("执行安装脚本失败: {}", e))?
    };

    #[cfg(target_os = "windows")]
    let output = {
        // Windows: 使用 PowerShell 的 irm (Invoke-RestMethod) | iex (Invoke-Expression)
        // 许多现代安装脚本（如 cargo-binstall、uv 等）提供 .ps1 安装脚本
        // 尝试将 URL 末尾的 .sh 替换为 .ps1
        let ps_url = if let Some(base) = installer_url.strip_suffix(".sh") {
            format!("{}.ps1", base)
        } else {
            installer_url.clone()
        };

        Command::new("powershell")
            .args([
                "-ExecutionPolicy",
                "ByPass",
                "-Command",
                &format!("irm {} | iex", ps_url),
            ])
            .output()
            .map_err(|e| format!("执行 PowerShell 安装脚本失败: {}", e))?
    };

    if output.status.success() {
        // 验证安装并获取路径
        let check_result = dependency_shell_installer_check(bin_name.clone()).await?;

        if check_result.installed {
            Ok(InstallResult {
                success: true,
                version: check_result.version,
                bin_path: check_result.bin_path,
                error: None,
            })
        } else {
            // 脚本执行成功但二进制未找到，可能需要重新加载 PATH
            Ok(InstallResult {
                success: true,
                version: None,
                bin_path: None,
                error: Some(format!(
                    "安装脚本执行成功，但未找到 {} 二进制文件。可能需要重启终端或重新加载 PATH",
                    bin_name
                )),
            })
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        error!("[Dependency] shell 安装脚本失败: {}", stderr);

        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(format!("{}\n{}", stderr, stdout)),
        })
    }
}

// ========== 全局 npm 包管理命令 ==========

/// 检测全局 npm 包是否已安装
/// 通过检查可执行文件是否存在来判断
#[tauri::command]
pub async fn dependency_npm_global_check(bin_name: String) -> Result<NpmPackageResult, String> {
    let node_path = build_node_path_env();

    // 跨平台检查二进制文件是否存在
    let which_output = {
        #[cfg(target_os = "windows")]
        {
            Command::new("where")
                .env("PATH", &node_path)
                .arg(&bin_name)
                .output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("which")
                .env("PATH", &node_path)
                .arg(&bin_name)
                .output()
        }
    };

    match which_output {
        Ok(out) if out.status.success() => {
            let bin_path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // Windows `where` 可能返回多行，取第一行
            let bin_path = bin_path.lines().next().unwrap_or(&bin_path).to_string();

            // 尝试获取版本信息 (使用 -V 参数)
            let version = Command::new(&bin_name)
                .env("PATH", &node_path)
                .arg("-V")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    let output = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // 尝试从输出中提取版本号
                    // 常见格式: "mcp-proxy 0.1.27" 或 "v0.1.27" 或 "0.1.27"
                    output
                        .split_whitespace()
                        .find(|s| {
                            s.chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || c == 'v')
                                .unwrap_or(false)
                        })
                        .map(|s| s.trim_start_matches('v').to_string())
                        .unwrap_or(output)
                });

            Ok(NpmPackageResult {
                installed: true,
                version,
                bin_path: Some(bin_path),
            })
        }
        _ => Ok(NpmPackageResult {
            installed: false,
            version: None,
            bin_path: None,
        }),
    }
}

/// 全局安装 npm 包（使用 npmmirror）
#[tauri::command]
pub async fn dependency_npm_global_install(
    package_name: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    let registry = "https://registry.npmmirror.com/";

    info!(
        "[Dependency] 开始全局安装 npm 包: {} (registry: {})",
        package_name, registry
    );

    // 执行 npm install -g
    let npm_bin = resolve_node_bin("npm");
    let node_path = build_node_path_env();
    let output = Command::new(&npm_bin)
        .env("PATH", &node_path)
        .args([
            "install",
            "-g",
            &format!("{}@latest", package_name),
            "--registry",
            registry,
        ])
        .output()
        .map_err(|e| format!("执行 npm install -g 失败: {}", e))?;

    if output.status.success() {
        // 验证安装并获取路径
        let check_result = dependency_npm_global_check(bin_name.clone()).await?;

        if check_result.installed {
            info!(
                "[Dependency] {} 全局安装成功, 版本: {:?}",
                package_name, check_result.version
            );
            Ok(InstallResult {
                success: true,
                version: check_result.version,
                bin_path: check_result.bin_path,
                error: None,
            })
        } else {
            // 安装成功但二进制未找到，可能需要重新加载 PATH
            Ok(InstallResult {
                success: true,
                version: None,
                bin_path: None,
                error: Some(format!(
                    "npm install 执行成功，但未找到 {} 二进制文件。可能需要重启终端或重新加载 PATH",
                    bin_name
                )),
            })
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        error!("[Dependency] npm install -g 失败: {}", stderr);

        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(format!("{}\n{}", stderr, stdout)),
        })
    }
}

// ========== 辅助函数 ==========
