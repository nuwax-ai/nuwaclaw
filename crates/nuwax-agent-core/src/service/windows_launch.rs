use crate::utils::CommandNoWindowExt;
use tracing::{debug, info, warn};

fn package_candidates_for_program_name(program_name: &str) -> Vec<&str> {
    match program_name {
        // npm 包名是 mcp-stdio-proxy，但 bin 叫 mcp-proxy
        "mcp-proxy" => vec!["mcp-stdio-proxy", "mcp-proxy"],
        // file-server 早期在 subapp-deployer 目录维护，增加别名兜底
        "nuwax-file-server" => vec!["nuwax-file-server", "subapp-deployer"],
        _ => vec![program_name],
    }
}

fn is_node_js_entry(path: &std::path::Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("js" | "mjs" | "cjs")
    )
}

fn find_node_exe_for_windows_launch() -> Option<std::path::PathBuf> {
    if let Ok(node_from_env) = std::env::var("NUWAX_NODE_EXE") {
        let node_from_env = std::path::PathBuf::from(node_from_env);
        if node_from_env.exists() {
            debug!(
                "[Service] Windows node 解析命中环境变量 NUWAX_NODE_EXE: {}",
                node_from_env.display()
            );
            return Some(node_from_env);
        }
    }

    let local_node = crate::dependency::node::NodeDetector::get_local_node_path();
    if local_node.exists() {
        debug!(
            "[Service] Windows node 解析命中本地 runtime: {}",
            local_node.display()
        );
        return Some(local_node);
    }

    let output = match std::process::Command::new("where")
        .no_window()
        .arg("node.exe")
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            warn!("[Service] Windows node 解析失败: where node.exe 执行错误: {}", e);
            return None;
        }
    };
    if !output.status.success() {
        warn!(
            "[Service] Windows node 解析失败: where node.exe exit={:?}",
            output.status.code()
        );
        return None;
    }
    let binding = String::from_utf8_lossy(&output.stdout);
    let path = binding
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)?;
    debug!("[Service] Windows node 解析命中 PATH: {}", path);
    Some(std::path::PathBuf::from(path))
}

fn resolve_js_entry_from_npm_bin_shim(
    program: &std::path::Path,
    package_names: &[&str],
) -> Option<std::path::PathBuf> {
    let bin_dir = program.parent()?;
    let bin_name = bin_dir.file_name()?.to_string_lossy();
    if !bin_name.eq_ignore_ascii_case(".bin") {
        return None;
    }
    let node_modules_dir = bin_dir.parent()?;

    for package_name in package_names {
        let package_dir = node_modules_dir.join(package_name);
        if !package_dir.exists() {
            continue;
        }

        let package_json_path = package_dir.join("package.json");
        let content = match std::fs::read_to_string(&package_json_path) {
            Ok(c) => c,
            Err(e) => {
                debug!(
                    "[Service] package.json 读取失败，跳过: {} ({})",
                    package_json_path.display(),
                    e
                );
                continue;
            }
        };
        let package_json: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                debug!(
                    "[Service] package.json 解析失败，跳过: {} ({})",
                    package_json_path.display(),
                    e
                );
                continue;
            }
        };

        let bin_field = match package_json.get("bin") {
            Some(v) => v,
            None => continue,
        };
        let rel_entry = if let Some(bin_str) = bin_field.as_str() {
            Some(bin_str.to_string())
        } else if let Some(bin_obj) = bin_field.as_object() {
            bin_obj
                .get(*package_name)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    bin_obj
                        .values()
                        .find_map(|v| v.as_str())
                        .map(str::to_string)
                })
        } else {
            None
        };
        let Some(rel_entry) = rel_entry else {
            continue;
        };

        let js_entry = package_dir.join(rel_entry);
        if js_entry.exists() {
            debug!(
                "[Service] 私有 node_modules 入口解析命中: package={} entry={}",
                package_name,
                js_entry.display()
            );
            return Some(js_entry);
        }
    }
    None
}

