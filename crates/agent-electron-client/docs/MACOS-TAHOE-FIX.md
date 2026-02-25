# macOS 26 Tahoe 兼容性修复

## 问题描述

在 macOS 26 Tahoe 上，Electron 应用启动时崩溃，错误信息：

```
Exception Type: EXC_BREAKPOINT (SIGTRAP)
Thread 0 Crashed:: Dispatch queue: com.apple.main-thread
0 Electron Framework  cxxbridge1$box$rust_png$ResultOfReader$drop
1 Electron Framework  v8::internal::compiler::CompilationDependencies::DependOnContextCell
2 Electron Framework  ElectronMain + 84
```

## 根本原因

**这不是 Chrome 版本问题，而是 macOS 26 Tahoe 与 Electron 框架的兼容性问题。**

1. **崩溃位置**: `ElectronMain` 函数中的 V8 引擎初始化阶段
2. **相关组件**: Rust PNG 库 (`rust_png`) 的 FFI 桥接代码
3. **触发时机**: 崩溃发生在**任何应用代码执行之前**
4. **影响范围**: Electron 38+ 某些版本在 macOS 26 Tahoe 上存在此问题

### 技术细节

- macOS 26 Tahoe 对某些系统 API 进行了修改
- Electron 使用的 Rust 组件（`rust_png`、`fontations`）在新系统上触发了断言失败
- 崩溃栈显示: `cxxbridge1$box$rust_png$ResultOfReader$drop`

## 解决方案

### 方案一：代码层面 Workaround（推荐）

在 `src/main/main.ts` 文件开头添加：

```typescript
import { app } from 'electron';

// macOS 26 Tahoe 兼容性：禁用 Fontations 字体后端
// 参考: https://github.com/electron/electron/issues/49522
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'FontationsFontBackend');
}
```

### 方案二：升级 Electron 版本

使用已包含修复的 Electron 版本：

| Electron 版本 | Chrome 版本 | 修复状态 |
|--------------|-------------|----------|
| 37.6.0+ | 138 | ✅ 兼容 |
| 38.2.0+ | 140 | ✅ 有修复但需 workaround |
| **39.0.0+** | **142** | ✅ 推荐 + workaround |
| 40.0.0+ | 144 | ✅ 最新 |

### 方案三：升级 macOS

Apple 在 **macOS 26.2+** 已从系统层面修复了部分兼容性问题。

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

可通过以下命令验证：

```bash
ps aux | grep -i "Nuwax Agent" | grep -v grep
```

## 参考资料

- [Electron Issue #49522](https://github.com/electron/electron/issues/49522) - 官方问题追踪
- [Electron PR #48376](https://github.com/electron/electron/pull/48376) - macOS 26 相关修复
- [Electron Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) - 版本时间线

## 注意事项

1. **Workaround 位置**: 必须在 `app.whenReady()` 之前添加命令行开关
2. **仅 macOS**: 此 workaround 仅对 macOS 生效，不影响其他平台
3. **后续升级**: 当 Electron 完全修复此问题后，可移除 workaround 代码
4. **测试覆盖**: 每次 Electron 版本升级后需在 macOS 26 Tahoe 上进行回归测试

---

*最后更新: 2026-02-25*
*修复版本: v0.4.5*
