# 日志设计说明

主进程日志目录：`~/.nuwaclaw/logs/`（开发与正式共用该路径，行为由是否打包区分）。

## 问题与目标

- **问题**：所有日志只写 `main.log` 会导致文件无限膨胀。
- **目标**：单文件有大小上限、按时间轮转、过期自动清理，且开发与正式环境策略不同。

## 实现（logConfig.ts）

| 能力 | 说明 |
|------|------|
| **按大小轮转** | 单文件超过 `maxSize` 时，将当前 `main.log` 归档为 `main.YYYY-MM-DD-HHmmss.log`，再继续写新的 `main.log`。 |
| **按时间清理（TTL）** | 每次启动时扫描 `logs/`，删除超过有效期的归档文件（`main`/`renderer` 的 `.old.log`、`.YYYY-MM-DD-*.log`），不删当前 `main.log`、`renderer.log`。 |
| **开发 vs 正式** | 开发：文件级别 `debug`、maxSize 5MB、保留 30 天；正式：文件级别 `info`、maxSize 2MB、保留 7 天。控制台始终为 `debug`。 |

## latest.log：统一入口（多平台兼容）

用户与客户端只需关注 **latest.log**，其始终指向当前正在写入的主进程日志（即 main.log 的“当前版本”）。

| 平台 | 实现方式 | 说明 |
|------|----------|------|
| **macOS / Linux** | 符号链接 `latest.log` → `main.log`（相对路径） | 轮转后新生成的 `main.log` 自动被指向，无需更新链接。 |
| **Windows** | 硬链接 `latest.log`（与 `main.log` 同 inode） | 不依赖管理员或开发者模式；轮转后会在下一拍更新 `latest.log` 指向新的 `main.log`。 |

- 客户端内「日志列表」展示（`log:list` IPC）优先读取 `latest.log`，若不存在则回退到 `main.log`。
- 客户端内「打开日志目录」：**macOS** 使用 Finder 打开目录并选中 `latest.log`（或 `main.log`）；**Windows** 使用资源管理器打开目录并选中该文件；**Linux** 仅打开日志目录。用户也可在终端中 `tail -f latest.log` 查看实时主进程日志。

## 目录与文件

- **latest.log**：始终指向当前主进程日志的入口（见上表；不参与 TTL 清理）。
- **main.log** / **renderer.log**：当前主进程/渲染进程日志（electron-log 文件 transport）。
- **main.YYYY-MM-DD-HHmmss.log**、**renderer.YYYY-MM-DD-HHmmss.log**：轮转后的历史日志，超过 TTL 会被自动删除。
- **app.json**：渲染进程 LogViewer 用的应用内日志（logService），最多保留 100 条，与上述 TTL 独立。
- **mcp/**、**project_logs/**、**computer_logs/**：由各服务自行写入，本方案不改变其逻辑。

## 配置入口

主进程入口 `main.ts` 在启动时调用 `initLogging()`，无需额外配置；环境通过 `app.isPackaged` 与 `NODE_ENV` 自动判断。
