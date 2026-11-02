# agent-electron-client 重构执行计划（v3）

> 适用范围：`/Users/apple/workspace/nuwax-agent/crates/agent-electron-client`
>
> 基线日期：2026-03-03

## 1. 重构目标

本次重构以“目录与职责对齐”为核心，不改业务行为，优先解决以下问题：

1. `main / preload / renderer` 边界不够清晰，`preload.ts` 仍位于 `src/main/`
2. `src/main/` 与 `src/renderer/` 顶层存在平铺文件过多的问题
3. `docs/` 与 `scripts/` 平铺，维护和检索成本高
4. 部分设置组件疑似死代码，需要在重构窗口期完成判定

同时，本轮重构明确以“开发/维护友好基座”为目标，要求后续新增需求可在不破坏边界的前提下快速接入。

## 2. 现状核对（与仓库一致）

已核对当前代码树，以下结论已确认：

1. `src/main/preload.ts` 仍在 `main` 目录
2. `src/main/startup.ts`、`logConfig.ts`、`serviceManager.ts`、`trayManager.ts`、`autoLaunchManager.ts` 均在顶层
3. `src/renderer/components/` 和 `src/renderer/services/` 仍为平铺结构
4. `docs/` 与 `scripts/` 仍为平铺结构
5. `src/**/*.js` 编译产物目前未发现，旧计划中的“清理 src 下 js 产物”从必做项降为巡检项
6. `AgentSettings`、`AgentRunnerSettings`、`LanproxySettings`、`SkillsSync`、`IMSettings`、`TaskSettings` 当前无引用；`MCPSettings` 被 `SettingsPage` 使用

## 3. 目标结构

### 3.1 src 重构目标

```text
src/
  main/
    main.ts
    db.ts
    processManager.ts
    bootstrap/
      startup.ts
      logConfig.ts
      startupPorts.ts
    window/
      serviceManager.ts
      trayManager.ts
      autoLaunchManager.ts
    ipc/
    services/
  preload/
    index.ts
  renderer/
    components/
      pages/
      settings/
      setup/
      modals/
      dev/
    services/
      core/
      agents/
      integrations/
      utils/
  shared/
```

### 3.2 docs / scripts 重构目标

```text
docs/
  architecture/
  release/
  operations/
  reviews/

scripts/
  prepare/
  build/
  tools/
```

## 4. 迁移策略（新增）

为降低大规模改路径风险，采用“兼容层迁移”：

1. 文件迁移到新目录后，在旧路径保留一个短期桥接文件（`export * from 'new-path'`）
2. 全量业务 import 更新完成后，再统一删除桥接文件
3. 每个 Phase 完成必须通过 `npm run build`，否则不进入下一阶段
4. 每个 Phase 一个提交，提交信息带 `refactor(phase-x): ...`

## 5. 执行阶段（按提交拆分）

### Phase 0：基线保护（先做）

1. 记录当前可用命令结果：`npm run build`、`npm run test:run`
2. 新增重构分支：`feature/electron-client-0.6`
3. 将本文件作为总入口，后续每个阶段回填“已完成/阻塞/风险”
4. 基线结果（2026-03-03）：
   - `npm run build`：通过
   - `npm run test:run`：通过（147 tests）
   - 已知告警：vite chunk size > 500k、测试阶段 `electron-log` 写系统日志路径出现 EPERM（不影响测试通过）

### Phase 1：main 顶层归类（中风险，优先）

1. 新建 `src/main/bootstrap`、`src/main/window`
2. 迁移并更新 import（先迁移再留桥接）：
   - `startup.ts`、`logConfig.ts`、`startupPorts.ts` -> `bootstrap/`
   - `serviceManager.ts`、`trayManager.ts`、`autoLaunchManager.ts` -> `window/`
3. 回归验证：
   - `npm run build:main`
   - 主进程启动冒烟（`npm run dev:electron`）
4. 完成记录（2026-03-03）：
   - 已迁移到新目录：
     - `src/main/bootstrap/{startup.ts,logConfig.ts}`
     - `src/main/window/{serviceManager.ts,trayManager.ts,autoLaunchManager.ts}`
   - 已更新直接引用到新路径：`main.ts`、`ipc/appHandlers.ts`
   - 已添加旧路径桥接文件（短期兼容）：
     - `src/main/startup.ts`
     - `src/main/logConfig.ts`
     - `src/main/serviceManager.ts`
     - `src/main/trayManager.ts`
     - `src/main/autoLaunchManager.ts`
   - 验证结果：`npm run build:main` 通过，`npm run build` 通过

