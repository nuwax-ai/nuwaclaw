---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Runtime Environment Profiles (strict / compat)

> 目标：在保持默认安全隔离的前提下，提升客户端动态安装与企业网络场景兼容性。
> 适用范围：Electron 主进程中所有 spawn 出来的 agent/mcp/installer 进程。
> 更新日期：2026-02-24

---

## 1. 背景问题

当前实现以“强隔离”为主（受控 `PATH/NODE_PATH/HOME/XDG`），安全性较好，但在以下场景易失败：

- 企业网络需要代理/自签名证书（`HTTP_PROXY/HTTPS_PROXY/NODE_EXTRA_CA_CERTS`）
- 用户依赖系统级工具链或用户级安装（如 nvm 管理的 npm）
- MCP 动态安装依赖外部 CLI 时，环境变量不足

---

## 2. 设计目标

- 默认安全：继续以隔离模式运行，避免读取用户全局敏感配置
- 可控兼容：支持显式切换“兼容模式”，只透传白名单变量
- 单点治理：所有运行时 env 统一通过一个构建函数生成
- 可回滚：随时切回 strict，不影响持久化数据

---

## 3. Profile 定义

### 3.1 strict（默认）

- 路径：应用内优先（`~/.nuwaclaw/node_modules/.bin`, `~/.nuwaclaw/bin`）
- 配置：隔离 `HOME/XDG/CLAUDE_CONFIG_DIR/NUWAXCODE_CONFIG_DIR`
- npm/uv：使用应用内缓存、镜像和目录
- 不透传用户级敏感变量

适用：生产默认、可复现优先、安全优先。

### 3.2 compat（可选）

- 在 strict 基础上，增加受控透传，提升外部环境兼容性
- 透传变量采用“固定白名单 + 管理员追加白名单”机制
- 仍禁止关键变量覆写隔离边界

适用：企业网络、需要外部凭证/代理/证书链的机器。

---

## 4. 变量策略

### 4.1 必须透传（compat）

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `NO_PROXY`
- `SSL_CERT_FILE`
- `NODE_EXTRA_CA_CERTS`

### 4.2 可选透传（compat，白名单配置）

- `PIP_INDEX_URL`
- `UV_DEFAULT_INDEX`
- `GIT_ASKPASS`
- `SSH_AUTH_SOCK`

### 4.3 永不透传/永不被外部覆写

- `CLAUDE_*`
- `ANTHROPIC_*`
- `OPENAI_*`
- `NPM_CONFIG_PREFIX`
- `HOME`
- `USERPROFILE`
- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_CACHE_HOME`
- `CLAUDE_CONFIG_DIR`
- `NUWAXCODE_CONFIG_DIR`

---

## 5. 统一实现接口

```typescript
export type RuntimeEnvProfile = 'strict' | 'compat';

export type BuildRuntimeEnvOptions = {
  profile: RuntimeEnvProfile;
  base?: Record<string, string | undefined>;
  injected?: Record<string, string | undefined>;
  passthroughAllowlist?: string[];
  protectedKeys?: string[];
};

export function buildRuntimeEnv(options: BuildRuntimeEnvOptions): Record<string, string>;
```

建议文件：

- `src/main/services/system/runtimeEnv.ts`

规则：

1. 先构建 strict 基础 env
2. 按 profile 决定是否应用透传白名单
3. 应用 `injected` 时，禁止覆盖 `protectedKeys`
4. 输出前去除 `undefined` 值

---

## 6. 调用点改造清单

需要统一接入 `buildRuntimeEnv()` 的位置：

- `src/main/services/system/dependencies.ts` (`getAppEnv`)
- `src/main/services/engines/acp/acpClient.ts`
- `src/main/services/packages/mcp.ts`
- `src/main/services/engines/engineManager.ts`
- `src/main/ipc/processHandlers.ts`（启动子进程路径）

兼容性遗留需处理：

- `src/main/services/packages/packageManager.ts` 仍使用 `userData` 路径，应统一到 `~/.nuwaclaw`

---

## 7. 配置项建议

建议新增设置键：

- `runtime_env.profile`: `'strict' | 'compat'`（默认 `strict`）
- `runtime_env.passthrough_allowlist`: `string[]`（默认空）

优先级：

1. 会话级覆盖（可选）
2. 全局设置
3. 默认值（strict）

---

## 8. 风险与对策

- 风险：compat 引入环境污染  
  对策：只透传白名单；关键变量保护不可覆写；日志打印差异快照（不打印敏感值）

- 风险：strict 与 compat 行为差异导致“只在某模式复现”  
  对策：诊断页显示当前 profile；错误日志带 profile 标签

- 风险：企业网络证书链复杂  
  对策：优先支持 `NODE_EXTRA_CA_CERTS` 和 `SSL_CERT_FILE`，必要时允许管理员扩展白名单

---

## 9. 测试清单

- strict/compat 下 `PATH/NODE_PATH/HOME/XDG` 是否符合预期
- compat 下代理变量是否生效（npm install、mcp-proxy 拉取）
- 外部 `agent_config.env` 是否无法覆写受保护键
- Windows/macOS/Linux 路径分隔和变量行为一致性
- 运行中切换 profile 后，新启动进程是否正确生效

---

## 10. 迁移与回滚

迁移步骤：

1. 引入 `runtimeEnv.ts`，保持默认 strict  
2. 替换核心调用点 env 构建逻辑  
3. 增加设置项与诊断输出  
4. 小流量启用 compat，收集失败案例再扩展白名单

回滚策略：

- 将 `runtime_env.profile` 强制设为 `strict`
- 保留新代码路径，不做数据迁移回退（无存储格式变化）

