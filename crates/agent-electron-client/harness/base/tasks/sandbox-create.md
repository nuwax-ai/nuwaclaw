# 任务：创建沙箱实例

> **版本**: 1.0.0
> **创建时间**: 2026-03-27
> **类型**: sandbox

---

## 1. 任务描述

根据配置创建沙箱实例，支持多平台（macOS/Linux/Windows）。

---

## 2. 输入参数

```typescript
interface SandboxCreateInput {
  // 沙箱模式
  mode: "off" | "on-demand" | "non-main" | "all";
  
  // 平台配置
  platform?: {
    darwin?: { enabled: boolean; type: "seatbelt" | "none"; };
    linux?: { enabled: boolean; type: "bubblewrap" | "none"; };
    win32?: { enabled: boolean; type: "codex" | "none"; };
  };
  
  // 网络配置
  network?: {
    enabled: boolean;
    allowedDomains?: string[];
    deniedDomains?: string[];
  };
  
  // 文件系统配置
  filesystem?: {
    allowRead?: string[];
    denyRead?: string[];
    allowWrite?: string[];
    denyWrite?: string[];
  };
  
  // 资源限制
  resources?: {
    memory?: string;
    cpu?: number;
    timeout?: number;
  };
}
```

---

## 3. 输出结果

```typescript
interface SandboxCreateOutput {
  // 沙箱实例
  sandbox: SandboxInterface;
  
  // 状态信息
  status: {
    available: boolean;
    type: "seatbelt" | "bubblewrap" | "codex" | "none";
    platform: string;
  };
  
  // 错误信息（如果创建失败）
  error?: {
    code: string;
    message: string;
  };
}
```

---

## 4. 前置条件

- [ ] `platform-detect` gate passed
- [ ] `config-validate` gate passed

---

## 5. 实现步骤

### Step 1: 检测平台

```typescript
const platform = os.platform();

// 确认支持的平台
if (!["darwin", "linux", "win32"].includes(platform)) {
  throw new Error(`Unsupported platform: ${platform}`);
}
```

### Step 2: 选择对应实现

```typescript
let sandbox: SandboxInterface;

switch (platform) {
  case "darwin":
    sandbox = new MacSandbox();
    break;
  case "linux":
    sandbox = new LinuxSandbox();
    break;
  case "win32":
    sandbox = new WindowsSandbox();
    break;
}
```

### Step 3: 初始化沙箱

```typescript
await sandbox.initialize(config);
```

### Step 4: 返回实例

```typescript
return {
  sandbox,
  status: {
    available: await sandbox.isAvailable(),
    type: sandbox.getType(),
    platform,
  },
};
```

---

## 6. 示例

### 基本使用

```typescript
const { sandbox, status } = await createSandbox({
  mode: "non-main",
  network: {
    enabled: true,
    allowedDomains: ["github.com", "npmjs.org"],
  },
});

console.log(status);
// {
//   available: true,
//   type: "seatbelt",
//   platform: "darwin"
// }
```

### 完整配置

```typescript
const { sandbox } = await createSandbox({
  mode: "all",
  platform: {
    darwin: { enabled: true, type: "seatbelt" },
  },
  network: {
    enabled: true,
    allowedDomains: ["github.com"],
    deniedDomains: ["*.internal.com"],
  },
  filesystem: {
    allowRead: [".", "/usr/local/lib"],
    denyRead: ["~/.ssh", "~/.aws"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", "*.pem"],
  },
  resources: {
    memory: "4g",
    cpu: 4,
    timeout: 600,
  },
});
```

---

## 7. 验证清单

- [ ] 返回有效的沙箱实例
- [ ] 平台匹配正确
- [ ] 配置已应用
- [ ] 状态信息准确

---

## 8. 错误处理

| 错误代码 | 说明 | 处理方式 |
|---------|------|---------|
| `PLATFORM_UNSUPPORTED` | 不支持的平台 | 降级到无沙箱 |
| `SANDBOX_UNAVAILABLE` | 沙箱不可用 | 提示用户安装依赖 |
| `CONFIG_INVALID` | 配置无效 | 返回配置错误详情 |
| `INIT_FAILED` | 初始化失败 | 记录日志并重试 |

---

## 9. 性能要求

- **启动时间**: <100ms
- **内存占用**: <50MB
- **CPU 开销**: <5%

---

## 10. 安全考虑

- ✅ 验证所有输入参数
- ✅ 限制资源使用
- ✅ 记录审计日志
- ✅ 清理敏感信息

---

**任务状态**: 待执行
**负责人**: AI Agent
**预计时间**: 30 分钟
