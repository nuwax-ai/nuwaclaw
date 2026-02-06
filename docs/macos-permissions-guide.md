# macOS 权限配置指南

本文档介绍 nuwax-agent 在 macOS 上需要获取的系统权限，包括权限用途、申请方式、以及常见问题排查。

## 权限概览

| 权限 | 必需程度 | 用途 |
|------|---------|------|
| 辅助功能 | ✅ 必需 | 控制其他应用窗口、模拟键盘输入 |
| 屏幕录制 | ✅ 必需 | 远程桌面、屏幕共享 |
| 完全磁盘访问 | ✅ 必需 | 访问用户文件、日志读取 |
| 麦克风 | ⚠️ 可选 | 语音输入（如果使用） |
| 摄像头 | ⚠️ 可选 | 视频通话（如果使用） |
| 通知 | ⚠️ 可选 | 状态提醒、任务完成通知 |
| AppleScript | ⚠️ 可选 | 高级自动化操作 |

## 必需权限详细说明

### 1. 辅助功能权限 (Accessibility)

**用途**：
- 控制其他应用的窗口（显示/隐藏/调整大小）
- 模拟键盘输入（发送文本、按键）
- 读取其他应用的 UI 元素状态

**申请方式**：
1. 首次启动时会弹出系统授权对话框
2. 或手动前往：`系统设置` → `隐私与安全性` → `辅助功能`
3. 勾选 `nuwax-agent`

**如果未授权**：
- 无法控制其他应用窗口
- 无法进行键盘输入模拟
- 部分自动化功能不可用

**排查方法**：
```bash
# 检查权限状态
tccutil query Accessibility

# 重置权限（需要管理员权限）
sudo tccutil reset Accessibility
```

### 2. 屏幕录制权限 (Screen Recording)

**用途**：
- 捕获屏幕内容用于远程桌面显示
- 屏幕共享功能
- 实时屏幕监控

**申请方式**：
1. 首次启动检测到需要时会弹出对话框
2. 或手动前往：`系统设置` → `隐私与安全性` → `屏幕录制`
3. 勾选 `nuwax-agent`

**如果未授权**：
- 远程桌面功能无法显示屏幕
- 屏幕共享不可用
- 部分截图功能受限

**排查方法**：
```bash
# 检查权限状态
tccutil query ScreenRecording

# 重置权限
sudo tccutil reset ScreenRecording
```

### 3. 完全磁盘访问权限 (Full Disk Access)

**用途**：
- 读取用户目录下的任意文件
- 访问系统保护目录（如 `~/Library/`）
- 日志文件读取

**申请方式**：
1. 首次访问受保护目录时会提示
2. 或手动前往：`系统设置` → `隐私与安全性` → `完全磁盘访问权限`
3. 点击 `+` 添加 `nuwax-agent`

**如果未授权**：
- 无法读取某些配置文件
- 日志功能可能受限
- 文件操作可能失败

**排查方法**：
```bash
# 检查权限状态
tccutil query SystemPolicyAllFiles

# 重置权限
sudo tccutil reset SystemPolicyAllFiles
```

## 可选权限说明

### 麦克风权限 (Microphone)

**用途**：语音输入、语音控制功能

**申请方式**：
- `系统设置` → `隐私与安全性` → `麦克风`
- 勾选 `nuwax-agent`

### 摄像头权限 (Camera)

**用途**：视频通话、视频录制

**申请方式**：
- `系统设置` → `隐私与安全性` → `摄像头`
- 勾选 `nuwax-agent`

### 通知权限 (Notifications)

**用途**：显示桌面通知

**申请方式**：
- `系统设置` → `通知` → `nuwax-agent`
- 允许通知

## 权限申请流程

### 首次启动流程

```
1. 应用启动
   ↓
2. 检测必需权限状态
   ├─ 辅助功能
   ├─ 屏幕录制
   └─ 完全磁盘访问
   ↓
3. 对未授权的必需权限弹出系统对话框
   ↓
4. 用户授权
   ↓
5. 进入权限检查页面，显示所有权限状态
```

### 手动授权

如果自动申请失败，可以通过以下方式手动授权：

1. **打开系统偏好设置**：
   ```bash
   open "x-apple.systempreferences:com.apple.securityAccessibility"
   open "x-apple.systempreferences:com.apple.securityScreenCapture"
   open "x-apple.systempreferences:com.apple.securityFullDiskAccess"
   ```

2. **在设置中找到对应权限**：
   - `系统设置` → `隐私与安全性`
   - 找到对应权限类别
   - 勾选 `nuwax-agent`

## 常见问题

### Q1: 权限已经授予，但功能还是不可用？

**解决方法**：
1. 重启应用（某些权限需要应用重启才能生效）
2. 检查权限列表中是否确实已勾选
3. 尝试重置权限后重新申请

### Q2: 托盘菜单点击没反应？

**可能原因**：辅助功能权限未授予

**解决方法**：检查辅助功能权限是否已授予

### Q3: 屏幕显示黑屏/无法连接？

**可能原因**：
1. 屏幕录制权限未授予
2. 目标应用也有屏幕录制限制

**解决方法**：
1. 检查屏幕录制权限
2. 如果连接远程桌面，检查目标应用是否允许录制

### Q4: 文件无法访问？

**可能原因**：完全磁盘访问权限未授予

**解决方法**：
1. 检查完全磁盘访问权限
2. 尝试访问具体文件路径，查看错误信息

### Q5: TCC 权限被重置？

macOS 可能会在某些情况下重置权限（如系统更新后）：

**检查命令**：
```bash
# 查看完整权限数据库
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db "SELECT client, auth_value FROM access WHERE client LIKE '%nuwax%';"
```

**重置后**：重新打开应用会再次触发权限申请

## 权限与安全说明

### 隐私保护

- 权限仅用于实现应用功能
- 不会未经授权访问您的数据
- 所有权限申请都有明确的用途说明

### 权限范围

- 应用只请求必要的最小权限
- 可选权限不会影响核心功能
- 用户可以随时在系统设置中撤销权限

## 技术参考

### 相关系统框架

| 权限 | 涉及的 macOS 框架 |
|------|------------------|
| 辅助功能 | Accessibility Framework, AXAPI |
| 屏幕录制 | ScreenCaptureKit, CGDisplay |
| 麦克风 | AVFoundation, CoreAudio |
| 摄像头 | AVFoundation, IOKit |
| 完全磁盘访问 | System Integrity Protection |

### TCC 数据库位置

- 用户级：`~/Library/Application Support/com.apple.TCC/TCC.db`
- 系统级：`/Library/Application Support/com.apple/TCC/`

### 相关文档

- [Apple 开发者文档：Privacy](https://developer.apple.com/documentation/security)
- [TCC 架构分析](https://www.pythonfixing.com/2022/05/how-to-access-tcc-database-in-macos.html)
