# 规格：local-directory-file-preview

- 对应 intent：`plans/20260902-local-directory-file-preview-intent.md`
- 状态：技术评审通过（用户已批准实施计划，2026-09-02）

## 需求基线

继承 intent；多个目录表示一个文件树在多个根之间切换，不合并成一棵树。本地目录具备完整用户侧读写能力，但不成为 Agent 可写根。

## 方案设计

### 进程与边界

- 主进程维护目录授权，持久化键按规范化服务 origin + conversationId 分区。
- webview preload 暴露 `NuwaClawBridge.localFiles`；guest 只能提交 grantId 和相对路径。
- 主进程注册 `nuwaclaw-file://` 协议流式读取文件，支持 HEAD/Range/MIME；协议处理和每个 IPC 操作均重新执行根边界校验。
- nuwax 用数据源抽象区分项目 HTTP 文件源和本地桥文件源；浏览器无桥时只构造项目源。

### 数据与状态

```ts
interface LocalDirectoryGrant {
  id: string;
  displayName: string;
  displayPath: string;
  available: boolean;
}

interface LocalFileEntry {
  grantId: string;
  relativePath: string;
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  modifiedAt?: number;
  version?: string;
  isLink?: boolean;
  previewUrl?: string;
}
```

- 主进程私有记录额外保存 canonicalPath、origin、conversationId、createdAt、lastUsedAt；绝对路径不作为文件 API 入参。
- 当前 source、当前 relativePath 和 roots 随会话保存；不可用目录保留记录并提供移除/重选。
- 本地保存携带读取时 version；不匹配返回冲突。写入使用同目录临时文件后 rename。

### 目录和文件行为

- 根菜单包含项目目录、所有授权目录、打开本地目录和移除入口。
- 普通导航只调用 `list(relativePath)`；显式搜索允许限时、限量递归。
- 本地删除调用系统废纸篓；重命名/新建遇同名不覆盖。
- 隐藏项默认不枚举（`.gitignore` 例外），但已知相对路径可在根边界内解析预览。
- 符号链接显示为不可预览项；禁止跟随到授权根外。

### 引擎与平台矩阵

| 行为点 | claude-code | nuwaxcode | Win | macOS | Linux |
|---|---|---|---|---|---|
| 本地文件 UI | 不注入 Agent | 不注入 Agent | 盘符/UNC 规范化 | TCC/外接盘失效提示 | 挂载点失效提示 |
| 删除 | 不相关 | 不相关 | 系统回收站 | 废纸篓 | freedesktop trash |

## 异常与失败场景

- 目录不存在/权限失效：标记 unavailable，不自动删除授权。
- 请求竞态：切根或切路径后旧请求不得回写。
- 外部修改冲突：阻止静默覆盖，允许重新加载或显式强制保存。
- 协议 URL 越界、重复编码、符号链接逃逸：拒绝并记录脱敏安全日志。
- 浏览器无桥：隐藏本地入口并保持项目文件树原行为。

## 测试计划

- 主进程：授权持久化/去重/移除、路径校验、Range、搜索上限、原子保存、trash。
- nuwax：多根切换、面包屑、逐级加载、同名隔离、竞态、完整文件操作和浏览器降级。
- file-server：`relativePath + recursive=false`、静态路径边界、loopback/lanproxy 健康。
- 全量：Electron tests、conversation tests、production build、dist、真实 Electron 多目录走查。

## i18n 与文案

新增本地目录、打开目录、目录不可用、移除目录、文件已在外部修改、重新加载、覆盖保存等四语言键；不得硬编码用户可见文案。

## 已否决的备选方案

- 直接把绝对路径放进 `customTargetDir`：会把本地路径暴露给页面/网络并扩大任意目录读取风险。
- 把多个目录合并成一棵树：与确认的切换交互不符，且同名和刷新状态更复杂。
- 把目录加入 Agent 沙箱：超出本期用户侧文件管理范围。


## v2 数据面切换（2026-09-02 用户拍板，取代上文桥方案）

**问题**：v1 桥方案把「打开本地目录」绑死 Electron IPC，nuwax 在浏览器/非 nuwaclaw 宿主打开时能力缺失。

**决策**：
- 数据面全部改走 file-server HTTP（`customTargetDir` = 会话所在电脑上的目录绝对路径），客户端与浏览器行为一致；桥仅保留 `localFiles:pickDirectory` 原生选目录，`nuwaclaw-file://` 协议与主进程 localFiles 服务/持久化整体移除。
- 浏览器无选择器 → 手输路径 + 根列表即最近记录（localStorage 按会话存根）。
- 保存接受覆盖语义（file-server modify 无条件覆盖），v1 的版本冲突检测取消；rename/create 同名保护由前端用当前目录列表预检。
- **服务端零改动**（用户确认）：所需能力 origin/main 16c0023（nuwaclaw 打包版本）已全部具备；原计划的 safeStaticPath/监听 env/rename 服务端保护三项加固撤销，残余风险为既有现状（静态路由无出根检查、0.0.0.0 监听、无鉴权——边界靠 loopback/lanproxy 与网关）。

**随之而来的行为变化**：本地删除经 files-update `rm -rf` 不可恢复（UI 二次确认并明示）；单层列表无 size/mtime（大小列兜底）；本地绝对路径以 query 参数经过云端网关（与工作区文件内容同级暴露）。

**nuwa-cli 同步面**：nuwa-cli（npm 钉 1.4.2）在 1.4.3 发 npm 前无此能力且工作区树退化为全量扁平列表；上游发版后 `sync:core-deps` 钉版即消（已记入其 skills/nuwax-platform-access/references/gateway-local.md）。

**联调待确认**：Java 网关对 `customTargetDir`/`relativePath`/`recursive` 及 `static/search-files` 的透传（v1 intent 开放问题延续）。

**实施状态注记（2026-09-02 下午）**：nuwaclaw 父仓改动完成（桥收敛 + electron 全量测试 1273 用例通过）；nuwax 前端改动完成后因子模块被用户切换到 `feat-dong.0930` 分支而整体存于子模块 `stash@{0}`（含 v1 codex 实现与 v2 重写），三个新增未跟踪文件（DirectorySourceNavigator / useLocalDirectoryFiles / useWorkspaceDirectoryFiles）仍在工作树；恢复方式：切回 `feat/conversation-renderer-v2` 后 `git stash pop`。