### Phase 2：preload 提升为一级目录（中高风险）

1. 移动 `src/main/preload.ts` -> `src/preload/index.ts`
2. 更新 `main.ts` 的 preload 产物路径
3. 更新配置：
   - `tsconfig.main.json` include `src/preload/**/*`
   - `tsconfig.json` 增加 `@preload/*`
   - `vite.config.ts` / `vitest.config.ts` 增加 `@preload`
4. 回归验证：
   - `npm run build`
   - `npm run dev` 并确认 IPC API 可用
5. 完成记录（2026-03-03）：
   - 已迁移：`src/main/preload.ts` -> `src/preload/index.ts`
   - 已更新主进程路径：`main.ts` 使用 `../preload/index.js`
   - 已更新配置：`tsconfig.main.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`
   - 已添加兼容桥接：`src/main/preload.ts`（转发到 `src/preload/index.ts`）
   - 验证结果：`npm run build` 通过，`npm run test:run` 通过

### Phase 3：renderer/services 分组（中风险）

1. 新建 `core/agents/integrations/utils`
2. 迁移 service 文件并维护 `services/index.ts` barrel（旧路径保留桥接）
3. 批量修复组件中的服务 import
4. 回归验证：
   - `npm run build`
   - 关键功能冒烟：setup、auth、mcp、agent runner、lanproxy
5. 完成记录（2026-03-03）：
   - 已迁移到新目录：
     - `core/{api,setup,auth,ai}.ts`
     - `agents/{agentRunner,sandbox,permissions}.ts`
     - `integrations/{fileServer,lanproxy,skills,im,scheduler}.ts`
     - `utils/logService.ts`
   - 已更新调用方路径：`App.tsx` 与相关组件均改为新分组路径
   - 已更新 `services/index.ts` barrel 到新结构
   - 已添加旧路径桥接文件（短期兼容）
   - 验证结果：`npm run build` 通过，`npm run test:run` 通过

### Phase 4：renderer/components 分组（中风险）

1. 迁移 page 组件到 `components/pages`
2. 迁移 settings 组件到 `components/settings`
3. 迁移 setup 与 modal 组件到对应目录
4. 批量修复 import 路径，重点关注：
   - `App.tsx`
   - `SettingsPage.tsx`
   - `ClientPage.tsx` 样式路径
5. 回归验证：
   - `npm run build:renderer`
   - `npm run test:run`
6. 完成记录（2026-03-03）：
   - 已迁移到新目录：
     - `pages/{ClientPage,SettingsPage,DependenciesPage,AboutPage,PermissionsPage,LogViewer}.tsx`
     - `settings/{MCPSettings,AgentSettings,AgentRunnerSettings,LanproxySettings,SkillsSync,IMSettings,TaskSettings}.tsx`
     - `setup/{SetupWizard,SetupDependencies}.tsx`
     - `modals/PermissionModal.tsx`
   - 已更新调用方路径：`App.tsx` 与相关组件的相对路径已全部修正
   - 已添加旧路径桥接文件（短期兼容）
   - 验证结果：`npm run build` 通过，`npm run test:run` 通过

### Phase 5：文档与脚本目录重排（低风险，后置）

1. 按主题迁移 `docs/*` 到 `architecture/release/operations/reviews`
2. 按用途迁移 `scripts/*` 到 `prepare/build/tools`
3. 更新 `package.json` scripts 路径与 electron-builder 的 `afterSign`
4. 回归验证：
   - `npm run check-ports`
   - `npm run prepare:uv`
   - `npm run build`
5. 完成记录（2026-03-03）：
   - 已迁移 docs：
     - `docs/{architecture,release,operations,reviews}` 分组已落地
     - 架构文档文件名已去掉 `ARCHITECTURE-` 前缀
   - 已迁移 scripts：
     - `scripts/{prepare,build,tools}` 分组已落地
   - 已更新路径引用：
     - `package.json` scripts
     - `package.json` -> `build.afterSign`
     - 相关 docs 与注释中的脚本路径
   - 验证结果：
     - `npm run check-ports` 通过
     - `npm run build` 通过
     - `npm run prepare:uv` 受当前环境网络限制失败（`ENOTFOUND github.com`），不属于代码回归

