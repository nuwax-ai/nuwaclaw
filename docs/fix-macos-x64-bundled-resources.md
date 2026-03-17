# Fix macOS x64 Build - Bundled Resources Architecture Mismatch

## Context

macOS x64 构建产物中打包的 bundled resources（uv、node、lanproxy）是 ARM64 架构的，导致 Intel Mac 用户运行时报 "bad CPU type in executable"。

**根因**：CI 的 `macos-latest` runner 是 ARM64，所有 prepare 脚本使用 `process.arch`（返回 runner 原生架构 `arm64`），而非构建目标架构。加上 CI cache key 不区分 arch，导致 ARM64 缓存被 x64 构建复用。

## Changes

### 1. 三个 prepare 脚本支持 `TARGET_ARCH` 环境变量

**Files:**
- `crates/agent-electron-client/scripts/prepare/prepare-uv.js` (line 27-31)
- `crates/agent-electron-client/scripts/prepare/prepare-node.js` (line 33-37)
- `crates/agent-electron-client/scripts/prepare/prepare-lanproxy.js` (line 48-50)

每个 `getPlatformKey()` 函数改为优先读取 `TARGET_ARCH` 环境变量：

```javascript
function getPlatformKey() {
  const p = process.platform;
  const a = process.env.TARGET_ARCH || process.arch;
  return `${p}-${a}`;
}
```

### 2. 添加 `.platform-key` marker 文件检测架构不匹配

**Files:** 同上三个 prepare 脚本

在 main 函数中，检查已有的 `resources/<type>/bin/` 是否匹配当前 target arch。如果不匹配则清理并重新下载：

- `prepare-uv.js`: 在 `destBin` 旁写入 `.platform-key` 文件，内容为 platform key
- `prepare-node.js`: 在 `nodeRoot` 下写入 `.platform-key`
- `prepare-lanproxy.js`: 在 `destBinDir` 下写入 `.platform-key`

### 3. CI cache key 添加 `matrix.arch`

**Files:**
- `.github/workflows/release-electron.yml` (lines 153, 166)
- `.github/workflows/release-electron-dev.yml` (lines 154, 167)

修改 cache key：

```yaml
# uv cache
key: bundled-uv-${{ matrix.platform }}-${{ matrix.arch }}-${{ hashFiles('...') }}

# node cache
key: bundled-node-24-${{ matrix.platform }}-${{ matrix.arch }}-${{ hashFiles('...') }}
```

### 4. CI 设置 `TARGET_ARCH` 环境变量

**Files:** 同上两个 workflow 文件

在 `Prepare bundled resources` 步骤中设置 `TARGET_ARCH`：

```yaml
- name: Prepare bundled resources (uv, node, git)
  working-directory: crates/agent-electron-client
  env:
    TARGET_ARCH: ${{ matrix.arch }}
  run: npm run prepare:all
```

## Verification

1. 本地测试：`TARGET_ARCH=x64 npm run prepare:uv` — 确认下载 x86_64 版本
2. 本地测试：`TARGET_ARCH=arm64 npm run prepare:uv` — 确认下载 aarch64 版本
3. 检查 `.platform-key` 文件内容正确
4. 切换 TARGET_ARCH 后重新运行，确认旧文件被清理并重新下载
5. CI 构建验证：推送后检查 x64 和 arm64 jobs 的 cache key 不同
