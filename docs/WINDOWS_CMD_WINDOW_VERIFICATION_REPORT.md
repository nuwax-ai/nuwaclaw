# nuwax-agent_diff Windows CMD 窗口问题验证报告

## 测试环境
- **版本**: nuwax-agent_diff (tag: win-v0.1.2, v0.1.26)
- **mcp-proxy 版本**: 0.1.37 → 0.1.39
- **测试日志**: `/Users/apple/Downloads/nuwax-agent.log.2026-02-12`

## 测试结果 ❌

### 问题 1: CMD 窗口仍然弹出
**预期**: 所有服务启动时不弹出 CMD 窗口  
**实际**: CMD 窗口仍然弹出  
**状态**: ❌ **未解决**

### 问题 2: mcp-proxy 启动失败
**预期**: mcp-proxy 正常启动并通过健康检查  
**实际**: 健康检查超时（15秒后仍未就绪）  
**状态**: ❌ **未解决**

### 问题 3: Node.js 重复安装
**预期**: 检测到已安装的 Node.js，直接使用  
**实际**: 重复尝试安装 10 次后才使用自动安装  
**状态**: ❌ **未解决**

---

## 代码验证

### nuwax-agent_diff 中的实现 ✅ 代码正确

**文件**: `crates/nuwax-agent-core/src/service/mod.rs`

```rust
// Windows 下正确使用了 CreationFlags + JobObject
#[cfg(target_os = "windows")]
let child = cmd
    .wrap(process_wrap::tokio::KillOnDrop)
    .wrap(CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS))  // ✅ 正确
    .wrap(JobObject)                                            // ✅ 正确
    .spawn()?;
```

**应用位置**:
1. ✅ `run_command_with_timeout()` - 通用命令执行
2. ✅ `file_server_start()` - 文件服务器启动
3. ✅ `lanproxy_start()` - LAN 代理启动
4. ✅ `mcp_proxy_start()` - MCP 代理启动

**Cargo.toml 特性**:
```toml
process-wrap = { version = "9", features = ["tokio1", "process-group", "job-object"] }
```
✅ 已正确添加 `job-object` 特性

---

## 为什么代码正确但仍然弹出窗口？

### 可能原因 1: `.cmd` 批处理文件本身的问题 ⭐ 最可能

**分析**:

Windows 上的 npm 全局包会生成 `.cmd` 包装文件：
```
C:\Users\MECHREVO\.local\bin\
├── mcp-proxy.cmd        ← 批处理文件
├── nuwax-file-server.cmd
└── ...
```

**问题**: 即使父进程设置了 `CREATE_NO_WINDOW`，`.cmd` 文件启动时仍然会：
1. 启动 `cmd.exe` 解释器
2. `cmd.exe` 可能会**忽略**父进程的窗口标志
3. `.cmd` 内部再启动 Node.js 进程

**层级关系**:
```
nuwax-agent.exe (设置 CREATE_NO_WINDOW)
  └─ cmd.exe (解释 .cmd 文件) ← 可能弹窗！
      └─ node.exe (实际的服务)
```

**验证方法**:

1. 直接运行 `.cmd` 文件看是否弹窗：
```powershell
# 测试 1: 直接运行
C:\Users\MECHREVO\.local\bin\mcp-proxy.cmd

# 测试 2: 通过 Rust 程序运行（设置 CREATE_NO_WINDOW）
# 如果仍然弹窗，说明问题在 .cmd 文件本身
```

2. 查看 `.cmd` 文件内容：
```powershell
type C:\Users\MECHREVO\.local\bin\mcp-proxy.cmd
```

---

### 可能原因 2: process-wrap 的 JobObject 实现问题

**分析**:

`process-wrap` 的 `JobObject` 可能没有正确传递 `CREATE_NO_WINDOW` 标志给子进程。

