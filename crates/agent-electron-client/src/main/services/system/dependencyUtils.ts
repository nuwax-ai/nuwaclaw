/**
 * 版本比较工具（仅支持纯数字 semver，如 1.2.3 或 v1.2.3；不处理 pre-release 标签）
 * 返回: 1 = a > b, 0 = a == b, -1 = a < b
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.replace(/^v/, "").split(".").map(Number);
  const bParts = b.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }
  return 0;
}
