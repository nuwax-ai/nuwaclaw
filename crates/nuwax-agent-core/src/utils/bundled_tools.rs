//! 打包工具安装模块
//!
//! 提供从打包资源安装 Node.js 和 uv 工具的功能

use std::fs;
use std::path::Path;

/// 安装信息结构体
#[derive(Debug, Clone)]
pub struct InstallInfo {
    /// 安装的工具版本
    pub version: String,
    /// 可执行文件路径
    pub bin_path: String,
}

/// 从打包的资源目录安装 Node.js 到 ~/.local/bin 和 ~/.local/lib
///
/// # 参数
/// - `bundled_node_dir`: 打包的 Node.js 资源目录路径
///
/// # 返回
/// - `Ok(InstallInfo)`: 安装成功，返回版本和路径信息
/// - `Err(Box<dyn std::error::Error>)`: 安装失败
///
/// # 实现说明
/// 1. 从 bundled_node_dir 复制 Node.js 文件到 ~/.local/bin/node
/// 2. 从 bundled_node_dir 复制库文件到 ~/.local/lib/
/// 3. 设置可执行权限
/// 4. 验证安装并返回版本信息
pub fn install_bundled_node(
    bundled_node_dir: &Path,
) -> Result<InstallInfo, Box<dyn std::error::Error>> {
    use std::os::unix::fs::PermissionsExt;

    // 获取用户主目录
    let home_dir = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let local_bin_dir = home_dir.join(".local").join("bin");
    let local_lib_dir = home_dir.join(".local").join("lib");

    // 确保目标目录存在
    fs::create_dir_all(&local_bin_dir)?;
    fs::create_dir_all(&local_lib_dir)?;

    // 查找 Node.js 可执行文件
    let node_bin_source = if cfg!(target_os = "windows") {
        bundled_node_dir.join("node.exe")
    } else {
        bundled_node_dir.join("bin").join("node")
    };

    if !node_bin_source.exists() {
        return Err(format!("未找到 Node.js 可执行文件: {:?}", node_bin_source).into());
    }

    // 目标路径
    let node_bin_target = if cfg!(target_os = "windows") {
        local_bin_dir.join("node.exe")
    } else {
        local_bin_dir.join("node")
    };

    // 复制可执行文件
    fs::copy(&node_bin_source, &node_bin_target)?;

    // 设置可执行权限（仅 Unix-like 系统）
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&node_bin_target)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&node_bin_target, perms)?;
    }

    // 如果有 lib 目录，复制相关库文件
    let lib_source_dir = bundled_node_dir.join("lib");
    if lib_source_dir.exists() {
        // 创建 node 专用库目录
        let node_lib_target = local_lib_dir.join("node");
        fs::create_dir_all(&node_lib_target)?;

        // 复制库文件（这里简化处理，实际可能需要递归复制）
        if let Ok(entries) = fs::read_dir(&lib_source_dir) {
            for entry in entries.flatten() {
                if let Ok(file_name) = entry.file_name().into_string() {
                    let source_path = entry.path();
                    let target_path = node_lib_target.join(&file_name);
                    if source_path.is_file() {
                        let _ = fs::copy(&source_path, &target_path);
                    }
                }
            }
        }
    }

    // 获取版本信息
    let version_output = std::process::Command::new(&node_bin_target)
        .arg("--version")
        .output()?;

    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    Ok(InstallInfo {
        version,
        bin_path: node_bin_target.to_string_lossy().to_string(),
    })
}

/// 从打包的资源目录安装 uv 工具到 ~/.local/bin
///
/// # 参数
/// - `bundled_uv_dir`: 打包的 uv 资源目录路径
///
/// # 返回
/// - `Ok(InstallInfo)`: 安装成功，返回版本和路径信息
/// - `Err(Box<dyn std::error::Error>)`: 安装失败
///
/// # 实现说明
/// 1. 从 bundled_uv_dir 复制 uv 可执行文件到 ~/.local/bin/uv
/// 2. 设置可执行权限
/// 3. 验证安装并返回版本信息
pub fn install_bundled_uv(
    bundled_uv_dir: &Path,
) -> Result<InstallInfo, Box<dyn std::error::Error>> {
    use std::os::unix::fs::PermissionsExt;

    // 获取用户主目录
    let home_dir = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let local_bin_dir = home_dir.join(".local").join("bin");

    // 确保目标目录存在
    fs::create_dir_all(&local_bin_dir)?;

    // 查找 uv 可执行文件
    let uv_bin_source = if cfg!(target_os = "windows") {
        bundled_uv_dir.join("uv.exe")
    } else {
        // uv 可能在根目录或 bin 子目录
        let root_uv = bundled_uv_dir.join("uv");
        let bin_uv = bundled_uv_dir.join("bin").join("uv");

        if root_uv.exists() {
            root_uv
        } else if bin_uv.exists() {
            bin_uv
        } else {
            return Err(format!("未找到 uv 可执行文件在: {:?}", bundled_uv_dir).into());
        }
    };

    if !uv_bin_source.exists() {
        return Err(format!("未找到 uv 可执行文件: {:?}", uv_bin_source).into());
    }

    // 目标路径
    let uv_bin_target = if cfg!(target_os = "windows") {
        local_bin_dir.join("uv.exe")
    } else {
        local_bin_dir.join("uv")
    };

    // 复制可执行文件
    fs::copy(&uv_bin_source, &uv_bin_target)?;

    // 设置可执行权限（仅 Unix-like 系统）
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&uv_bin_target)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&uv_bin_target, perms)?;
    }

    // 获取版本信息
    let version_output = std::process::Command::new(&uv_bin_target)
        .arg("--version")
        .output()?;

    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    Ok(InstallInfo {
        version,
        bin_path: uv_bin_target.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_install_info_creation() {
        let info = InstallInfo {
            version: "v22.0.0".to_string(),
            bin_path: "/home/user/.local/bin/node".to_string(),
        };
        assert_eq!(info.version, "v22.0.0");
        assert!(info.bin_path.contains(".local/bin"));
    }
}