**验证代码**:
```rust
// 当前实现
.wrap(CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS))
.wrap(JobObject)

// 可能的问题：JobObject 重新创建了进程，覆盖了 CreationFlags？
```

**解决方案**: 检查 process-wrap 的源码，确认 JobObject 是否保留了 CreationFlags。

---

### 可能原因 3: Windows 版本或系统设置

某些 Windows 版本或系统设置可能忽略 `CREATE_NO_WINDOW` 标志。

**验证**:
```powershell
# 检查 Windows 版本
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"

# 检查是否有组策略限制
gpedit.msc
```

---

## 解决方案建议

### 方案 A: 绕过 `.cmd` 文件，直接调用 Node.js ⭐ 推荐

**原理**: 不使用 `.cmd` 包装文件，直接调用 node.exe

**实现**:

```rust
// 修改前
let bin_path = "C:\\Users\\...\\mcp-proxy.cmd";
let mut cmd = CommandWrap::with_new(&bin_path, |cmd| {
    // ...
});

// 修改后
let node_exe = "C:\\Users\\...\\node.exe";
let mcp_proxy_js = "C:\\Users\\...\\node_modules\\mcp-stdio-proxy\\dist\\index.js";

let mut cmd = CommandWrap::with_new(node_exe, |cmd| {
    cmd.arg(mcp_proxy_js)  // 直接调用 JS 文件
       .env("PATH", ...)
       // ...
});

#[cfg(windows)]
let child = cmd
    .wrap(CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS))
    .wrap(JobObject)
    .spawn()?;
```

**优点**:
- ✅ 完全绕过 `.cmd` 文件
- ✅ 更可控的进程启动
- ✅ 更清晰的参数传递

**缺点**:
- ⚠️ 需要找到 `.cmd` 对应的 `.js` 文件路径
- ⚠️ 需要处理 npm 包的路径解析

---

### 方案 B: 使用 `conhost.exe` 隐藏控制台

**原理**: 使用 Windows 的 `conhost.exe` 工具隐藏控制台窗口

**实现**:

```rust
#[cfg(windows)]
fn run_hidden(cmd_path: &str, args: &[&str]) -> Result<Child> {
    use std::process::{Command, Stdio};
    use std::os::windows::process::CommandExt;
    
    // 方法 1: 使用 CREATE_NO_WINDOW + STARTUPINFOEXW
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const DETACHED_PROCESS: u32 = 0x00000008;
    
    let mut cmd = Command::new(cmd_path);
    cmd.args(args);
    cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    
    // 方法 2: 使用 wscript 启动（更隐蔽）
    // let mut cmd = Command::new("wscript.exe");
    // cmd.arg("//B")  // Batch mode (no UI)
    //    .arg("//NoLogo")
    //    .arg(vbs_script_path);  // 需要生成 VBS 脚本
    
    cmd.spawn()
}
```

---

### 方案 C: 打包成 Windows 服务或使用隐藏启动器

**原理**: 将服务打包成 Windows 服务或使用专门的隐藏启动器

**实现**:

1. **Windows 服务**:
```rust
// 使用 windows-service crate
// 将 nuwax-agent 注册为 Windows 服务
```

2. **隐藏启动器**:
```rust
// 创建一个小的 C++ 启动器
// 使用 ShellExecuteEx + SW_HIDE
```

---

## 调试步骤

### 1. 验证 `.cmd` 文件是否是根本原因

```powershell
# 查看 mcp-proxy.cmd 内容
type C:\Users\MECHREVO\.local\bin\mcp-proxy.cmd

# 尝试直接运行 node.exe（而不是 .cmd）
C:\Users\MECHREVO\.local\bin\node.exe C:\Users\MECHREVO\.local\bin\node_modules\mcp-stdio-proxy\dist\index.js --help
```

### 2. 使用 Process Explorer 查看进程树

下载 Process Explorer: https://learn.microsoft.com/en-us/sysinternals/downloads/process-explorer

