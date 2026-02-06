# Linux 权限配置指南

本文档介绍 nuwax-agent 在 Linux 上需要获取的系统权限，包括权限用途、申请方式、以及常见问题排查。

## 权限概览

| 权限 | 必需程度 | 用途 | 依赖系统 |
|------|---------|------|----------|
| 桌面环境集成 | ✅ 必需 | 托盘图标、窗口管理 | GNOME/KDE/X11/Wayland |
| 屏幕录制 | ⚠️ 必需 | 远程桌面显示 | PipeWire/xdg-desktop-portal |
| 键盘/鼠标模拟 | ✅ 必需 | 控制其他应用 | X11/Wayland |
| 文件访问 | ⚠️ 可选 | 读取用户文件 | Polkit/D-Bus |
| 网络权限 | ✅ 必需 | 端口监听、连接 | iptables/nftables |

## 必需权限详细说明

### 1. 桌面环境集成

nuwax-agent 需要与桌面环境集成以提供：
- 系统托盘图标
- 窗口管理
- 通知
- 自动启动

**不同桌面环境的支持情况**：

| 桌面环境 | 托盘支持 | 自动启动 | 通知 |
|----------|---------|---------|------|
| GNOME | ⚠️ 需扩展 | ✅ | ✅ |
| KDE Plasma | ✅ | ✅ | ✅ |
| XFCE | ✅ | ✅ | ✅ |
| Cinnamon | ✅ | ✅ | ✅ |
| MATE | ✅ | ✅ | ✅ |

**GNOME 特殊要求**：

GNOME 默认不支持系统托盘，需要安装扩展：
```bash
# 安装 tray 扩展
# 方式 1：浏览器打开
open https://extensions.gnome.org/extension/3500/tray-icons/

# 方式 2：命令行安装
gnome-extensions install tray-icons@selfmade.de
gnome-extensions enable tray-icons@selfmade.de
```

**检查桌面环境**：
```bash
# 查看当前桌面环境
echo $XDG_CURRENT_DESKTOP
echo $GDMSESSION

# 查看 Wayland 或 X11
echo $WAYLAND_DISPLAY
echo $DISPLAY
```

### 2. 屏幕录制权限

**用途**：
- 捕获屏幕用于远程桌面显示
- 实时屏幕共享

**Wayland 权限申请**：

Wayland 使用 `xdg-desktop-portal` 管理屏幕录制权限：
```bash
# 检查 xdg-desktop-portal 是否运行
systemctl --user status xdg-desktop-portal

# 如果未运行
systemctl --user start xdg-desktop-portal

# 检查 portal 权限
flatpak permission-list screen_cast
```

**手动配置屏幕录制**：

编辑 `~/.config/xdg-desktop-portal/portals/` 下的配置文件，或使用：
```bash
# 使用 flatpak 时需要额外权限
flatpak run --share=network --filesystem=home your-app
```

**X11 权限申请**：

X11 使用 `xhost` 控制访问：
```bash
# 允许本地连接
xhost +local:

# 查看当前权限
xhost
```

**如果屏幕录制不工作**：
```bash
# 检查 PipeWire 状态
pw-cli info 0

# 检查桌面 portal
XDG_CURRENT_DESKTOP=gnome dbus-send --session --dest=org.freedesktop.portal.Desktop --type=method_call --print-reply /org/freedesktop/portal/desktop org.freedesktop.portal.Desktop.RequestScreencast
```

### 3. 键盘/鼠标模拟权限

**用途**：
- 模拟键盘输入（发送文本、快捷键）
- 模拟鼠标点击/移动
- 控制其他应用窗口

**Wayland 权限**：

Wayland 限制了全局输入模拟，需要通过 `xdg-desktop-portal` 或专用机制：
```bash
# 检查注入权限
flatpak permission-list keyboard

# 或使用 GNOME 的Accessibility API
```

**X11 权限**：

X11 需要设置 `DISPLAY` 环境变量并获取权限：
```bash
# 允许输入模拟（谨慎使用，有安全风险）
xhost +si:localuser:$USER

# 使用 sudo 运行（需要 root 权限）
sudo -E your-app
```

**安全警告**：
> ⚠️ 输入模拟权限具有安全风险，仅授予信任的应用

**排查方法**：
```bash
# 检查 X11 权限
xinput list

# 测试键盘模拟
xdotool key "Hello World"

# 查看当前用户
whoami
```

