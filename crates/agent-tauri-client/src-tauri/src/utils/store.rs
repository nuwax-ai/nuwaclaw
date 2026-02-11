// Store 工具函数模块
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// 从 store 读取字符串配置（带详细日志和错误信息）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到字符串值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（store 打开失败或值类型错误）
pub fn read_store_string(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    // 尝试打开 store 文件
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => {
            debug!("[Store] 成功打开 store 文件");
            store
        }
        Err(e) => {
            warn!("[Store] 打开 store 文件失败: {}", e);
            return Err(format!("无法打开 store 文件: {}", e));
        }
    };

    // 尝试获取键对应的值
    match store.get(key) {
        Some(value) => {
            debug!("[Store] 找到键 '{}'，值类型: {:?}", key, value);
            // 尝试转换为字符串
            match value.as_str() {
                Some(s) => {
                    // 如果是敏感信息（如密钥），只打印前后各 4 个字符
                    if key.contains("key") || key.contains("secret") || key.contains("password") {
                        let masked = if s.len() > 8 {
                            format!("{}****{}", &s[..4], &s[s.len() - 4..])
                        } else {
                            "****".to_string()
                        };
                        debug!("[Store] 成功读取 '{}' = \"{}\"", key, masked);
                    } else {
                        debug!("[Store] 成功读取 '{}' = \"{}\"", key, s);
                    }
                    Ok(Some(s.to_string()))
                }
                None => {
                    warn!(
                        "[Store] 值类型错误: '{}' 不是字符串类型，实际类型: {:?}",
                        key, value
                    );
                    Err(format!(
                        "值类型错误: '{}' 期望字符串类型，实际类型: {:?}",
                        key, value
                    ))
                }
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
        }
    }
}

/// 从 store 读取 i64 配置（带详细日志和错误信息）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到整数值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（store 打开失败或值类型错误）
pub fn read_store_i64(app: &AppHandle, key: &str) -> Result<Option<i64>, String> {
    // 尝试打开 store 文件
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => {
            debug!("[Store] 成功打开 store 文件");
            store
        }
        Err(e) => {
            warn!("[Store] 打开 store 文件失败: {}", e);
            return Err(format!("无法打开 store 文件: {}", e));
        }
    };

    // 尝试获取键对应的值
    match store.get(key) {
        Some(value) => {
            debug!("[Store] 找到键 '{}'，值类型: {:?}", key, value);
            // 尝试转换为 i64
            match value.as_i64() {
                Some(n) => {
                    debug!("[Store] 成功读取 '{}' = {}", key, n);
                    Ok(Some(n))
                }
                None => {
                    warn!(
                        "[Store] 值类型错误: '{}' 不是数字类型，实际类型: {:?}",
                        key, value
                    );
                    Err(format!(
                        "值类型错误: '{}' 期望数字类型，实际类型: {:?}",
                        key, value
                    ))
                }
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
        }
    }
}

/// 从 store 读取端口配置（i64 转 u16），带详细日志
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到端口值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（值类型错误或转换失败）
pub fn read_store_port(app: &AppHandle, key: &str) -> Result<Option<u16>, String> {
    match read_store_i64(app, key) {
        Ok(Some(n)) => {
            // 检查端口范围合法性
            if !(0..=65535).contains(&n) {
                warn!(
                    "[Store] 端口值越界: '{}' = {}，端口范围应为 0-65535",
                    key, n
                );
                return Err(format!(
                    "端口值越界: '{}' = {}，端口范围应为 0-65535",
                    key, n
                ));
            }
            debug!("[Store] 成功读取端口 '{}' = {}", key, n);
            Ok(Some(n as u16))
        }
        Ok(None) => {
            debug!("[Store] 端口键不存在: '{}'", key);
            Ok(None)
        }
        Err(e) => {
            // 已经是错误信息，直接透传
            Err(e)
        }
    }
}

/// 从 store 读取布尔配置（如是否捕获 file-server 日志到 agent）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取
/// - `Ok(None)`: 键不存在或类型非布尔
/// - `Err(message)`: store 打开失败
pub fn read_store_bool(app: &AppHandle, key: &str) -> Result<Option<bool>, String> {
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => store,
        Err(e) => return Err(format!("无法打开 store 文件: {}", e)),
    };
    match store.get(key) {
        Some(value) => {
            if let Some(b) = value.as_bool() {
                debug!("[Store] 成功读取 '{}' = {}", key, b);
                Ok(Some(b))
            } else {
                debug!("[Store] 键 '{}' 类型不是布尔，忽略", key);
                Ok(None)
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
        }
    }
}
