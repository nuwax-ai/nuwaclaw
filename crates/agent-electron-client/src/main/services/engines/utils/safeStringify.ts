/**
 * 安全 JSON 序列化：处理循环引用、BigInt、undefined 等边缘情况。
 * 替代分散在多个模块中的同名私有函数。
 */

export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}
