# 任务: 在沙箱中执行命令

## 输入
- sessionId: string
- command: string
- args: string[]
- options?: ExecuteOptions

## CP1: 任务确认
- [ ] 验证 sessionId 存在
- [ ] 验证 command 非空
- [ ] 检查命令白名单

## CP2: 规划分解
- [ ] 确定工作目录
- [ ] 检查权限
- [ ] 设置超时

## CP3: 执行实现
- [ ] 请求权限（如需要）
- [ ] 执行命令
- [ ] 捕获输出

## CP4: 质量门禁
- [ ] execute gate (exit code, timeout)

## CP5: 审查完成
- [ ] 记录 execution metrics
- [ ] 返回 ExecuteResult
