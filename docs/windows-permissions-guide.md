# Windows 权限配置指南

本文档介绍 nuwax-agent 在 Windows 上需要获取的系统权限，包括权限用途、申请方式、以及常见问题排查。

## 权限概览

| 权限 | 必需程度 | 用途 |
|------|---------|------|
| 用户账户控制 (UAC) | ✅ 必需 | 管理员权限操作 |
| 防火墙/网络 | ⚠️ 必需 | 网络通信、端口监听 |
| 屏幕录制 | ⚠️ 必需 | 远程桌面显示 |
| 麦克风 | ⚠️ 可选 | 语音输入 |
| 摄像头 | ⚠️ 可选 | 视频通话 |

## 必需权限详细说明

### 1. 用户账户控制 (UAC)

**用途**：
- 以管理员身份运行某些操作
- 安装系统级组件
- 修改系统配置

**申请方式**：
1. 首次需要管理员权限时会弹出 UAC 对话框
2. 点击 `是` 授权

**UAC 级别建议**：

Windows 10/11 默认 UAC 级别通常足够，但如需调整：
1. `控制面板` → `用户账户` → `用户账户`
2. `更改用户账户控制设置`
3. 拖动滑块至推荐位置（第二格或第三格）

**如果 UAC 级别过低**：
- 安全风险增加
- 某些系统操作可能被意外阻止

**排查方法**：
```powershell
# 检查 UAC 状态
Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "EnableLUA"

# 以管理员身份运行 PowerShell
Start-Process powershell -Verb runAs
```

### 2. 防火墙/网络权限

**用途**：
- 允许应用通过防火墙
- 监听网络端口
- 建立网络连接

**申请方式**：
1. 首次启动网络功能时可能弹出防火墙提示
2. 选择 `允许访问`

**手动配置防火墙**：
```powershell
# 以管理员身份运行 PowerShell

# 添加防火墙规则（允许入站连接）
New-NetFirewallRule -DisplayName "nuwax-agent" -Direction Inbound -Program "C:\path\to\nuwax-agent.exe" -Action Allow

# 或使用高级防火墙
wf.msc
```

**如果被防火墙阻止**：
- 网络功能不可用
- 无法建立远程连接

**排查方法**：
```powershell
# 检查防火墙状态
Get-NetFirewallProfile | Select Name, Enabled

# 查看应用是否被阻止
Get-NetFirewallApplicationFilter | Where-Object {$_.Program -like "*nuwax*"}

# 测试端口连通性
Test-NetConnection -ComputerName localhost -Port 9086
```

### 3. 屏幕录制权限

**用途**：
- 捕获屏幕内容用于远程桌面显示
- 屏幕共享

**申请方式**：
Windows 没有像 macOS 那样单独的屏幕录制权限，但需要：

1. **启用图形捕获**：
   - Windows 10 1803+ 支持 `DXGI Desktop Duplication`
   - 通常自动启用，无需额外权限

2. **如果使用 Game Bar 捕获**：
   - `设置` → `游戏` → `游戏栏`
   - 启用 `使用游戏栏录制屏幕截图和广播`

**排查方法**：
```powershell
# 检查 DirectX 功能
dxdiag /t dxdiag.txt
# 查看 dxdiag.txt 中的显示信息

# 检查图形驱动
Get-CimInstance Win32_VideoController | Select Name, DriverVersion
```

## 可选权限

### 麦克风权限

**用途**：语音输入、语音控制

**申请方式**：
1. `设置` → `隐私` → `麦克风`
2. 开启 `麦克风访问`
3. 找到 `nuwax-agent` 并开启

### 摄像头权限

**用途**：视频通话、视频录制

**申请方式**：
1. `设置` → `隐私` → `摄像头`
2. 开启 `摄像头访问`
3. 找到 `nuwax-agent` 并开启

### 通知权限

**用途**：显示桌面通知

**申请方式**：
1. `设置` → `通知` → `nuwax-agent`
2. 开启通知

## 权限申请流程

### 首次启动流程

```
1. 应用启动
   ↓
2. 检测 UAC 需求
   ↓
3. 如需要管理员权限，弹出 UAC 对话框
   ↓
4. 用户授权（或拒绝）
   ↓
5. 尝试绑定网络端口
   ↓
6. 如被防火墙阻止，提示用户
```

### 手动配置

#### UAC 提示处理

如果应用需要管理员权限但 UAC 被拒绝：
1. 右键点击应用图标
2. 选择 `以管理员身份运行`

#### 防火墙手动配置

