---
version: 1.0
last-updated: 2026-03-04
status: stable
---

# Quick Init — 快捷初始化

> 通过预置 `~/.nuwaclaw/nuwaclaw.json` 或环境变量，跳过手动向导完成客户端初始化。

---

## 概述

客户端初始化向导需要用户手动填写配置（端口、工作区）和登录（动态认证码）。Quick Init 支持通过预置配置文件或环境变量快速完成初始化——文件中包含 `savedKey`（已完成过登录的设备密钥），直接调 reg 接口（password 传空字符串），跳过动态码流程。

**关键约束**：即使有快捷配置，依赖安装步骤不能跳过，必须先完成依赖检测/安装。nuwax-file-server、nuwax-mcp-stdio-proxy、nuwaxcode、claude-code-acp-ts 四包均不随包集成，通过 SETUP_REQUIRED_DEPENDENCIES 的 installVersion 在 ~/.nuwaclaw 初始化安装，并参与升级后的 syncInitDependencies。

---

## 配置来源与优先级

```
nuwaclaw.json (quickInit scope)  →  环境变量  →  无配置（走正常向导）
```

Per-field 合并：每个字段独立按 JSON > 环境变量 > 默认值 取值。

### nuwaclaw.json

文件路径：`~/.nuwaclaw/nuwaclaw.json`

使用 `quickInit` scope，便于将来在同一文件中增加其他配置。

```json
{
  "quickInit": {
    "enabled": true,
    "serverHost": "https://agent.nuwax.com",
    "savedKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "username": "user@example.com",
    "agentPort": 60001,
    "fileServerPort": 60000,
    "workspaceDir": "/home/user/workspace"
  }
}
```

最简写法（只需必填字段，其余走默认值）：

```json
{
  "quickInit": {
    "serverHost": "https://agent.nuwax.com",
    "savedKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

设为 `"enabled": false` 可禁用快捷初始化（同时阻断环境变量回退）。

### 环境变量

| 环境变量 | 对应字段 | 必填 |
|---|---|---|
| `NUWAX_SERVER_HOST` | serverHost | 是 |
| `NUWAX_SAVED_KEY` | savedKey | 是 |
| `NUWAX_USER_NAME` | username | 否 |
| `NUWAX_AGENT_PORT` | agentPort | 否 |
| `NUWAX_FILE_SERVER_PORT` | fileServerPort | 否 |
| `NUWAX_WORKSPACE_DIR` | workspaceDir | 否 |

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `serverHost` | string | **是** | - | 服务域名 |
| `savedKey` | string | **是** | - | 设备密钥（已注册） |
| `username` | string | 否 | `''` | 登录用户名 |
| `agentPort` | number | 否 | `60001` | Agent 端口 |
| `fileServerPort` | number | 否 | `60000` | 文件服务端口 |
| `workspaceDir` | string | 否 | `~/.nuwaclaw/workspace` | 工作区目录 |
| `enabled` | boolean | 否 | `true` | 是否启用（仅 JSON） |

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│                                                              │
│  bootstrap/quickInit.ts                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │  readQuickInitConfig()                              │     │
│  │  1. 读取 ~/.nuwaclaw/nuwaclaw.json → quickInit     │     │
│  │  2. 读取 NUWAX_* 环境变量                           │     │
│  │  3. Per-field 合并: JSON > env > default            │     │
│  │  4. 校验 serverHost + savedKey 必填                  │     │
│  │  5. 缓存结果（每次启动只读一次）                       │     │
│  └────────────────────────────────────────────────────┘     │
│                         │                                    │
│                    IPC: quickInit:getConfig                  │
│                         │                                    │
├─────────────────────────┼───────────────────────────────────┤
│                         ▼                                    │
│                  Renderer Process                            │
│                                                              │
│  App.tsx (每次启动)                                          │
│  ┌────────────────────────────────────────────────────┐     │
│  │  checkSetup:                                        │     │
│  │    setup 已完成?                                     │     │
│  │      ├─ 是 → quickInit.getConfig()                  │     │
│  │      │        ├─ 有配置 → applyQuickInitToDb()      │     │
│  │      │        │   (覆盖 step1 + savedKey + 静默注册) │     │
│  │      │        └─ 无配置 → 使用 DB 已有值             │     │
│  │      │    → 进入主界面                                │     │
│  │      └─ 否 → 渲染 SetupWizard                       │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  SetupWizard.tsx (仅首次 setup)                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  启动 → 依赖检测                                     │     │
│  │    │                                                │     │
│  │    ├─ 依赖就绪 + setup 未完成                         │     │
│  │    │    └─ quickInit.getConfig()                     │     │
│  │    │         ├─ 有配置 → performQuickInit()          │     │
│  │    │         └─ 无配置 → 正常向导                     │     │
│  │    │                                                │     │
│  │    └─ 依赖缺失 → 安装流程                             │     │
│  │         └─ handleDepsComplete                       │     │
│  │              └─ quickInit.getConfig()               │     │
│  │                   ├─ 有配置 → performQuickInit()     │     │
│  │                   └─ 无配置 → 正常向导               │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```
│  │                   └─ 无配置 → 正常向导                │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 启动时序

