# REVIEW.md — PR 评审清单（agent 与人共用）

> 对应 SDLC Stage 5 · Deploy。Claude 既评审进来的 PR 也回应自己 PR 的意见；**发现项本身不批准也不否决 PR**——分支保护下只有人工 approve 生效，writer-agent 没有自批路径。

## 检查遍（passes）

1. **Bugs & 逻辑错误**
   - 对照本 PR 关联的 `specs/<feature>.md` / `plans/*-plan.md`；没有工件的 PR 至少自查：空值、竞态（async IPC 往返）、错误吞掉不报。
2. **Security**
   - 新增 IPC handler：主进程/渲染进程两侧都接了吗？入参有没有做类型与范围校验？preload 暴露面最小化？
   - `contextIsolation` / `nodeIntegration` / `webSecurity` 有没有被本 PR 放松？
   - 子进程调用（engines/sandbox/ttyd）参数是否可被会话内容注入？
   - 凭证不进 diff（guard-paths 已在编辑期拦截，此处复核漏网）。
   - 外链/协议打开走白名单（shell.openExternal）。
3. **Compliance 合规对照**
   - 行为与 `specs/<feature-slug>.md` 的"本期做/不做"逐条吻合；差异要么改码要么改规格并在 PR 说明。
   - 与已否决备选方案（spec 里记录）悄悄复活了没有？
4. **架构原则**（出处 docs/agent-development-guide.md）
   - 依赖方向单向；新逻辑落点符合 crates 职责表；Rust 面只属于 windows-sandbox-helper。
   - UI 文案全部走 react-i18next locales 键。
   - 平台差异（Win/macOS/Linux）在代码注释或 PR 描述中有矩阵说明。
5. **Tests & Evidence**
   - 测试与源码同目录（src/**/*.test.ts）；bug 修复须可见"失败测试先于修复"的提交序列。
   - PR 描述附 `npm run test:electron` 最近一次结论（数字即可）；husky pre-commit 红灯未清时必须注明原因归属（在途 vs 主干）。

## Important vs Nit

- **Important**：会错、会漏数据、有安全面、违反上面任一 pass —— 必须处理才能 approve。
- **Nit**：风格/命名/更优雅写法 —— **全 Review 最多提 5 条**，超出部分自己忍住；prettier/lint-staged 已覆盖的格式问题不属于 Nit，属于噪音，直接跳过。

## 跳过项

- `dist/`、buildtrees、vcpkg 产物等生成物；CI 已经强制的事项（重复 Human 念经）；纯 emoji/措辞偏好。

## 发现项处置

- 第二次抓到同类错误 → 顺手把纠正写入 AGENTS.md（"错两次进规则"纪律）。
- 发现让 AGENTS.md/docs 指南过时的变更 → 在评审里明确指出需同步。