### 4. 文件访问权限

**用途**：
- 读取用户配置文件
- 访问用户目录
- 读写应用数据

**Polkit 权限**：

现代 Linux 使用 Polkit 管理特权操作：
```bash
# 检查 polkit 服务
systemctl status polkit

# 查看当前用户的权限
pkexec --user $USER id
```

**Flatpak 权限**（如果以 Flatpak 方式运行）：
```bash
# 查看应用权限
flatpak info your-app

# 运行时权限
flatpak permission-list your-app

# 授予文件系统访问权限
flatpak override your-app --filesystem=home
```

**常见文件路径**：
```
配置文件: ~/.config/nuwax-agent/
日志文件: ~/.local/share/nuwax-agent/logs/
缓存文件: ~/.cache/nuwax-agent/
```

### 5. 网络权限

**用途**：
- 绑定端口监听
- 建立网络连接
- 防火墙穿透

**检查端口占用**：
```bash
# 查看 nuwax-agent 占用的端口
ss -tlnp | grep nuwax
lsof -i :9086

# 查看所有 nuwax 相关进程
ps aux | grep nuwax
```

**防火墙配置**：

#### iptables
```bash
# 允许端口
sudo iptables -A INPUT -p tcp --dport 9086 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 60000 -j ACCEPT

# 保存规则
sudo iptables-save > /etc/iptables/rules.v4
```

#### firewalld
```bash
# 添加端口
sudo firewall-cmd --permanent --add-port=9086/tcp
sudo firewall-cmd --permanent --add-port=60000/tcp
sudo firewall-cmd --reload

# 查看规则
sudo firewall-cmd --list-all
```

#### ufw
```bash
# 添加端口
sudo ufw allow 9086/tcp
sudo ufw allow 60000/tcp
sudo ufw reload

# 查看状态
sudo ufw status
```

## 可选权限

### 麦克风权限

**用途**：语音输入、语音控制

**申请方式**：
- 大多数桌面环境默认允许麦克风访问
- 如果遇到问题，检查 PipeWire/PulseAudio 配置

**排查方法**：
```bash
# 检查音频设备
pw-cli info all | grep Audio

# 测试录音
arecord -d 5 test.wav
```

### 摄像头权限

**用途**：视频通话、视频录制

**排查方法**：
```bash
# 检查摄像头设备
ls /dev/video*

# 测试摄像头
ffplay -f v4l2 -i /dev/video0
```

## 权限申请流程

### 首次启动

```
1. 应用启动
   ↓
2. 检测桌面环境
   ↓
3. 检查所需权限状态
   ├─ Wayland 端口
   ├─ 网络端口
   └─ 文件访问
   ↓
4. 如果权限不足，提示用户手动配置
```

### 手动配置

#### Wayland 权限提示

```bash
# 检查 Wayland portal
XDG_CURRENT_DESKTOP=gnome dbus-send --session \
  --dest=org.freedesktop.portal.Desktop \
  --type=method_call \
  /org/freedesktop/portal/desktop \
  org.freedesktop.portal.Desktop.OpenDirectory
```

#### 自动启动配置

```bash
# 方式 1：桌面环境自动启动目录
cp nuwax-agent.desktop ~/.config/autostart/

# 方式 2：systemd user service
cp nuwax-agent.service ~/.config/systemd/user/
systemctl --user enable nuwax-agent
systemctl --user start nuwax-agent
```

## 常见问题

### Q1: 系统托盘图标不显示？

**可能原因**：
- GNOME 缺少托盘扩展
- 桌面环境不支持托盘
- 应用未正确注册

**排查步骤**：
```bash
# 1. 检查桌面环境
echo $XDG_CURRENT_DESKTOP

# 2. 检查托盘扩展（GNOME）
gnome-extensions list

# 3. 检查应用窗口
wmctrl -l
```

**解决方法**：
- GNOME：安装 `Tray Icons` 扩展
- KDE：确保系统托盘启用
- XFCE：检查通知区域插件

### Q2: 远程桌面黑屏？

**可能原因**：
- Wayland 端口未授权
- 图形驱动不支持
- 权限不足

**排查步骤**：
```bash
# 1. 检查 portal 权限
flatpak permission-list screen_cast

# 2. 检查图形驱动
glxinfo | grep "OpenGL renderer"

# 3. 检查 PipeWire
pw-cli info 0
```

