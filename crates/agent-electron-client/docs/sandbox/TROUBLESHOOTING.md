# 沙箱故障排查指南

> **版本**: 1.0.0  
> **更新**: 2026-03-22

---

## 1. Docker 相关问题

### 1.1 Docker 不可用

**症状：** `SandboxError: SANDBOX_UNAVAILABLE`

**排查步骤：**

```bash
# 1. 检查 Docker 是否安装
docker --version

# 2. 检查 Docker 服务状态
# macOS
docker status
# Linux
sudo systemctl status docker

# 3. 检查 Docker 权限
docker ps
```

**解决方案：**

| 平台 | 命令 |
|------|------|
| macOS | 安装 Docker Desktop 并启动 |
| Linux | `sudo systemctl start docker` |
| Windows | 安装 Docker Desktop 并启用 WSL2 |

---

### 1.2 容器启动失败

**症状：** `SandboxError: WORKSPACE_EXISTS` 或容器无法创建

**排查步骤：**

```bash
# 1. 检查容器列表
docker ps -a

# 2. 检查 Docker 日志
docker logs <container-id>

# 3. 检查磁盘空间
docker system df
```

**解决方案：**

```bash
# 清理未使用的容器和镜像
docker system prune -a

# 增加 Docker 磁盘配额（Docker Desktop -> Settings -> Disk）
```

---

### 1.3 容器内命令执行失败

**症状：** `SandboxError: EXECUTION_FAILED`

**排查步骤：**

```bash
# 1. 检查容器是否运行
docker ps | grep <container-id>

# 2. 进入容器调试
docker exec -it <container-id> /bin/sh

# 3. 检查容器资源
docker stats <container-id>
```

---

## 2. Windows WSL 相关问题

### 2.1 WSL 未安装

**症状：** `SandboxError: SANDBOX_UNAVAILABLE` (Windows)

**排查步骤：**

```powershell
# 检查 WSL 状态
wsl --status

# 列出已安装的发行版
wsl --list --verbose
```

**解决方案：**

```powershell
# 安装 WSL
wsl --install -d Ubuntu-22.04

# 重启后检查
wsl --set-default Ubuntu-22.04
```

---

### 2.2 WSL 发行版启动失败

**症状：** `SandboxError: WORKSPACE_EXISTS`

**排查步骤：**

```powershell
# 关闭所有 WSL 实例
wsl --shutdown

# 检查发行版状态
wsl --list --verbose
```

---

## 3. Linux Firejail 相关问题

### 3.1 Firejail 未安装

**症状：** `SandboxError: SANDBOX_UNAVAILABLE` (Linux)

**排查步骤：**

```bash
# 检查 Firejail
firejail --version

# 安装 Firejail
# Ubuntu/Debian
sudo apt install firejail

# Fedora
sudo dnf install firejail
```

---

### 3.2 Firejail 配置文件错误

**症状：** `SandboxError: EXECUTION_FAILED`

**排查步骤：**

```bash
# 检查 profile 语法
firejail --debug-profile=/path/to/profile 2>&1

# 测试 profile
firejail --profile=/path/to/profile /bin/ls
```

---

## 4. 权限相关问题

### 4.1 权限被拒绝

**症状：** `SandboxError: PERMISSION_DENIED`

**排查步骤：**

```bash
# 检查工作区目录权限
ls -la ~/.nuwaclaw/workspaces/

# 检查用户组
groups $USER
```

**解决方案：**

```bash
# 修复目录权限
chmod -R 755 ~/.nuwaclaw/workspaces/

# 将用户加入 docker 组
sudo usermod -aG docker $USER
```

---

### 4.2 权限请求无响应

**症状：** 命令挂起等待权限确认

**排查步骤：**

```bash
# 检查待处理的权限请求
# 在渲染进程中查看 PendingPermissions 状态
```

**解决方案：**

- 检查用户是否看到了权限确认弹窗
- 增加权限请求超时时间
- 设置自动批准常见操作

---

## 5. 工作区问题

### 5.1 工作区创建失败

**症状：** `SandboxError: WORKSPACE_EXISTS`

**排查步骤：**

```bash
# 检查工作区目录
ls -la ~/.nuwaclaw/workspaces/

# 检查是否有残留进程
ps aux | grep nuwaclaw
```

**解决方案：**