```powershell
# 方法 1：PowerShell（管理员）
New-NetFirewallRule -DisplayName "nuwax-agent HTTP" -Direction Inbound -LocalPort 9086 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "nuwax-agent File Server" -Direction Inbound -LocalPort 60000 -Protocol TCP -Action Allow

# 方法 2：命令提示符（管理员）
netsh advfirewall firewall add rule name="nuwax-agent HTTP" dir=in action=allow protocol=TCP localport=9086
netsh advfirewall firewall add rule name="nuwax-agent File Server" dir=in action=allow protocol=TCP localport=60000
```

## 常见问题

### Q1: UAC 对话框一直弹出？

**可能原因**：
- 应用配置问题
- 系统策略限制

**解决方法**：
- 检查应用是否需要持续的管理员权限
- 联系技术支持

### Q2: 网络连接失败？

**可能原因**：
- 端口被占用
- 防火墙阻止
- 代理配置问题

**排查步骤**：
```powershell
# 1. 检查端口是否被占用
netstat -ano | findstr :9086

# 2. 检查防火墙状态
Get-NetFirewallProfile | Format-Table Name, Enabled

# 3. 测试本地连接
Test-NetConnection -ComputerName localhost -Port 9086
```

### Q3: 远程桌面显示黑屏？

**可能原因**：
- 源机器屏幕录制限制
- 权限不足
- 图形驱动问题

**排查步骤**：
1. 在源机器检查是否有其他远程桌面软件占用
2. 更新图形驱动
3. 检查是否有系统级录制限制

### Q4: 麦克风/摄像头无法使用？

**排查步骤**：
```powershell
# 检查设备管理器中的设备状态
Get-PnpDevice -Class Camera | Select FriendlyName, Status
Get-PnpDevice -Class AudioEndpoint | Select FriendlyName, Status

# 检查隐私设置
Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone" | Select *
```

### Q5: 应用崩溃或无响应？

**可能原因**：
- 权限配置问题
- 内存不足
- 驱动冲突

**排查方法**：
1. 打开 `事件查看器` → `Windows 日志` → `应用程序`
2. 查找 nuwax-agent 相关错误
3. 以管理员身份运行，观察是否解决问题

## 与 macOS 权限对比

| 功能 | macOS | Windows |
|------|-------|---------|
| 控制其他应用 | 辅助功能权限 | UAC + Windows API |
| 屏幕录制 | TCC Screen Recording | DXGI Desktop Duplication |
| 麦克风 | TCC Microphone | 隐私设置 |
| 文件访问 | 完全磁盘访问 | 默认允许 |
| 网络通信 | 无需特殊权限 | 防火墙配置 |
| 管理员操作 | 需要用户同意 | UAC 对话框 |

## 性能优化建议

### 屏幕录制性能

- 使用硬件加速（如果支持）
- 减少录制区域大小
- 降低帧率（如果不是必需 60fps）

### 网络性能

- 使用有线网络代替无线（如果可能）
- 配置合适的端口范围
- 考虑使用 UDP 而不是 TCP（如果延迟敏感）

## 安全说明

### 权限最小化

- 只请求必需的权限
- 定期检查已授予的权限
- 撤销不再需要的权限

### 防火墙最佳实践

- 只允许必要的入站规则
- 定期审查防火墙规则
- 使用白名单而非黑名单

## 技术参考

### 相关 Windows API

| 权限 | 涉及的 Windows API |
|------|-------------------|
| UAC | `ShellExecute`, `OpenAsStream`, `CoInitializeEx` |
| 屏幕录制 | `DXGI Desktop Duplication`, `GDI+` |
| 麦克风 | `WASAPI`, `Core Audio APIs` |
| 摄像头 | `Media Foundation`, `DirectShow` |

### 注册表相关位置

```powershell
# UAC 级别
HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\EnableLUA

# 麦克风隐私设置
HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone

# 摄像头隐私设置
HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam
```

### 性能计数器

```powershell
# 监控网络连接
Get-Counter '\Network Interface(*)\Bytes Sent/sec'
Get-Counter '\Network Interface(*)\Bytes Received/sec'

# 监控 CPU 使用
Get-Counter '\Processor(_Total)\% Processor Time'
```

## 相关链接

- [Microsoft Docs: User Account Control](https://docs.microsoft.com/windows/security/identity-protection/user-account-control/)
- [Microsoft Docs: Windows Firewall](https://docs.microsoft.com/windows/security/threat-protection/windows-firewall/)
- [DXGI Desktop Duplication API](https://docs.microsoft.com/windows/win32/direct3ddxgi/desktop-dup-api)