启动 nuwax-agent 后，查看进程树：
```
nuwax-agent.exe
  └─ cmd.exe  ← 如果看到这个，说明 .cmd 文件启动了 cmd.exe
      └─ conhost.exe  ← 控制台宿主
          └─ node.exe
```

### 3. 添加详细日志

修改 `service/mod.rs`，添加日志：

```rust
#[cfg(windows)]
{
    tracing::info!("Windows: 设置 CREATE_NO_WINDOW | DETACHED_PROCESS");
    tracing::info!("命令路径: {}", bin_path);
    tracing::info!("是否是 .cmd 文件: {}", bin_path.ends_with(".cmd"));
}
```

---

## 测试 mcp-proxy v0.1.39 的改进

根据 mcp-proxy 的更新日志，v0.1.39 添加了：

1. ✅ 环境变量日志配置支持
2. ✅ 增强的启动日志
3. ✅ stderr 输出关键信息

**验证**:

```powershell
# 设置日志目录
$env:MCP_PROXY_LOG_DIR = "C:\Users\MECHREVO\AppData\Roaming\nuwax-agent\logs\mcp-proxy"
$env:MCP_PROXY_LOG_LEVEL = "debug"
$env:MCP_PROXY_PORT = "18099"

# 手动启动 mcp-proxy
C:\Users\MECHREVO\.local\bin\mcp-proxy.cmd

# 查看日志
type C:\Users\MECHREVO\AppData\Roaming\nuwax-agent\logs\mcp-proxy\log.2026-02-12
```

---

## Node.js 检测问题修复

日志显示的问题：
```
[resolve_node_bin] npm -> fallback to PATH  # 10 次失败
[NodeInstall] 开始自动安装 Node.js...      # 最终触发安装
```

**根本原因**: `resolve_node_bin` 没有真正验证 npm 命令是否可用

**修复方案** (已在 mcp-proxy 仓库的分析文档中提供):

```rust
async fn is_nodejs_available() -> bool {
    tokio::process::Command::new("node")
        .arg("--version")
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn ensure_npm_package(package_name: &str) -> Result<()> {
    // 1. 先检查 Node.js 是否可用
    if !is_nodejs_available().await {
        install_nodejs().await?;
    }
    
    // 2. 检查包是否已安装
    if is_npm_package_installed(package_name).await? {
        return Ok(());
    }
    
    // 3. 安装包（带重试限制）
    // ...
}
```

---

## 总结

### ✅ nuwax-agent_diff 代码是正确的

代码层面的修改是正确的：
- ✅ 使用了 `CreationFlags(CREATE_NO_WINDOW | DETACHED_PROCESS)`
- ✅ 使用了 `JobObject` 管理进程
- ✅ 添加了 `process-group` 和 `job-object` 特性

### ❌ 但仍然弹出 CMD 窗口

**最可能的原因**: `.cmd` 批处理文件本身启动了 `cmd.exe`，导致窗口弹出

**推荐的解决方案**:
1. ⭐ **方案 A**: 绕过 `.cmd` 文件，直接调用 `node.exe`
2. 🔧 **方案 B**: 验证 process-wrap 的 JobObject 实现
3. 📊 **调试**: 使用 Process Explorer 查看进程树

### 📋 下一步行动

1. **立即**: 查看 `.cmd` 文件内容，确认是否是根本原因
2. **验证**: 尝试直接调用 `node.exe` 而不是 `.cmd`
3. **测试**: 使用 Process Explorer 查看进程树
4. **应用**: 如果方案 A 有效，修改 nuwax-agent 代码

### 📝 相关文档

- mcp-proxy LOG_CONFIGURATION.md - 日志配置指南
- NUWAX_AGENT_WINDOWS_CMD_FIX.md - CMD 窗口修复方案
- MCP_PROXY_STARTUP_FAILURE_ANALYSIS.md - 启动失败分析
