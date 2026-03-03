# macOS 26 Tahoe 兼容性修复

## 问题描述

在 macOS 26 Tahoe 上，Electron 应用启动时崩溃：

```
Exception Type: EXC_BREAKPOINT (SIGTRAP)
Thread 0 Crashed:: Dispatch queue: com.apple.main-thread
0 Electron Framework  cxxbridge1$box$rust_png$ResultOfReader$drop
1 Electron Framework  ElectronMain + 84
```

## 根本原因

**macOS 26 Tahoe 上存在 Electron 兼容性问题：**

- **崩溃位置**: `ElectronMain` 初始化阶段
- **相关组件**: Chromium 的 Rust 组件（Fontations 字体后端、rust_png）
- **触发时机**: 崩溃发生在 **任何应用代码执行之前**
- **影响范围**: Electron 38+ 版本（Chrome 140+）

## 解决方案

在 `src/main/main.ts` 文件开头添加：

```typescript
import { app } from 'electron';

// macOS 26 Tahoe 兼容性：禁用 Fontations 字体后端
// 参考: https://github.com/electron/electron/issues/49522
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'FontationsFontBackend');
}
```

## 版本历史

| 版本 | 修复内容 |
|------|----------|
| 0.4.4 | 降级到 Electron 37 (临时方案) |
| **0.4.5** | 升级到 Electron 39 + 添加 workaround |

## 验证方法

打包后的应用进程参数中应包含：

```
--disable-features=FontationsFontBackend
```

```bash
ps aux | grep -i "Nuwax Agent" | grep -v grep
```

## 参考资料

- [Electron Issue #49522](https://github.com/electron/electron/issues/49522)

---

*最后更新: 2026-02-25*