```
App 启动
  │
  ├─ Main: 注册 quickInit:getConfig IPC handler
  │
  └─ Renderer: App.tsx checkSetup
       │
       └─ setupService.isSetupCompleted()
            │
            ├─ true (setup 已完成)
            │    └─ ✅ quickInit.getConfig()
            │         ├─ 有配置 → applyQuickInitToDb()
            │         │   覆盖 step1 config + savedKey + 静默 loginAndRegister
            │         └─ 无配置 → 使用 DB 已有值
            │    → 进入主界面 → autoReconnect → 启动服务
            │
            └─ false (setup 未完成) → 渲染 SetupWizard
                  │
                  └─ useEffect init()
                       │
                       ├─ 依赖全部就绪
                       │    └─ ✅ quickInit.getConfig()
                       │         ├─ 有配置 → performQuickInit() → 自动完成
                       │         └─ 无配置 → 正常向导 step 1/2
                       │
                       └─ 依赖缺失 → 安装流程
                            └─ 安装完成 handleDepsComplete
                                 └─ ✅ quickInit.getConfig()
```

**每次启动都读取配置**：无论 setup 是否已完成，都优先读取 `nuwaclaw.json` / 环境变量。有配置 → 覆盖 DB；无配置 → 使用 DB 已有值。

---

## applyQuickInitToDb 流程（setup 已完成时）

App.tsx 中 setup 已完成时静默更新 DB，确保后续 autoReconnect / 服务启动使用最新值。

```
applyQuickInitToDb(config)
  │
  ├─ 1. 覆盖 Step1 配置（serverHost, agentPort, fileServerPort, workspaceDir）
  │
  ├─ 2. 覆盖 savedKey（全局 + 域名级）
  │
  └─ 3. 静默 loginAndRegister(username, '', { domain })
        └─ 失败不阻塞启动（console.warn，已有 auth 信息仍可用）
```

## performQuickInit 流程（setup 未完成时）

```
performQuickInit(config)
  │
  ├─ 1. 保存 Step1 配置（serverHost, agentPort, fileServerPort, workspaceDir）
  │
  ├─ 2. 预存 savedKey 到 SQLite
  │     ├─ AUTH_KEYS.SAVED_KEY → 全局 savedKey
  │     └─ AUTH_KEYS.SAVED_KEYS_PREFIX + domain_username → 域名级 savedKey
  │
  ├─ 3. loginAndRegister(username, '', { domain })
  │     └─ password 传空字符串，函数内部从 DB 取 savedKey 附加到 reg 请求
  │
  ├─ 4. completeStep2() + completeSetup()
  │
  └─ 5. onComplete() → 进入主界面
  │
  └─ [失败] catch → console.error → 回退到手动向导（step1 可能已保存）
```

失败兜底：quick init 任何步骤失败 → 回退到正常向导流程。UI 显示 `<Spin>` + "正在自动配置..."。

---

## 文件清单

### 新建