fn resolve_js_entry_from_node_modules_dir(
    node_modules_dir: &std::path::Path,
    package_names: &[&str],
) -> Option<std::path::PathBuf> {
    for package_name in package_names {
        let package_dir = node_modules_dir.join(package_name);
        if !package_dir.exists() {
            continue;
        }

        let package_json_path = package_dir.join("package.json");
        let content = match std::fs::read_to_string(&package_json_path) {
            Ok(c) => c,
            Err(e) => {
                debug!(
                    "[Service] package.json 读取失败，跳过: {} ({})",
                    package_json_path.display(),
                    e
                );
                continue;
            }
        };
        let package_json: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                debug!(
                    "[Service] package.json 解析失败，跳过: {} ({})",
                    package_json_path.display(),
                    e
                );
                continue;
            }
        };

        let bin_field = match package_json.get("bin") {
            Some(v) => v,
            None => continue,
        };
        let rel_entry = if let Some(bin_str) = bin_field.as_str() {
            Some(bin_str.to_string())
        } else if let Some(bin_obj) = bin_field.as_object() {
            bin_obj
                .get(*package_name)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    bin_obj
                        .values()
                        .find_map(|v| v.as_str())
                        .map(str::to_string)
                })
        } else {
            None
        };
        let Some(rel_entry) = rel_entry else {
            continue;
        };

        let js_entry = package_dir.join(rel_entry);
        if js_entry.exists() {
            debug!(
                "[Service] node_modules 入口解析命中: package={} entry={}",
                package_name,
                js_entry.display()
            );
            return Some(js_entry);
        }
    }
    None
}

fn resolve_js_entry_from_known_windows_node_modules(
    package_names: &[&str],
) -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let appdata_path = std::path::PathBuf::from(&appdata);
    let candidates = [
        appdata_path
            .join("com.nuwax.agent-tauri-client")
            .join("node_modules"),
        appdata_path.join("npm").join("node_modules"),
    ];

    for node_modules_dir in candidates {
        if !node_modules_dir.exists() {
            continue;
        }
        if let Some(entry) = resolve_js_entry_from_node_modules_dir(&node_modules_dir, package_names)
        {
            return Some(entry);
        }
    }
    None
}

fn resolve_native_exe_from_known_windows_node_modules(
    package_names: &[&str],
    binary_name: &str,
) -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let appdata_path = std::path::PathBuf::from(&appdata);
    let candidates = [
        appdata_path
            .join("com.nuwax.agent-tauri-client")
            .join("node_modules"),
        appdata_path.join("npm").join("node_modules"),
    ];

    for node_modules_dir in candidates {
        if !node_modules_dir.exists() {
            continue;
        }
        for package_name in package_names {
            let package_dir = node_modules_dir.join(package_name);
            if !package_dir.exists() {
                continue;
            }
            // mcp-stdio-proxy 将原生二进制安装到 <pkg>/node_modules/.bin_real/
            let exe = package_dir
                .join("node_modules")
                .join(".bin_real")
                .join(format!("{}.exe", binary_name));
            if exe.exists() {
                return Some(exe);
            }
        }
    }
    None
}

fn get_windows_cmd_script_path(program: &std::path::Path) -> Option<std::path::PathBuf> {
    match program
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
    {
        Some(ext) if ext == "cmd" => Some(program.to_path_buf()),
        Some(_) => None,
        None => {
            let direct_candidate = program.with_extension("cmd");
            if direct_candidate.exists() {
                return Some(direct_candidate);
            }

            let program_name = program.file_name().and_then(|s| s.to_str())?;

            if let Ok(appdata) = std::env::var("APPDATA") {
                let app_private = std::path::PathBuf::from(&appdata)
                    .join("com.nuwax.agent-tauri-client")
                    .join("node_modules")
                    .join(".bin")
                    .join(format!("{}.cmd", program_name));
                if app_private.exists() {
                    return Some(app_private);
                }

                let npm_global = std::path::PathBuf::from(appdata)
                    .join("npm")
                    .join(format!("{}.cmd", program_name));
                if npm_global.exists() {
                    return Some(npm_global);
                }
            }

            let path_env = std::env::var("PATH").unwrap_or_default();
            for dir in path_env.split(';').filter(|s| !s.is_empty()) {
                let candidate = std::path::Path::new(dir).join(format!("{}.cmd", program_name));
                if candidate.exists() {
                    return Some(candidate);
                }
            }

            None
        }
    }
}

