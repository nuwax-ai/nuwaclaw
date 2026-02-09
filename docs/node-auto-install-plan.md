# Node 自动安装方案（Tauri Client 初始化体验优化）

## 背景与问题

当前用户初始化时若未安装 Node 或版本不满足要求，需要用户手动安装，体验较差。目标是：

- 当检测到 Node 缺失或版本低于 `>=22` 时，客户端自动尝试安装。
- 安装包随客户端打包（按平台内置对应 Node 安装器/二进制）。
- 自动安装失败则停止依赖安装，并提示用户手动安装。
- 提供“刷新/确认”入口，在检测到 `node>=22` 后自动进入后续依赖安装流程。

## 目标与范围

- 目标：把“Node 依赖满足”从用户主动操作改为自动修复，显著降低新手门槛。
- 范围：`tauri-client`（仓库内 `crates/agent-tauri-client`）初始化流程、依赖管理模块、前端引导与回退提示、打包资产。
- 不在范围：更换现有依赖管理框架、改变其它依赖策略（例如 Python/uv 等）。

## 需求与约束

- Node 最低版本：`>=22`。
- 各平台需内置对应 Node 安装包/二进制：
  - macOS：`.pkg` 或便携 Node 目录包。
  - Windows：`.msi` 或静默安装包。
  - Linux：`.tar.xz` / `.tar.gz` 便携包或 distro-neutral 的二进制包。
- 自动安装失败时：
  - 停止后续依赖安装流程。
  - 明确提示用户手动安装与最低版本要求。
  - 提供“刷新/确认”入口重新检测。
- 成功检测 `node>=22` 后：自动进入后续依赖安装流程。

## 用户体验（高层流程）

1. 初始化进入依赖检测页面。
2. 检测 Node：
   - 已安装且版本满足：进入后续依赖安装。
   - 未安装或版本不满足：展示“正在自动安装 Node”。
3. 自动安装成功：刷新检测 → 进入后续依赖安装。
4. 自动安装失败：提示手动安装 → 提供“刷新/确认”按钮。
5. 用户手动安装后点击“刷新/确认”：
   - 满足 `node>=22` → 进入后续流程。
   - 仍不满足 → 继续提示。

## 依赖检测与安装时序

1. `dependency_check` 触发 Node 检测。
2. Node 不满足时：调用 `node_install_auto`。
3. `node_install_auto` 成功后：再次调用 `node_check`。
4. `node_check` 满足后：触发后续 `dependency_install`。

## 资产打包设计

### 目录结构建议（示例）

- `crates/agent-tauri-client/src-tauri/binaries/node/`（Tauri Client）
  - `macos/arm64/node.tar.xz`
  - `macos/x64/node.tar.xz`
  - `windows/x64/node.msi`
  - `linux/x64/node.tar.xz`
  - `linux/arm64/node.tar.xz`

> 说明：可根据现有 `bundle.externalBin` 管线调整存放位置，但需保证安装器可在运行时解包和访问。

### 版本策略

- 统一内置一个稳定 LTS 版本，且满足 `>=22`。
- 版本升级随客户端版本发布更新。

## 后端（Tauri）设计

### 新增能力概览

- Node 检测：已有（保持不变）。
- Node 自动安装：新增命令与逻辑。
- Node 状态事件：安装中/成功/失败。

### 伪代码（Rust）

```rust
// crates/agent-tauri-client/src-tauri/src/deps/node.rs (tauri-client)

pub struct NodeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool, // >=22
}

pub fn check_node() -> NodeStatus {
    // 1) 执行 `node -v`
    // 2) 解析版本
    // 3) 比较 >= 22
    // 4) 返回状态
}

pub fn auto_install_node() -> Result<(), String> {
    // 1) 根据平台与架构选择内置安装包路径
    // 2) 解包/执行安装
    // 3) 若失败返回错误字符串
    Ok(())
}

fn platform_node_installer_path() -> PathBuf {
    // macos/arm64, macos/x64, windows/x64, linux/x64, linux/arm64
}
```

