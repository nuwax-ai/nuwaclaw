# Windows CMD 窗口问题根本原因分析

## 问题现象
即使代码中有 `CREATE_NO_WINDOW` 标志，Windows 上启动所有服务时仍然弹出 CMD 窗口：
- mcp-proxy.cmd
- nuwax-file-server.cmd
- nuwax-lanproxy.exe

## 根本原因

### ❌ 当前实现的问题

```rust
// 在闭包中调用 .no_window()
let mut cmd = CommandWrap::with_new(bin_path, |cmd| {
    cmd.no_window()  // ← 这里设置 CREATE_NO_WINDOW
       .arg("...")
       .env("...", "...");
});

// 闭包外再设置 CreationFlags
#[cfg(windows)]
let child = cmd
    .wrap(CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS))  // ← 这里又设置一次
    .wrap(JobObject)
    .spawn()?;
```

### 问题分析

**CommandWrap::with_new 的工作原理**:

```rust
// process-wrap 库的实现（简化）
impl CommandWrap {
    pub fn with_new<F>(program: &str, f: F) -> Self 
    where F: FnOnce(&mut Command)
    {
        let mut cmd = Command::new(program);
        f(&mut cmd);  // 闭包修改 Command
        
        Self {
            cmd,  // ← Command 存储在这里
            // ...
        }
    }
}
```

**问题**：
1. 闭包里 `cmd.no_window()` 设置了 `creation_flags(CREATE_NO_WINDOW)`
2. **但这个设置在 `cmd` 被包装进 `CommandWrap` 后无法继承**
3. 后续的 `.wrap(CreationFlags(...))` 设置的是 **process-wrap 自己的标志**
4. **两者不会合并！** process-wrap 会用自己的 `CreationFlags` 覆盖原始的

### 验证

查看 process-wrap 源码（推测）：

```rust
// process-wrap 的 CreationFlags wrapper
impl CreationFlags {
    pub fn apply(&self, cmd: &mut Command) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(self.0);  // ← 直接覆盖，不合并！
        }
    }
}
```

**所以实际发生的是**：
1. 闭包内：`cmd.creation_flags(CREATE_NO_WINDOW)` ✅
2. 闭包外：`cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)` ← 覆盖了！
3. **但如果 process-wrap 内部创建了新的 Command，第 1 步的设置会丢失！**

## 解决方案

### 方案 A：只在 process-wrap 层面设置（推荐）

**删除闭包内的 `.no_window()`，只依赖 `.wrap(CreationFlags(...))`**

```rust
let mut cmd = CommandWrap::with_new(bin_path, |cmd| {
    // ❌ 删除这行：cmd.no_window()
    cmd.arg("...")
       .env("...", "...");
});

#[cfg(windows)]
let child = cmd
    .wrap(CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS))  // ✅ 只在这里设置
    .wrap(JobObject)
    .spawn()?;
```

### 方案 B：确保标志合并

**在闭包外先读取现有标志，然后合并**

```rust
let mut cmd = CommandWrap::with_new(bin_path, |cmd| {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.arg("...")
       .env("...", "...");
});

// Windows: 不需要再 wrap CreationFlags，因为已经在闭包里设置了
#[cfg(windows)]
let child = cmd
    .wrap(JobObject)  // ❌ 删除 CreationFlags wrap
    .wrap(KillOnDrop)
    .spawn()?;
```

### 方案 C：完全不用 process-wrap 的 CreationFlags

**直接在 Command 上设置，不依赖 process-wrap**

```rust
use std::process::Stdio;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

let mut cmd = tokio::process::Command::new(bin_path);
cmd.args(&["start", "--port", "8080"])
   .env("PATH", &node_path)
   .stdout(Stdio::piped())
   .stderr(Stdio::piped());

#[cfg(windows)]
{
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const DETACHED_PROCESS: u32 = 0x00000008;
    cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
}

let mut child = cmd.spawn()?;

// 手动管理进程树（如果需要）
#[cfg(windows)]
{
    // 可以使用 windows-rs 创建 Job Object
}
```

## 推荐修复

**方案 A** 最简单，只需删除闭包内的 `.no_window()` 调用。

但我怀疑问题可能更深层：**process-wrap 的 CreationFlags 可能根本没生效！**

让我检查 process-wrap 的版本和实现...
