# 客户端依赖（服务）安装、升级与启动流程

> 本文档梳理 Electron 客户端应用**依赖安装**（初始化 / 手动）、**升级**、**启动时同步**以及**安装或升级后的服务停止与重启**全流程，便于维护与排查。

---

## 1. 概述

- **必需依赖**：由 `SETUP_REQUIRED_DEPENDENCIES` 定义，不随应用打包，需在「初始化」或「依赖 Tab」中安装到 `~/.nuwaclaw/`（或项目配置的数据目录）下的 `node_modules`。
- **版本判定**：以**当前已真实安装的版本**为准；用户可在依赖 Tab 下手动升级，已安装版本 ≥ 配置的 `installVersion` 即视为就绪，**不降级**。
- **安装/升级后**：在主界面下（含重装流程和依赖 Tab），依赖安装或升级成功后会调用 `services.restartAll()` 重启所有服务，使新二进制生效。初始化向导中的依赖安装不触发重启（此时服务尚未启动，向导完成后由自动重连流程启动服务）。

---

## 2. 必需依赖列表（SETUP_REQUIRED_DEPENDENCIES）

| 名称 | 显示名 | 类型 | 说明 | 固定版本(installVersion) |
|------|--------|------|------|--------------------------|
| uv | uv | bundled | Python 包管理器（已集成） | minVersion: 0.5.0 |
| pnpm | pnpm 包管理器 | npm-local | Node 包管理器 | 10.30.3 |
| nuwax-file-server | 文件服务 | npm-local | 工作目录文件远程管理 | 1.2.2 |
| nuwaxcode | Agent 引擎 | npm-local | 执行引擎 | 1.1.63 |
| nuwax-mcp-stdio-proxy | MCP 服务 | npm-local | MCP 协议聚合代理 | 1.4.6 |
| claude-code-acp-ts | ACP 协议 | npm-local | 引擎统一适配 | 0.16.1 |

- **配置位置**：`src/main/services/system/dependencies.ts` 中的 `SETUP_REQUIRED_DEPENDENCIES`。
- **检测**：`checkAllDependencies()` 仅检查上述列表，返回每项状态：`installed` | `bundled` | `missing` | `outdated` | `error`。

---

## 3. 依赖状态与版本判定

- **installed / bundled**：已就绪，无需操作。
- **missing**：未安装，需要安装。
- **outdated**：已安装但当前版本 < 配置的 `installVersion`，可升级；**不强制**进入全屏依赖安装（用户可在依赖 Tab 自行升级）。
- **error**：检测或安装过程出错。

**版本比较约定**：

- 以**当前已安装版本**与配置的 `installVersion` 比较。
- 仅当「未安装」或「已装版本 < installVersion」时标记为需安装/升级；已装 ≥ 目标则视为已就绪，不降级。
- 实现见 `dependencies.ts` 中 `checkAllDependencies` 的 `compareVersions(installed, target)` 逻辑。

---

## 4. 初始化安装（首次 / 向导内）

### 4.1 入口与流程

- **入口**：应用启动后若 `setupService.isSetupCompleted()` 为 false，渲染**初始化向导**（`SetupWizard`）。
- **向导阶段 1**：依赖检测与安装（`SetupDependencies`）。
  - 调用 `dependencies.checkAll()`，若有任一项非 `installed`/`bundled`（包括 `outdated`），则进入依赖安装 UI。
  - **注意**：向导内 `outdated` 也会触发安装阶段（确保首次设置时所有依赖都是最新），而主界面下 `outdated` 不触发全屏重装（见 section 5.1）。
  - 先检查系统依赖（如 uv）；若缺失则提示并阻塞。
  - 对 npm-local 等可安装项自动或手动安装，全部就绪后进入下一步。
- **完成回调**：`SetupDependencies` 的 `onComplete` 由 `SetupWizard.handleDepsComplete` 处理：置 `dependenciesReady = true`，然后进入「基础设置」步骤或快捷初始化（Quick Init）。

### 4.2 与 Quick Init 的关系

- 若依赖已全部就绪且存在快捷初始化配置，会优先走 Quick Init，不再重复安装依赖。
- 依赖步骤**不可跳过**：必须先完成依赖检测/安装，再进入基础设置与登录。

---

## 5. 主界面下「必需依赖缺失」触发的重装流程

### 5.1 触发条件

- 用户已进入主界面（`isSetupComplete === true`）。
- 应用在进入主界面后执行一次 `dependencies.checkAll()`。
- **仅当**存在状态为 `missing` 或 `error` 的必需依赖时，置 `needsRequiredDepsReinstall = true`。
- **outdated 不触发**：已安装但版本低于配置时，不强制全屏依赖安装，用户可在依赖 Tab 自行升级。

### 5.2 流程

1. 渲染层：`needsRequiredDepsReinstall === true` 时，全屏展示 `SetupDependencies`（与向导内为同一组件）。
2. 用户完成依赖安装后，`onComplete` 被调用：
   - 先 `setNeedsRequiredDepsReinstall(false)`，回到主界面。
   - 再调用 `restartAllServices()`（内部先停后启），使新依赖生效。
3. 不改变 `isSetupComplete`，不重新走向导的账号登录等步骤。

### 5.3 涉及代码

- `App.tsx`：`needsRequiredDepsReinstall` 状态、`checkRequiredDeps` 的 `useEffect`、全屏 `SetupDependencies` 的 `onComplete` 与 `restartAllServices()`。

---

## 6. 依赖 Tab 下手动安装 / 升级

### 6.1 入口

- 主界面 → 依赖 Tab（`DependenciesPage`）。
- 可对单项点击「安装」/「升级」，或使用「全部安装」/「全部升级」/「安装并升级」。

### 6.2 行为

- **单项**：调用 `dependencies.installPackage(name, options?)`，可选 `options.version`（如 `installVersion`）；成功后调用 `restartServicesAfterDepChange()`。
- **批量**：遍历需安装/升级的依赖依次安装；若有任意一项成功，则调用 `restartServicesAfterDepChange()`。
- **restartServicesAfterDepChange**：内部调用 `services.restartAll()`（主进程内先停后启），并提示「正在重启服务…」「服务已重启」或失败提示。

### 6.3 版本与文案

- 以当前已安装版本为准；`outdated` 时按钮为「升级」，否则为「安装」。
- 批量时按缺失/过期组合显示「全部安装」「全部升级」或「安装并升级」；完成提示区分「依赖安装完成」「依赖升级完成」「依赖安装并升级完成」。

---

## 7. 应用启动时的依赖同步（syncInitDependencies）

- **目的**：应用升级后，若配置中的 `installVersion` 或应用版本发生变化，将依赖同步到新版本。
- **触发**：主进程启动任务（`bootstrap/startup.ts`）中，通过 `getInitDepsState()` 读取上次同步状态，与当前 `app.getVersion()` 及各包 `installVersion` 逐一比较。满足以下任一条件即触发 `syncInitDependencies()`：
  - 应用版本（`appVersion`）与上次记录不同（含首次无记录）；
  - 任一包的 `installVersion` 与上次记录的对应值不同（含上次无该包记录）。
- **行为**：对 `SETUP_REQUIRED_DEPENDENCIES` 中带 `installVersion` 的 npm-local 包，若未安装或已装版本低于配置，则安装到指定版本，并写回 `~/.nuwaclaw/.init-deps-state.json`（或当前数据目录下的同名文件）。
- **不降级**：已安装版本 ≥ `installVersion` 的包不会被执行安装，避免覆盖用户手动升级的更高版本。

---

## 8. 安装或升级后的服务停止与重启

以下任一场景在「依赖安装或升级成功」后，都会执行**先停止再重启**所有相关服务，使新二进制生效：

| 场景 | 位置 | 行为 |
|------|------|------|
| 主界面重装依赖完成 | `App.tsx` 全屏 `SetupDependencies` 的 `onComplete` | `setNeedsRequiredDepsReinstall(false)` 后调用 `restartAllServices()`（即 `services.restartAll()`） |
| 依赖 Tab 单项安装/升级成功 | `DependenciesPage.handleInstallSingleDep` | 调用 `restartServicesAfterDepChange()` → `services.restartAll()` |
| 依赖 Tab 批量安装/升级且至少成功一项 | `DependenciesPage.handleInstallAllDeps` | 同上 `restartServicesAfterDepChange()` |

- **restartAll**：主进程 `processHandlers.ts` 中 `services:restartAll` IPC handler 的实现会先停止 Agent、ComputerServer、FileServer、Lanproxy（**不停 MCP**），再按顺序启动 MCP → Agent → ComputerServer → FileServer → Lanproxy。MCP 在 restartAll 中只做 start/verify，不先停。
- **stopAll**：主进程 `processHandlers.ts` 中 `services:stopAll` IPC handler 会停止所有服务**包括 MCP**。
- **用户登出**：渲染进程 `ClientPage.handleLogout` 在停止 agent/fileServer/lanproxy/mcp 后，会单独调用 `computerServer.stop()`，避免登出后进程残留导致端口冲突；详见 [认证机制与 SavedKey 生命周期](./auth-savedkey-lifecycle.md#退出登录)。
- **serviceManager.ts**：`serviceManager.restartAllServices()` 是另一套实现（供 `main.ts` 内部和 Tray 菜单使用），行为与 IPC `restartAll` 略有不同：会先停 MCP 再启动，且不包含 ComputerServer。渲染进程通过 `window.electronAPI.services.restartAll()` 调用的是 `processHandlers.ts` 中的 IPC handler 版本。
- **无需单独 stopAll**：`restartAll` 内部已包含停止逻辑（Agent / ComputerServer / FileServer / Lanproxy）；若需停止所有服务（含 MCP）且不重启，可调用 `services.stopAll()`。

---

## 9. 涉及文件与入口汇总

| 类型 | 路径 / 说明 |
|------|------------------|
| 依赖配置与检测 | `src/main/services/system/dependencies.ts`：`SETUP_REQUIRED_DEPENDENCIES`、`checkAllDependencies`、`installNpmPackage`、`installMissingDependencies`、`syncInitDependencies`、`compareVersions` |
| 启动同步 | `src/main/bootstrap/startup.ts`：启动后根据 `getInitDepsState` 与版本比较调用 `syncInitDependencies` |
| IPC | `src/main/ipc/dependencyHandlers.ts`：`dependencies:checkAll`、`dependencies:installPackage` 等；`processHandlers.ts`：`services:stopAll`、`services:restartAll` |
| 服务管理器 | `src/main/window/serviceManager.ts`：`restartAllServices`、`stopAllServices`（供 main.ts / Tray 使用，行为与 IPC handler 略有不同，见 section 8） |
| 初始化向导 | `src/renderer/components/setup/SetupWizard.tsx`、`SetupDependencies.tsx`：向导内依赖步骤与完成回调 |
| 主界面重装 | `src/renderer/App.tsx`：`needsRequiredDepsReinstall`、全屏 `SetupDependencies`、`checkRequiredDeps`、`restartAllServices` |
| 依赖 Tab | `src/renderer/components/pages/DependenciesPage.tsx`：单项/批量安装与 `restartServicesAfterDepChange` |
| 持久化 | `~/.nuwaclaw/.init-deps-state.json`（或当前数据目录）：应用版本与各包上次同步版本，读写在 `dependencies.ts` 的 `getInitDepsState` / `setInitDepsState` |

---

## 10. 相关文档

- [依赖版本固定与安装/升级行为](./dependency-version-pinning.md) — installVersion、同步、文案与不降级约定。
- [Quick Init](./QUICK-INIT.md) — 快捷初始化与依赖步骤不可跳过的约定。
