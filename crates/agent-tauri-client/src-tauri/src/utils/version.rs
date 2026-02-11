/// 检查版本是否满足最低要求
/// 例如: "22.21.1" >= "22.0.0" 应返回 true
pub fn check_version_meets_requirement(current: &str, required: &str) -> bool {
    let parse_version = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<&str> = v.split('.').collect();
        let major = parts
            .first()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let minor = parts
            .get(1)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let patch = parts
            .get(2)
            .and_then(|s| {
                // 处理可能带有后缀的版本号，如 "22.0.0-beta"
                let numeric_part: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                numeric_part.parse().ok()
            })
            .unwrap_or(0);
        (major, minor, patch)
    };

    let (cur_major, cur_minor, cur_patch) = parse_version(current);
    let (req_major, req_minor, req_patch) = parse_version(required);

    // 比较版本号：先比较 major，再比较 minor，最后比较 patch
    // 使用元组比较，更简洁可靠
    (cur_major, cur_minor, cur_patch) >= (req_major, req_minor, req_patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_version_meets_requirement() {
        // 基本版本比较
        assert!(check_version_meets_requirement("22.21.1", "22.0.0"));
        assert!(check_version_meets_requirement("1.2.3", "1.2.3"));
        assert!(check_version_meets_requirement("2.0.0", "1.9.9"));
        assert!(!check_version_meets_requirement("1.9.9", "2.0.0"));

        // 带后缀的版本号
        assert!(check_version_meets_requirement("22.0.0-beta", "22.0.0"));
        assert!(check_version_meets_requirement("1.2.3-alpha", "1.2.2"));

        // 不完整的版本号
        assert!(check_version_meets_requirement("1.2", "1.1.9"));
        assert!(check_version_meets_requirement("2", "1.9.9"));
    }
}
