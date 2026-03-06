/**
 * 日志脱敏：避免将 api_key、token、agent_config.env 等敏感信息写入日志。
 *
 * 使用方式：在 log.info/debug 前对对象调用 redactForLog(obj)，或对字符串调用 redactStringForLog(s).
 */

/** 需要脱敏的键名（小写匹配），值替换为前缀 + "..." */
const SENSITIVE_KEYS_LOWER = new Set([
  'api_key',
  'apikey',
  'anthropic_api_key',
  'anthropic_auth_token',
  'openai_api_key',
  'sandbox_access_key',
  'auth_token',
  'access_key',
  'secret',
  'password',
  'token',
  'amap_maps_api_key',
]);

/** 键名匹配这些模式则脱敏（如 *_API_KEY, *_TOKEN） */
const SENSITIVE_KEY_PATTERNS = /_(?:API_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET|PASSWORD|TOKEN)$/i;

/** 脱敏后显示的前缀长度（ak-xxxx 保留前 8 个字符） */
const MASK_PREFIX_LEN = 8;

function maskValue(value: string): string {
  if (!value || typeof value !== 'string') return '***';
  const trimmed = value.trim();
  if (trimmed.length <= MASK_PREFIX_LEN) return '***';
  return trimmed.slice(0, Math.min(MASK_PREFIX_LEN, Math.floor(trimmed.length / 2))) + '...';
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS_LOWER.has(lower)) return true;
  if (SENSITIVE_KEY_PATTERNS.test(key)) return true;
  return false;
}

/**
 * 深拷贝对象并在拷贝中脱敏敏感字段（不修改原对象）
 */
export function redactForLog(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactForLog(item));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      if (value === null) {
        out[key] = null;
      } else if (typeof value === 'string') {
        out[key] = maskValue(value);
      } else if (typeof value === 'object') {
        // 嵌套对象也脱敏（如 env.api_key）
        out[key] = redactForLog(value);
      } else {
        out[key] = '***';
      }
      continue;
    }
    out[key] = redactForLog(value);
  }
  return out;
}

/**
 * 对 JSON 字符串中的敏感值做正则脱敏（用于已序列化的 agent_config 等）
 * - 匹配 "key": "ak-xxx" / "key": "sk-xxx" 等
 * - 匹配 URL 中的 ak=xxx
 * - 匹配常见 API key 前缀：ak-, sk-, sak-, pk-,Bearer 等
 */
export function redactStringForLog(s: string): string {
  if (typeof s !== 'string') return String(s);
  return s
    .replace(/"((?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|SANDBOX_ACCESS_KEY|OPENAI_API_KEY|api_key|apiKey|AMAP_MAPS_API_KEY))"\s*:\s*"([^"]+)"/gi, (_, k, v) => {
      return `"${k}":"${maskValue(v)}"`;
    })
    .replace(/([?&]ak=)([a-zA-Z0-9_-]+)/g, (_, prefix) => `${prefix}***`)
    .replace(/([?&]ts=)([a-zA-Z0-9_-]+)/g, (_, prefix) => `${prefix}***`)
    // 匹配常见 API key 前缀：ak-, sk-, sak-, pk-,Bearer
    .replace(/(ak-[a-zA-Z0-9]{8})[a-zA-Z0-9_-]+/g, '$1...')
    .replace(/(sk-[a-zA-Z0-9]{8})[a-zA-Z0-9_-]+/g, '$1...')
    .replace(/(sak-[a-zA-Z0-9]{8})[a-zA-Z0-9_-]+/g, '$1...')
    .replace(/(pk-[a-zA-Z0-9]{8})[a-zA-Z0-9_-]+/g, '$1...')
    // Bearer token
    .replace(/(Bearer\s+)([a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]+/gi, '$1$2...');
}