fn resolve_js_entry_from_cmd_shim(cmd_script: &std::path::Path) -> Option<std::path::PathBuf> {
    let content = match std::fs::read_to_string(cmd_script) {
        Ok(c) => c,
        Err(e) => {
            debug!(
                "[Service] cmd shim 读取失败: {} ({})",
                cmd_script.display(),
                e
            );
            return None;
        }
    };
    let base_dir = cmd_script.parent()?;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        let base_token = if line.contains("%~dp0") {
            "%~dp0"
        } else if line.contains("%dp0%") {
            "%dp0%"
        } else if line.contains("%dp0") {
            "%dp0"
        } else {
            continue;
        };
        let clean = line.replace('"', "");
        let clean_lower = clean.to_ascii_lowercase();
        let ext_end = [".cjs", ".mjs", ".js"]
            .iter()
            .filter_map(|ext| clean_lower.find(ext).map(|pos| pos + ext.len()))
            .min();
        let Some(end) = ext_end else {
            continue;
        };
        let start = clean.find(base_token)?;
        if end <= start + base_token.len() || end > clean.len() {
            continue;
        }
        let rel = clean[start + base_token.len()..end].trim_start_matches(['\\', '/']);
        if rel.is_empty() {
            continue;
        }
        let rel = rel.replace('/', "\\");
        let entry = base_dir.join(std::path::Path::new(&rel));
        if entry.exists() {
            debug!(
                "[Service] cmd shim 解析命中入口: {} -> {}",
                cmd_script.display(),
                entry.display()
            );
            return Some(entry);
        }
    }
    debug!(
        "[Service] cmd shim 未解析到入口: {}",
        cmd_script.display()
    );
    None
}