```bash
# 删除残留目录
rm -rf ~/.nuwaclaw/workspaces/<session-id>

# 重启应用
```

---

### 5.2 工作区磁盘空间不足

**症状：** `SandboxError: EXECUTION_FAILED` (disk full)

**排查步骤：**

```bash
# 检查磁盘空间
df -h ~/.nuwaclaw/

# 检查工作区大小
du -sh ~/.nuwaclaw/workspaces/*
```

**解决方案：**

```bash
# 清理临时文件
rm -rf ~/.nuwaclaw/workspaces/*/tmp/*

# 增加磁盘限额配置
# 在 sandbox.json 中设置 maxDiskUsage
```

---

### 5.3 工作区清理失败

**症状：** 退出应用后工作区仍然存在

**排查步骤：**

```bash
# 检查保留策略配置
cat ~/.nuwaclaw/workspaces/<session-id>/sandbox.json

# 检查是否有进程占用
lsof +D ~/.nuwaclaw/workspaces/<session-id>
```

---

## 6. 性能问题

### 6.1 沙箱启动慢

**症状：** 首次创建沙箱需要很长时间

**原因：** Docker 镜像下载、WSL 初始化等

**解决方案：**

```bash
# 预热：提前拉取镜像
docker pull node:20-slim

# WSL 预初始化
wsl -d Ubuntu-22.04
```

---

### 6.2 命令执行超时

**症状：** `SandboxError: EXECUTION_TIMEOUT`

**排查步骤：**

```bash
# 检查命令复杂度
# 增加超时时间
```

**解决方案：**

```typescript
// 增加默认超时
const executeOptions: ExecuteOptions = {
  timeout: 600000, // 10 分钟
};
```

---

## 7. 网络问题

### 7.1 沙箱内无法访问网络

**症状：** `npm install` 失败

**排查步骤：**

```bash
# 检查 Docker 网络
docker network ls

# 测试网络连通性
docker exec <container-id> ping 8.8.8.8
```

**解决方案：**

```typescript
// 在配置中启用网络
const config: SandboxConfig = {
  networkEnabled: true,
};
```

---

## 8. 跨平台路径问题

### 8.1 Windows 路径错误

**症状：** 文件找不到

**排查步骤：**

```bash
# 检查路径格式
echo $PATH
```

**解决方案：**

```typescript
// 使用 path 模块
import path from 'path';

const sandboxPath = path.join(workspacePath, 'projects');
// 避免手动拼接字符串
```

---

## 9. 日志获取

### 9.1 主进程日志

```bash
# 查看主进程日志
tail -f ~/.nuwaclaw/logs/main.$(date +%Y-%m-%d).log
```

### 9.2 Docker 容器日志

```bash
# 查看容器日志
docker logs <container-id>

# 实时跟踪
docker logs -f <container-id>
```

---

## 10. 常见错误代码

| 错误代码 | 说明 | 解决方案 |
|---------|------|---------|
| `SANDBOX_UNAVAILABLE` | 沙箱不可用 | 检查 Docker/WSL/Firejail 安装 |
| `WORKSPACE_NOT_FOUND` | 工作区不存在 | 创建工作区或检查 ID |
| `WORKSPACE_EXISTS` | 工作区已存在 | 销毁现有工作区 |
| `PERMISSION_DENIED` | 权限不足 | 检查权限配置或用户确认 |
| `EXECUTION_FAILED` | 执行失败 | 查看详细日志 |
| `EXECUTION_TIMEOUT` | 执行超时 | 增加超时或优化命令 |
| `FILE_NOT_FOUND` | 文件不存在 | 检查路径 |
| `FILE_WRITE_FAILED` | 文件写入失败 | 检查磁盘空间和权限 |
| `CLEANUP_FAILED` | 清理失败 | 手动清理或检查进程 |
| `CONFIG_INVALID` | 配置无效 | 检查配置参数 |

---

## 11. 获取帮助

### 11.1 收集诊断信息

```bash
# 1. 系统信息
uname -a

# 2. Docker 信息
docker version
docker info

# 3. 应用日志
tar -czf diagnostics.tar.gz ~/.nuwaclaw/logs/

# 4. 配置文件
cat ~/.nuwaclaw/config.json
```

### 11.2 报告问题

报告问题时请包含：
- 操作系统版本
- Docker/WSL/Firejail 版本
- 错误日志
- 复现步骤
- 预期行为

---

## 12. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |
