---
version: 1.0
last-updated: 2026-03-04
status: stable
---

# 初始化依赖版本固定与安装/升级行为

> 本文档留存「初始化依赖版本固定」「客户端升级后依赖同步」「安装/升级文案」「尊重用户已安装版本」等需求与实现约定。

---

## 概述

以下四类 npm 包不随应用打包，在 `~/.nuwaclaw` 下按配置版本进行初始化安装，并在客户端升级后按新版本同步；同时需尊重用户在「依赖」Tab 下的手动升级结果，不降级已安装的更高版本。

| 包名 | 用途 |
|------|------|
| nuwax-file-server | 文件服务 |
| nuwax-mcp-stdio-proxy | MCP 聚合代理 |
| nuwaxcode | 引擎 |
| claude-code-acp-ts | 引擎 ACP |

---

## 需求与约束

### 1. 初始化依赖版本固定（installVersion）

- **目的**：保证首次安装/初始化时安装的版本稳定、可预期，避免「总是装最新」带来的兼容性风险。
- **实现**：在 `SETUP_REQUIRED_DEPENDENCIES` 中为上述四包配置 `installVersion`，初始化或补装时执行 `npm install <name>@<installVersion>`。
- **范围**：仅影响「初始化/安装缺失依赖」和「依赖 Tab 内一键安装」使用的版本；依赖 Tab 下手动升级行为不受此限制（见下文）。

### 2. 客户端升级后的依赖同步

- **目的**：应用发新版本时，若配置中的 `installVersion` 发生变化，用户环境中的依赖应被同步到新版本，无需用户手动操作。
- **实现**：
  - 持久化：`~/.nuwaclaw/.init-deps-state.json` 记录当前应用版本及各包「上次同步时的目标版本」。
  - 启动时：若检测到应用版本或某包的 `installVersion` 与持久化状态不一致，在后台调用 `syncInitDependencies()`，对需要更新的包执行安装/升级并写回状态。
- **注意**：同步逻辑必须结合「当前已安装的实际版本」判断是否需要升级，避免对用户已手动升级的更高版本做降级（见下节）。

### 3. 安装与升级的文案区分

- **目的**：当既有「缺失需安装」又有「已装但需升级」时，文案明确区分「安装」与「升级」，避免一律显示「安装」造成误解。
- **约定**：
  - 初始化向导（SetupDependencies）：若存在需升级的依赖，阶段文案使用「正在安装并升级依赖...」/「正在安装并升级 xxx...」；错误态标题/按钮使用「依赖安装与升级」「重试安装并升级」「安装/升级失败」等。
  - 依赖页（DependenciesPage）：
    - 批量：既有缺失又有过期时按钮为「安装并升级」；仅过期时为「全部升级」；仅缺失时为「全部安装」。
    - 单项：状态为 `outdated` 时按钮为「升级」，否则为「安装」；进行中分别显示「升级中...」「安装中...」；成功/失败提示对应「升级成功/失败」「安装成功/失败」。
  - 完成提示：按实际执行结果区分「依赖安装完成」「依赖升级完成」「依赖安装并升级完成」。

### 4. 结合当前已安装的实际版本（不降级）

- **背景**：用户可以在「依赖」Tab 下手动升级某个包到比应用配置的 `installVersion` 更高的版本。若仅以「是否等于 installVersion」判断，会把「已装更高版本」误判为需升级并执行安装，导致被降级。
- **约定**：
  - **判定需升级的条件**：仅当「未安装」或「当前已安装版本 < 配置的 installVersion」时，才标记为需安装/升级（`outdated` 或执行安装）。
  - **判定已就绪的条件**：当前已安装版本 ≥ installVersion 时，视为已就绪，不再提示升级、不执行安装。
- **实现要点**：
  - `checkAllDependencies`：对上述四包，使用版本比较（如 `compareVersions(已装版本, installVersion)`），只有已装 < 目标时才置 `status === 'outdated'`。
  - `syncInitDependencies`：仅当未安装或已装版本低于 `installVersion` 时才执行安装/升级；已装 ≥ 目标则跳过。
  - 代码注释中注明：「用户可在依赖 Tab 下手动升级，故以当前已安装的实际版本为准，不降级。」

---

## 涉及文件与入口

| 类型 | 路径/说明 |
|------|-----------|
| 配置与检测 | `src/main/services/system/dependencies.ts`：`SETUP_REQUIRED_DEPENDENCIES`、`checkAllDependencies`、`installMissingDependencies`、`syncInitDependencies`、`compareVersions` |
| 持久化 | `~/.nuwaclaw/.init-deps-state.json`，读写通过 `getInitDepsState` / `setInitDepsState` |
| 启动触发 | `src/main/bootstrap/startup.ts`：应用启动后根据状态决定是否调用 `syncInitDependencies` |
| 向导 UI | `src/renderer/components/setup/SetupDependencies.tsx`：阶段文案、错误态标题与按钮、安装时传入 `installVersion` |
| 依赖页 UI | `src/renderer/components/pages/DependenciesPage.tsx`：批量/单项按钮文案、安装中/升级中文案、`installVersion` 传入 |
| 类型与 API | `src/shared/types/electron.d.ts`：`LocalDependencyItem.installVersion`；preload 暴露 `dependencies.installPackage(name, options?)` 支持 `options.version` |

---

## 相关文档

- [Quick Init](./QUICK-INIT.md) — 快捷初始化中约定依赖步骤不可跳过，且上述四包通过 installVersion 初始化并参与 syncInitDependencies。
- 依赖检测与安装的详细逻辑见 `dependencies.ts` 内注释及导出接口。

---

*本文档用于留存需求与行为约定，便于后续维护与排查。*
