# nuwaxcode 二进制代码签名问题

**日期**: 2026-03-28
**影响**: macOS 平台

---

## 问题描述

在 macOS 上，当从本地构建复制 nuwaxcode 二进制到 `~/.nuwaclaw/node_modules/nuwaxcode-darwin-arm64/bin/` 时，运行时会收到 SIGKILL 信号。

### 症状

```log
[2026-03-28 10:29:08.097] [info]  [AcpClient stdin] 📤 {"jsonrpc":"2.0","id":0,"method":"initialize"...}
[2026-03-28 10:29:09.380] [info]  [AcpClient] Process exited { code: null, signal: 'SIGKILL' }
```

直接运行也失败：
```bash
~/.nuwaclaw/node_modules/nuwaxcode-darwin-arm64/bin/nuwaxcode --version
# Exit code 137 (SIGKILL)
```

---

## 根因分析

macOS 的代码签名验证机制会拒绝未正确签名的二进制文件。

### 验证过程

1. 源二进制有 adhoc 签名：
   ```
   codesign -dv ~/workspace/nuwaxcode/.../nuwaxcode
   Signature=adhoc
   ```

2. 复制后文件哈希一致（排除文件损坏）：
   ```
   shasum -a 256 source/nuwaxcode: 69605cb4...
   shasum -a 256 target/nuwaxcode: 69605cb4...  # 相同
   ```

3. 但运行时被系统终止

### 原因

macOS 对从网络下载或复制的二进制有额外的安全检查。即使文件有 adhoc 签名，某些情况下仍需要重新签名才能通过验证。

---

## 解决方案

### 临时修复（手动）

```bash
# 重新签名
codesign --force --sign - /path/to/nuwaxcode

# 验证
/path/to/nuwaxcode --version
```

### 长期方案

#### 方案 1：CI/CD 构建时签名

在 nuwaxcode 的构建流程中添加正式签名步骤：

```yaml
# .github/workflows/release.yml
- name: Sign binary (macOS)
  if: runner.os == 'macOS'
  run: |
    codesign --force --sign - ./dist/nuwaxcode-darwin-arm64/bin/nuwaxcode
```

#### 方案 2：Electron 端自动签名

在复制二进制后自动签名：

```typescript
// src/main/services/packages/dependencies.ts
import { execSync } from "child_process"

function copyNuwaxcodeBinary(source: string, target: string) {
  fs.copyFileSync(source, target)

  // macOS 需要重新签名
  if (process.platform === "darwin") {
    try {
      execSync(`codesign --force --sign - "${target}"`, { stdio: "pipe" })
      log.info("Binary re-signed successfully", { target })
    } catch (error) {
      log.warn("Failed to re-sign binary", { error })
    }
  }
}
```

#### 方案 3：使用 adhoc 签名 + 时间戳

```bash
codesign --force --sign - --timestamp none /path/to/nuwaxcode
```

---

## 最佳实践

1. **开发环境**：复制二进制后始终运行 `codesign --force --sign -`

2. **生产环境**：
   - 使用 Apple Developer 证书正式签名
   - 或在 CI/CD 中使用 adhoc 签名 + 公证

3. **调试技巧**：
   ```bash
   # 检查签名状态
   codesign -dv --verbose=4 /path/to/binary

   # 检查扩展属性
   xattr -l /path/to/binary

   # 清除扩展属性
   xattr -c /path/to/binary
   ```

---

## 相关链接

- nuwaxcode 性能优化文档：`/Users/apple/workspace/nuwaxcode/docs/PERF-PLUGIN-INIT-2026-03-28.md`
- Apple Code Signing Guide: https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/