### Q3: 键盘模拟不工作？

**可能原因**：
- Wayland 限制输入注入
- X11 未授权
- 需要 root 权限

**排查步骤**：
```bash
# 1. 检查 X11 权限
xhost | grep "si:localuser"

# 2. 检查 wayland 权限
cat /proc/$(pgrep nuwax-agent)/status | grep Cap

# 3. 测试 xdotool
xdotool key "a"
```

### Q4: 端口被占用？

**排查步骤**：
```bash
# 1. 查看占用端口的进程
sudo lsof -i :9086

# 2. 查看所有 nuwax 相关进程
ps aux | grep nuwax

# 3. 终止冲突进程
sudo kill -9 <PID>
```

### Q5: 文件无法访问？

**排查步骤**：
```bash
# 1. 检查文件权限
ls -la ~/.config/nuwax-agent/

# 2. 检查磁盘空间
df -h

# 3. 检查 SELinux/AppArmor
# SELinux
sestatus
getenforce

# AppArmor
aa-status
```

## 与 macOS/Windows 权限对比

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 窗口控制 | 辅助功能权限 | UAC | X11/Wayland API |
| 屏幕录制 | TCC Screen Recording | DXGI | PipeWire |
| 键盘模拟 | 辅助功能权限 | UAC | X11/Wayland |
| 文件访问 | 完全磁盘访问 | 默认 | Polkit |
| 托盘图标 | Menu Bar | 系统托盘 | DE 支持 |
| 自动启动 | Login Items | 注册表 | systemd/XDG |

## 性能优化建议

### 屏幕录制性能

```bash
# 减少录制帧率（降低带宽）
# 在应用设置中调整

# 使用硬件编码（如果支持）
vainfo  # 检查 VA-API 支持
```

### 网络性能

```bash
# 检查网络延迟
ping your-server

# 优化 TCP 设置
# 编辑 /etc/sysctl.conf
net.core.rmem_max=16777216
net.core.wmem_max=16777216
```

## 安全说明

### 权限最小化原则

- 只授予必要的权限
- 定期审查已授予的权限
- 撤销不再使用的权限

### 特殊权限警告

> ⚠️ **键盘/鼠标模拟权限** 具有安全风险
> - 只授予信任的应用
> - 使用后及时撤销
> - 避免在公共场所使用

### Flatpak 沙箱

如果以 Flatpak 方式运行：
```bash
# 查看当前权限
flatpak info your-app

# 收紧权限（谨慎）
flatpak override your-app --no-talk-name=org.freedesktop.portal.*

# 授予必要权限
flatpak override your-app --filesystem=home --socket=x11 --socket=wayland
```

## 技术参考

### 相关系统组件

| 权限 | 涉及的 Linux 组件 |
|------|------------------|
| 桌面集成 | GDK, Qt, GTK |
| 屏幕录制 | PipeWire, xdg-desktop-portal, FFmpeg |
| 输入模拟 | XTest, uinput, evdev |
| 文件访问 | Polkit, D-Bus, PAM |
| 网络 | iptables, nftables, firewalld |

### 关键配置文件

```bash
# 桌面 portal 配置
~/.config/xdg-desktop-portal/portals/gnome.portal
~/.config/xdg-desktop-portal/portals/kde.portal

# 自动启动
~/.config/autostart/nuwax-agent.desktop

# systemd user
~/.config/systemd/user/nuwax-agent.service

# 应用配置
~/.config/nuwax-agent/config.yaml
```

### 有用命令速查

```bash
# 桌面环境信息
echo $XDG_CURRENT_DESKTOP
echo $GDMSESSION

# Wayland/X11 检查
echo $WAYLAND_DISPLAY
echo $DISPLAY

# Portal 服务状态
systemctl --user status xdg-desktop-portal

# 音频设备
pw-cli info all | grep Audio

# 图形驱动
glxinfo | grep "OpenGL renderer"
vainfo
```

## 相关链接

- [freedesktop Portal 文档](https://flatpak.github.io/xdg-desktop-portal/docs/)
- [PipeWire 文档](https://pipewire.org/documentation/)
- [Polkit 文档](https://www.freedesktop.org/software/polkit/docs/)
- [GNOME 扩展](https://extensions.gnome.org/)
