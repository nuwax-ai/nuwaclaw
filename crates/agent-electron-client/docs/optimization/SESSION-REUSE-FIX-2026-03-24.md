# Session Reuse Fix - 2026-03-24

## Problem

连续会话（同一个 project）每次消息都需要重新创建 engine，导致约 3-7 秒的额外延迟。

## Root Cause

`detectConfigChange` 比较环境变量时，`OPENCODE_LOG_DIR` 的值不一致：

- `engineConfigs` 存储的是**本地化后的路径**: `/Users/apple/.nuwaclaw/logs`
- `resolvedEnv` 来自请求，包含**容器路径**: `/app/container-logs`

即使两个路径在功能上等价（容器路径会被本地化），字符串比较仍然返回不同，导致 `envChanged: true`，触发 engine 重建。

## Solution

在 `detectConfigChange` 方法中添加与 `ensureEngineForRequest` 相同的本地化逻辑：

```typescript
// unifiedAgent.ts lines 927-938
let normalizedResolvedEnv = resolvedEnv;
if (
  resolvedEnv?.OPENCODE_LOG_DIR &&
  !fs.existsSync(resolvedEnv.OPENCODE_LOG_DIR)
) {
  normalizedResolvedEnv = {
    ...resolvedEnv,
    OPENCODE_LOG_DIR: path.join(os.homedir(), APP_DATA_DIR_NAME, "logs"),
  };
}
```

然后用 `normalizedResolvedEnv` 进行比较，而非原始的 `resolvedEnv`。

## Performance Impact

### Before Fix

| Request | Engine Time | Path |
|---------|-------------|------|
| 1st | 3797ms | fullPath (create) |
| 2nd | 3063ms | fullPath (recreate - config changed) |
| 3rd | 6028ms | fullPath (recreate - config changed) |

### After Fix

| Request | Engine Time | Path |
|---------|-------------|------|
| 1st | 2894ms | fullPath (create) |
| 2nd | 5ms | fastPath (reuse) |
| 3rd+ | ~5ms | fastPath (reuse) |

**Improvement**: 连续消息的 engine 准备时间从 3-7 秒降至 ~5ms（99%+ 减少）

## Files Changed

- `src/main/services/engines/unifiedAgent.ts`: 添加 `OPENCODE_LOG_DIR` 本地化到 `detectConfigChange` 方法

## Test Verification

1. 发送第一条消息到新 project → 观察 `engine.getOrCreate: ~3000ms`
2. 发送第二条消息到同一 project → 观察 `engine.ensure: ~5ms`
3. 日志应显示 `detectConfigChange: unchanged` 或无 CHANGED 日志

## Related

- `ensureEngineForRequest` 中的本地化逻辑 (lines 777-787)
- `detectConfigChange` 方法 (lines 912-1030)
