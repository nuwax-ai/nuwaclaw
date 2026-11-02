# Review：Node 24 与 Git 仅 Windows 集成

## 变更范围

1. **prepare-git.js** — 对齐 LobsterAI 方案（7z + 7zip-bin），并明确「仅 Windows 客户端」
2. **prepare-node.js** — 非 Windows 直接跳过，仅 Windows 下载/解压 Node 24
3. **package.json** — node/git 的 extraResources 仅挂在 `win` 下，Mac/Linux 不再打包
4. **dependencies.ts** — `getBundledNodeBinDir` 按 prepare-node 实际输出路径查找（见下）

---

## 1. prepare-git.js ✅

| 项 | 结论 |
|----|------|
| **仅 Windows** | 非 Windows 默认跳过；`--required` / `NUWAX_SETUP_GIT_FORCE=1` 可强制（如 macOS 上为 Windows 打包） |
| **7z + 7zip-bin** | 与 LobsterAI 一致，解压稳定、可跨平台 |
| **环境变量** | `NUWAX_PORTABLE_GIT_ARCHIVE`、`NUWAX_GIT_URL` 文档完整 |
| **bash 查找** | `findPortableGitBash` 检查 bin、usr/bin、mingw64/bin、mingw64/usr/bin，覆盖常见解压结构 |
| **导出** | `ensurePortableGit`、`findPortableGitBash`、`GIT_VERSION`、`GIT_ROOT` 可供主进程/CLI 复用 |

**建议**：CI 若 GitHub 下载不稳，可在 workflow 中设置 `NUWAX_PORTABLE_GIT_ARCHIVE` 或使用缓存步骤。

---

## 2. prepare-node.js ✅

| 项 | 结论 |
|----|------|
| **仅 Windows** | `main()` 开头 `process.platform !== 'win32'` 则直接 return |
| **输出路径** | `resources/node/win32-x64` 或 `resources/node/win32-arm64`，与 dependencies 约定一致 |
| **NODE_ASSET_SUFFIX** | 仍含 darwin/linux 键，但不会执行到（已提前 return），可后续删减以去混淆（非必须） |

**注意**：`getBundledNodeBinDir()` 已改为按 `node/win32-x64`（或 win32-arm64）查找，与 prepare-node 输出一致。

---

## 3. package.json 打包 ✅

| 项 | 结论 |
|----|------|
| **全局 extraResources** | 已移除 `resources/node`、`resources/git`，Mac/Linux 包不再包含 |
| **win.extraResources** | 仅 Windows 安装包包含 node、git 两项 |
| **electron-builder** | 平台专属 `win.extraResources` 会与顶层 extraResources 合并，行为符合预期 |

---

## 4. dependencies.ts ✅（已修）

| 项 | 结论 |
|----|------|
| **getBundledNodeBinDir** | **已修复**：由原来的 `node/bin` 改为 `node/win32-x64` 或 `node/win32-arm64`（与 prepare-node 输出一致） |
| **getBundledGitBinDir / getBundledGitBashPath** | 仅 Windows 返回非空；查找路径与 prepare-git 的 bin/usr/bin 一致 |
| **getAppEnv PATH** | 继续使用 `bundledNodeBinDir`、`bundledGitBinDir`，逻辑正确 |

此前存在 **路径不一致**：prepare-node 写入 `resources/node/win32-x64`，而运行时查找 `resources/node/bin`，会导致 Windows 上内置 Node 从未被用上。现已统一为按平台键查找。

---

## 5. 可选后续优化

1. **prepare-node.js**：可删除 `NODE_ASSET_SUFFIX` 中的 darwin/linux 键，仅保留 win32-x64、win32-arm64，减少误解。
2. **getBundledGitBinDir**：若 PortableGit 某版本解压后只有 `mingw64/bin`，可增加对 `resources/git/mingw64/bin` 的回退（与 `findPortableGitBash` 一致）。
3. **文档**：`electron-spawn-no-window-solution.md`、`CHANGELOG.md` 中若仍写 `resources/node/bin`，可改为 `resources/node/win32-x64` 等以与实现一致。

---

## 6. 测试建议

- **Windows**：在干净 clone 下执行 `npm run prepare:git`、`npm run prepare:node`，确认 `resources/git`、`resources/node/win32-x64` 生成；再打 Windows 包，运行时确认 PATH 中能用到内置 node/npm 与 git-bash。
- **macOS/Linux**：执行 `prepare:all` 或打 Mac/Linux 包，确认 prepare-node/prepare-git 跳过且安装包内无 node、git 目录。
- **CI**：Windows 构建若遇下载失败，可设 `NUWAX_PORTABLE_GIT_ARCHIVE` 或 `NUWAX_GIT_URL`，或为 Git 归档加缓存。

---

*Review 完成；getBundledNodeBinDir 路径已与 prepare-node 对齐并落地修改。*