### 安装策略（按平台）

- macOS
  - 优先：解压便携包到应用数据目录 `~/Library/Application Support/.../node/`。
  - 备选：执行 `.pkg`（可能触发管理员权限）。
- Windows
  - 优先：执行 `.msi` 安静安装（如支持 `/qn`，可能触发 UAC）。
  - 备选：解压便携包并修改 PATH（仅应用内）。
- Linux
  - 优先：解压便携包到应用数据目录。
  - 备选：提示用户手动安装（如 tar 解包失败）。

### 权限/提权 UX（关键补充）

- 若安装器触发系统权限弹窗（macOS Installer、Windows UAC）：  
  - UI 文案提示“需要系统权限以继续安装 Node”，并说明这是系统安装器行为。  
  - 提供“继续安装”按钮后再触发安装器，避免突然弹窗。  
- 若用户拒绝/超时：  
  - 立即进入 `NODE_INSTALL_FAILED` 状态。  
  - 文案明确“已取消授权，无法自动安装，请手动安装 Node>=22 后点击刷新确认”。  
- 若安装器返回权限不足错误：  
  - 记录错误原因并进入失败态。  
  - 引导用户选择“手动安装”路径。  
- 手动安装路径应始终可用，且失败态 UI 需明确区分“权限被拒绝”与“其它失败”。  

### Node 路径优先级

1. 应用内置路径（便携包安装位置）。
2. 系统 PATH。
3. 失败则提示手动安装。

## 前端（UI）设计

### 关键状态

- `NODE_CHECKING`
- `NODE_INSTALLING`
- `NODE_INSTALL_FAILED`
- `NODE_READY`

### UI 行为

- `NODE_INSTALLING`：展示进度/文案（可无进度条）。
- `NODE_INSTALL_FAILED`：展示手动安装指引 + “刷新/确认”。
- `NODE_READY`：自动进入后续依赖安装流程。

### 伪代码（TypeScript）

```ts
// 初始化流程控制
async function ensureNodeAndContinue() {
  setState('NODE_CHECKING');
  const status = await invoke('node_check');

  if (status.meets_requirement) {
    enterNextInstallPhase();
    return;
  }

  setState('NODE_INSTALLING');
  const result = await invoke('node_install_auto');

  if (result.ok) {
    const recheck = await invoke('node_check');
    if (recheck.meets_requirement) {
      enterNextInstallPhase();
      return;
    }
  }

  setState('NODE_INSTALL_FAILED');
}

// 失败后刷新
async function onRefreshNode() {
  const status = await invoke('node_check');
  if (status.meets_requirement) {
    enterNextInstallPhase();
  }
}
```

## 错误处理与提示文案

- 自动安装失败：
  - “检测到 Node 版本不足（需要 >=22）。自动安装失败，请手动安装后点击刷新确认。”
- 手动安装指引：
  - 提示最低版本与官网入口（URL 在 UI 中可配置）。

## 事件与日志

- 记录自动安装开始/结束、错误信息。
- 安装失败时记录原因，便于诊断。

## 风险与对策

- 静默安装权限不足：
  - 对策：优先便携包方式；失败则回退手动安装。
- 安装包体积增加：
  - 对策：按平台拆分资源，仅打包对应平台与架构。
- PATH 影响：
  - 对策：应用内优先使用本地 Node 目录，不改系统 PATH。

## 测试要点

- 初次安装无 Node：自动安装成功 -> 继续后续流程。
- Node 版本 <22：自动安装成功后覆盖使用 -> 继续。
- 自动安装失败：提示手动安装 -> 刷新成功。
- 多平台/多架构路径选择正确。

## 交付清单

- 新增 `node_install_auto` 后端命令与实现。
- 前端初始化流程调整与状态 UI。
- 打包配置增加 Node 安装包资源。
- 文档与错误提示文案。