### Phase 6：死代码判定与清理（建议）

1. 对无引用组件进行逐项判定（保留/删除/后续接入）
2. 若删除，需同步更新文档与 release note
3. 回归验证：`npm run build && npm run test:run`
4. 完成记录（2026-03-03）：
   - 判定结果：
     - `MCPSettings` 仍被 `SettingsPage` 使用
     - `AgentSettings`、`AgentRunnerSettings`、`LanproxySettings`、`SkillsSync`、`IMSettings`、`TaskSettings` 目前无业务引用
   - 处理决策：
     - 本轮不做删除，仅完成目录重构和桥接兼容；死代码清理单独作为后续行为变更任务
   - 验证结果：`npm run build` 通过，`npm run test:run` 通过

## 6. 风险与约束

1. `preload` 路径改动会直接影响 Electron 启动，必须在单独阶段完成
2. `services/index.ts` barrel 重排容易引入循环依赖，需要逐步迁移并即时编译
3. docs/scripts 重命名后可能影响 CI 或外部脚本，需全文检索 `docs/`、`scripts/` 引用
4. 本次不调整业务协议、不变更 IPC contract、不触发数据库 schema 变更

## 7. 验收标准

满足以下条件才可视为本轮重构完成：

1. `npm run build` 成功
2. `npm run test:run` 成功
3. `npm run dev` 可正常进入主界面，setup 和 settings 页面可访问
4. `dist/main/main.js` 启动后 preload 正常加载，`window.electronAPI` 可用
5. 文档路径、脚本路径引用无失效（`rg` 检查无旧路径残留）
6. 新增功能可按分层目录直接落位（`main/preload/renderer/services/components`），无需再进行目录级重排

## 8. 进度记录

- [x] Phase 0 基线保护
- [x] Phase 1 main 顶层归类
- [x] Phase 2 preload 提升
- [x] Phase 3 renderer/services 分组
- [x] Phase 4 renderer/components 分组
- [x] Phase 5 文档与脚本目录重排
- [x] Phase 6 死代码判定与清理

## 9. 本次版本说明

相较 v2，本版新增了“低风险迁移机制”：

1. 增加兼容层策略（迁移后短期桥接，最后统一删）
2. 阶段顺序调整为先核心边界（main/preload/services），后外围目录（docs/scripts）
3. 强化阶段门禁（每阶段必须可构建）

## 10. 基座约束（后续开发准入）

为保证后续新增需求和维护稳定性，后续提交应遵循以下约束：

1. 边界约束：
   - renderer 不直接依赖 main 代码；进程间只通过 IPC（`src/main/ipc` + `window.electronAPI`）
   - preload 只做安全桥接，不承载业务逻辑
2. 分层约束：
   - renderer 新 service 必须落到 `core/agents/integrations/utils` 之一
   - renderer 新页面组件落 `components/pages`，弹窗落 `components/modals`
3. 兼容桥接约束：
   - 旧路径桥接文件仅短期存在，发布 `0.6.x` 后统一清理
   - 新代码禁止继续引用桥接文件
4. 测试与门禁：
   - 变更必须通过 `npm run build`、`npm run test:run`
   - 影响 IPC、启动路径、权限模型的改动需补最小冒烟验证
5. 文档同步：
   - 新增模块时同步更新 `docs/architecture/INDEX.md`（或对应主题文档）

## 11. 基座后续任务（建议）

建议在本轮重构后追加三项治理任务，进一步提升长期可维护性：

1. 增加 lint/import 规则，禁止跨层引用与旧桥接路径引用
2. 为关键 IPC handler 增加 contract tests（请求/响应 schema）
3. 清理无引用 settings 组件（单独评审，避免与结构重构混改）

### 11.1 已落地（2026-03-03）

1. 已新增 `scripts/tools/check-import-boundaries.js`
2. 已新增 `npm run check:boundaries`
3. 已新增 `tests/scripts/check-import-boundaries.test.ts`，覆盖：
   - 合法 main/renderer 分层通过
   - renderer 直接引用 main 失败
   - bridge 文件引用失败
4. 规则覆盖：
   - 禁止引用 bridge 文件（`src/main/*` 与 `src/renderer/*` 顶层桥接）
   - 禁止 renderer 直接引用 main/preload
   - 禁止 main 直接引用 renderer
