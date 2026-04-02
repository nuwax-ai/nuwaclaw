# 任务: 创建沙箱工作区

## 输入
- sessionId: string
- platform: darwin | win32 | linux
- sandboxType: docker | wsl | firejail | none
- memoryLimit?: string (默认 "2g")
- diskQuota?: string (默认 "10g")

## CP1: 任务确认
- [ ] 验证 sessionId 非空
- [ ] 验证 platform 与当前系统匹配
- [ ] 验证 sandboxType 可用

## CP2: 规划分解
- [ ] 确定沙箱镜像/配置
- [ ] 分配工作区路径
- [ ] 设置资源限额

## CP3: 执行实现
- [ ] 创建工作区目录结构
- [ ] 启动沙箱容器/进程
- [ ] 注入环境变量

## CP4: 质量门禁
- [ ] config-validate gate
- [ ] sandbox-create gate

## CP5: 审查完成
- [ ] 更新 state.json
- [ ] 记录 metrics
- [ ] 返回 workspace 对象
