# 沙箱安全约束

> 版本: 2.1.0  
> 更新: 2026-03-22  
> 状态: 建设中

---

## 核心原则

**默认拒绝 (Default Deny)**  
不在白名单中的路径、命令一律禁止。

**沙箱内信任**  
在沙箱内的操作完全信任（隔离环境）。

---

## 1. 路径白名单

### 允许路径 ✅
```
~/workspace/**        # 开发工作区
~/projects/**        # 项目目录
~/dev/**            # 开发目录
/tmp/nuwaclaw/**    # 临时沙箱目录
```

### 禁止路径 ❌
```
~/.ssh/**            # SSH 密钥和配置
~/.config/**         # 用户配置
~/.aws/**           # AWS 凭据
~/.kube/**          # Kubernetes 配置
/etc/**             # 系统配置（除非明确允许）
~/Library/**        # macOS 应用数据
/Volumes/**         # 外接存储
/proc/**            # Linux 进程信息
/sys/**             # Linux 系统信息
```

---

## 2. 命令分类

### 自动批准（只读/安全）✅
```
# Git 只读操作
git status, git diff, git log, git show, git cat-file

# 文件查看
cat, head, tail, grep, find, ls, tree, wc, du

# Node.js 工具
node --version, npm --version, pnpm --version, npx --version

# Python 工具
python --version, pip --version, uv --version

# 系统信息
pwd, whoami, uname, date, env, which, whereis
```

### 需要确认 ⚠️
```
# 包安装
npm install, pnpm add, pip install, pip3 install, cargo install

# 下载
curl, wget, fetch, git clone

# 构建
npm run, pnpm build, cargo build, make, cmake
```

### 绝对禁止 ❌（沙箱内也禁止）
```
# 权限提升
sudo, su, chmod 777, chmod -R 777

# 系统包管理
apt-get install, yum install, dnf install, brew install, pacman -S, snap install

# 网络扫描
nmap, masscan, netcat, nc -l
```

### 沙箱内完全允许 ✅
```
# 所有文件操作（包括 rm -rf）
rm, rm -rf, rmdir, mv, cp, touch, mkdir

# Git 所有操作
git add, git commit, git push, git checkout
```

---

## 3. 权限级别

| 级别 | 名称 | 说明 |
|------|------|------|
| 0 | **只读** | 只能读取白名单路径 |
| 1 | **受限写入** | 可以在工作区创建/修改文件 |
| 2 | **标准执行** | 可以执行编译、测试等命令 |
| 3 | **完全访问** | 沙箱内无限制 |

---

## 4. 操作审计

所有操作必须记录到 `harness/feedback/state/state.json`：

```json
{
  "securityMetrics": {
    "totalOperations": 0,
    "blockedOperations": 0,
    "allowedOperations": 0,
    "userConfirmations": 0,
    "autoApprovals": 0
  },
  "recentSecurityEvents": []
}
```

### 安全事件类型
- `path_blocked` - 路径不在白名单
- `command_blocked` - 命令被禁止
- `permission_requested` - 用户需要确认
- `permission_approved` - 用户批准
- `permission_denied` - 用户拒绝

---

## 5. 只读模式

启用只读模式时：
- 所有写操作被禁止
- 只允许白名单中的只读命令
- 适用于敏感任务的审查/分析

```typescript
interface SandboxConfig {
  readOnly: true;  // 开启只读模式
}
```

---

## 6. 违规处理

| 违规类型 | 处理方式 |
|---------|---------|
| 路径不在白名单 | 立即拒绝，返回错误 |
| 命令被禁止 | 立即拒绝，记录审计日志 |
| 需要用户确认 | 暂停执行，等待用户响应 |
| 用户拒绝 | 记录日志，终止操作 |
| 超时 | 强制终止，记录日志 |

---

## 7. CP 工作流集成

### CP1: 任务确认
- [ ] 验证路径在白名单
- [ ] 验证命令未被禁止
- [ ] 确定需要的权限级别

### CP2: 规划分解
- [ ] 检查是否有路径违规风险
- [ ] 检查是否有危险命令
- [ ] 评估需要的用户确认

### CP3: 执行实现
- [ ] 执行前最后权限检查
- [ ] 执行操作
- [ ] 记录操作日志

### CP4: 质量门禁
- [ ] 验证操作成功
- [ ] 验证无副作用
- [ ] 验证审计日志完整

### CP5: 审查完成
- [ ] 更新安全指标
- [ ] 记录安全事件
- [ ] 生成安全报告

---

## 8. 参考

- LobsterAI 权限策略
- rivet-dev/sandbox-agent 安全设计
- OpenAI Agent 安全最佳实践

---

## 9. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 2.1.0 | 沙箱内 rm -rf 允许 |
| 2026-03-22 | 2.0.0 | 全面重构，增加路径白名单、命令分类 |
| 2026-03-22 | 1.0.0 | 初始版本 |