| 文件 | 说明 |
|---|---|
| `src/shared/types/quickInit.ts` | `QuickInitConfig` 接口 + `hasRequiredQuickInitFields()` 校验 |
| `src/main/bootstrap/quickInit.ts` | Main 进程读取 JSON / 环境变量，per-field 合并，缓存 |
| `src/shared/types/quickInit.test.ts` | 类型校验测试（10 cases） |
| `src/main/bootstrap/quickInit.test.ts` | 读取逻辑测试（19 cases） |

### 修改

| 文件 | 改动 |
|---|---|
| `src/main/ipc/settingsHandlers.ts` | 添加 `quickInit:getConfig` IPC handler |
| `src/preload/index.ts` | 暴露 `quickInit.getConfig()` 给 Renderer |
| `src/shared/types/electron.d.ts` | 添加 `QuickInitAPI` 接口 + `ElectronAPI.quickInit` |
| `src/renderer/App.tsx` | setup 已完成时读取配置 → `applyQuickInitToDb()` 覆盖 DB |
| `src/renderer/components/setup/SetupWizard.tsx` | setup 未完成时检测配置 → `performQuickInit()` 自动完成流程 |

---

## 复用的现有函数

| 函数 | 文件 | 用途 |
|---|---|---|
| `loginAndRegister()` | `renderer/services/core/auth.ts` | 调用 reg API，savedKey 由函数内部从 DB 读取 |
| `normalizeServerHost()` | `renderer/services/core/auth.ts` | 域名标准化（加 https 前缀、去尾 /） |
| `setupService.saveStep1Config()` | `renderer/services/core/setup.ts` | 保存 step1 配置并更新 state |
| `setupService.completeStep2()` | `renderer/services/core/setup.ts` | 标记 step2 完成 |
| `setupService.completeSetup()` | `renderer/services/core/setup.ts` | 标记整体完成 |
| `APP_DATA_DIR_NAME` | `shared/constants.ts` | `.nuwaclaw` 目录名 |
| `DEFAULT_AGENT_RUNNER_PORT` | `shared/constants.ts` | `60001` |
| `DEFAULT_FILE_SERVER_PORT` | `shared/constants.ts` | `60000` |

---

## 测试

29 个测试用例，覆盖以下场景：

### hasRequiredQuickInitFields（10 cases）

- 必填字段齐全 / 全字段齐全
- 缺 serverHost / 缺 savedKey / 空字符串
- null / undefined / 非 object / 字段类型错误

### readQuickInitConfig（19 cases）

| 分类 | 场景 |
|---|---|
| 无配置 | 无 JSON + 无 env → null |
| JSON | 全字段 / 仅必填（填默认值） / enabled:false / enabled:true / 无 quickInit scope / 缺必填 / 格式错误 |
| 环境变量 | 全字段 / 仅必填 / 缺一个必填 → null / 无效端口回退默认 |
| 优先级 | JSON > env / env 补充 JSON 缺失字段 / 都缺省走 default |
| enabled:false | 阻断环境变量回退 |
| 缓存 | 二次调用同引用 / null 也缓存 |

运行：

```bash
npx vitest run src/shared/types/quickInit.test.ts src/main/bootstrap/quickInit.test.ts
```

---

## 验证清单

| # | 场景 | 预期 |
|---|---|---|
| 1 | 无 JSON + 无 env | 正常向导流程不受影响 |
| 2 | JSON 缺必填字段 | 控制台 warn 日志，走正常向导 |
| 3 | JSON `enabled: false` | 跳过 quick init，不回退 env |
| 4 | 有效 JSON + 无效 savedKey | 依赖安装正常 → quick init 调 reg 失败 → 回退手动向导（step1 已预填） |
| 5 | 有效 JSON + 有效 savedKey | 依赖安装 → 自动配置 spinner → 直接进入主界面 |
| 6 | 仅 env NUWAX_SERVER_HOST + NUWAX_SAVED_KEY | 同 #5，其余走默认值 |
| 7 | JSON serverHost + env NUWAX_AGENT_PORT | JSON 字段优先，env 补充缺失字段 |
| 8 | `npm run electron:dev` 开发模式 | 正常运行 |

---

*Last updated: 2026-03-04*