pub fn resolve_launch_command(program: &str, args: &[&str]) -> (String, Vec<String>) {
    let path = std::path::Path::new(program);
    if is_node_js_entry(path) {
        if let Some(node_exe) = find_node_exe_for_windows_launch() {
            let mut actual_args = Vec::with_capacity(args.len() + 1);
            actual_args.push(path.to_string_lossy().to_string());
            actual_args.extend(args.iter().map(|s| (*s).to_string()));
            info!(
                "[Service] Windows JS 入口转直连 node 启动: {} -> {}",
                program,
                node_exe.display()
            );
            return (node_exe.to_string_lossy().to_string(), actual_args);
        }
        warn!(
            "[Service] Windows JS 入口未找到 node.exe，保持原命令执行: {}",
            program
        );
    }

    let package_name = match path.extension().and_then(|s| s.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("cmd") => path.file_stem().and_then(|s| s.to_str()),
        None => path.file_name().and_then(|s| s.to_str()),
        _ => None,
    };
    let cmd_script = get_windows_cmd_script_path(path);

    if let (Some(node_exe), Some(cmd_script)) = (find_node_exe_for_windows_launch(), cmd_script.as_ref())
    {
        if let Some(js_entry) = resolve_js_entry_from_cmd_shim(cmd_script) {
            let mut actual_args = Vec::with_capacity(args.len() + 1);
            actual_args.push(js_entry.to_string_lossy().to_string());
            actual_args.extend(args.iter().map(|s| (*s).to_string()));
            info!(
                "[Service] Windows 命令转直连 node 启动(cmd shim): {} -> {} {}",
                program,
                node_exe.display(),
                js_entry.display()
            );
            return (node_exe.to_string_lossy().to_string(), actual_args);
        }
        debug!(
            "[Service] cmd shim 存在但未解析到 JS 入口，继续其他解析路径: {}",
            cmd_script.display()
        );
    }

    if let Some(package_name) = package_name {
        let package_candidates = package_candidates_for_program_name(package_name);

        // mcp-stdio-proxy 在 Windows 实际承载的是原生 mcp-proxy.exe，优先直启原生 exe，
        // 彻底绕过 node + js wrapper，避免 node.exe 控制台闪现/弹窗链路。
        if package_name == "mcp-proxy" {
            if let Some(native_exe) = resolve_native_exe_from_known_windows_node_modules(
                &package_candidates,
                "mcp-proxy",
            ) {
                info!(
                    "[Service] Windows 命令转直连原生可执行程序: {} -> {}",
                    program,
                    native_exe.display()
                );
                return (
                    native_exe.to_string_lossy().to_string(),
                    args.iter().map(|s| (*s).to_string()).collect(),
                );
            }
            debug!("[Service] mcp-proxy 原生 exe 解析失败，回退 node/js 解析路径");
        }

        for candidate in &package_candidates {
            if let Ok(pkg) = crate::dependency::node::resolve_npm_package_direct_path(candidate) {
                let mut actual_args = Vec::with_capacity(args.len() + 1);
                actual_args.push(pkg.js_entry.to_string_lossy().to_string());
                actual_args.extend(args.iter().map(|s| (*s).to_string()));

                info!(
                    "[Service] Windows 命令转直连 node 启动: {} -> {} {} (pkg={})",
                    program,
                    pkg.node_exe.display(),
                    pkg.js_entry.display(),
                    candidate
                );

                return (pkg.node_exe.to_string_lossy().to_string(), actual_args);
            }
        }
        debug!(
            "[Service] 包名直连 node 解析失败，尝试私有 node_modules 解析: {}",
            package_name
        );

        if let (Some(node_exe), Some(js_entry)) = (
            find_node_exe_for_windows_launch(),
            resolve_js_entry_from_npm_bin_shim(path, &package_candidates),
        ) {
            let mut actual_args = Vec::with_capacity(args.len() + 1);
            actual_args.push(js_entry.to_string_lossy().to_string());
            actual_args.extend(args.iter().map(|s| (*s).to_string()));
            info!(
                "[Service] Windows 命令转直连 node 启动(私有 node_modules): {} -> {} {}",
                program,
                node_exe.display(),
                js_entry.display()
            );
            return (node_exe.to_string_lossy().to_string(), actual_args);
        }
        if package_name == "nuwax-file-server" {
            if let (Some(node_exe), Some(js_entry)) = (
                find_node_exe_for_windows_launch(),
                resolve_js_entry_from_known_windows_node_modules(&["nuwax-file-server"]),
            ) {
                let mut actual_args = Vec::with_capacity(args.len() + 1);
                actual_args.push(js_entry.to_string_lossy().to_string());
                actual_args.extend(args.iter().map(|s| (*s).to_string()));
                info!(
                    "[Service] Windows file-server 兜底直连 node 启动(固定包名): {} -> {} {}",
                    program,
                    node_exe.display(),
                    js_entry.display()
                );
                return (node_exe.to_string_lossy().to_string(), actual_args);
            }
        }
        if let (Some(node_exe), Some(js_entry)) = (
            find_node_exe_for_windows_launch(),
            resolve_js_entry_from_known_windows_node_modules(&package_candidates),
        ) {
            let mut actual_args = Vec::with_capacity(args.len() + 1);
            actual_args.push(js_entry.to_string_lossy().to_string());
            actual_args.extend(args.iter().map(|s| (*s).to_string()));
            info!(
                "[Service] Windows 命令转直连 node 启动(已知 node_modules): {} -> {} {}",
                program,
                node_exe.display(),
                js_entry.display()
            );
            return (node_exe.to_string_lossy().to_string(), actual_args);
        }
        debug!(
            "[Service] 私有 node_modules 解析失败: program={}, package={}",
            program, package_name
        );

        // 硬防线：file-server 解析失败时禁止进入 cmd.exe /C 回退链路。
        if package_name == "nuwax-file-server" {
            warn!(
                "[Service] Windows file-server 解析失败，禁止 cmd 回退。保持原命令返回: {}",
                program
            );
            return (
                program.to_string(),
                args.iter().map(|s| (*s).to_string()).collect(),
            );
        }
    }

    if let Some(cmd_script) = cmd_script {
        let mut actual_args = Vec::with_capacity(args.len() + 2);
        actual_args.push("/C".to_string());
        actual_args.push(cmd_script.to_string_lossy().to_string());
        actual_args.extend(args.iter().map(|s| (*s).to_string()));
        info!(
            "[Service] Windows 命令回退 cmd.exe 启动: {} -> {}",
            program,
            cmd_script.display()
        );
        return ("cmd.exe".to_string(), actual_args);
    }
    warn!(
        "[Service] Windows 命令解析未命中任何直连/回退路径，保持原命令执行: {}",
        program
    );

    (
        program.to_string(),
        args.iter().map(|s| (*s).to_string()).collect(),
    )
}
