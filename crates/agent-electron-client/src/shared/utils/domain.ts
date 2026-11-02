/**
 * 域名标准化工具函数
 * 用于统一处理域名相关的存储键生成
 */

/**
 * 将域名标准化为存储键的一部分
 * 提取 hostname，移除协议、端口、路径
 *
 * @param domain - 原始域名（可能是 URL、hostname、或带协议的字符串）
 * @returns 标准化后的 hostname（小写）
 *
 * @example
 * normalizeDomainForTokenKey("https://example.com:8080/path") // "example.com"
 * normalizeDomainForTokenKey("example.com") // "example.com"
 * normalizeDomainForTokenKey("192.168.1.1:3000") // "192.168.1.1"
 */
export function normalizeDomainForTokenKey(domain: string): string {
  try {
    // 尝试解析为完整 URL
    const url = new URL(domain);
    return url.hostname.toLowerCase();
  } catch {
    // 解析失败，手动提取 hostname
    return domain
      .replace(/^https?:\/\//i, "") // 移除协议
      .split("/")[0] // 移除路径
      .split(":")[0] // 移除端口
      .toLowerCase();
  }
}

/**
 * 生成域名级别的 token 存储键
 *
 * @param domain - 原始域名
 * @returns 存储键，格式为 `auth.tokens.{hostname}`
 *
 * @example
 * getDomainTokenKey("https://example.com") // "auth.tokens.example.com"
 * getDomainTokenKey("http://localhost:3000") // "auth.tokens.localhost"
 */
export function getDomainTokenKey(domain: string): string {
  return `auth.tokens.${normalizeDomainForTokenKey(domain)}`;
}
