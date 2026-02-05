# agent-tauri-client 系统托盘支持实现计划

## 目标与范围
- 为 `crates/agent-tauri-client` 增加系统托盘（Tray）能力。
- 支持常见托盘交互：打开主窗口、最小化到托盘、退出应用、状态展示与快捷操作。
- 覆盖 Windows / macOS / Linux 的主流行为差异，并给出处理策略。

## 需求拆解
- 托盘图标常驻（应用启动后自动创建）。
- 托盘菜单（右键）：
  - 打开/显示主窗口
  - 最小化到托盘
  - 启动/停止服务（可选：展示服务状态）
  - 开机自启动（当前已有 autolaunch，做开关 UI）
  - 退出应用
- 左键单击行为（Windows/Linux 通常显示主窗口，macOS 常显示菜单）。
- 关闭窗口行为：
  - 关闭按钮触发隐藏（不是退出）
  - 真正退出通过托盘菜单 “退出”
- 多窗口或单实例策略保持一致（目前为单主窗口）。

## 设计方案
- Rust 侧在 `crates/agent-tauri-client/src-tauri/src/lib.rs` 中注入托盘创建与事件处理。
- 通过 Tauri 2 的 Tray API 创建托盘图标与菜单。
- 使用全局事件监听：
  - `on_tray_icon_event` 处理左键/右键/双击
  - `on_menu_event` 处理菜单项
- 托盘菜单与应用状态联动：
  - 读取服务状态（已有 `services_status_all`）
  - 动态更新菜单文本/勾选状态（如 “已启动/未启动”）
- 窗口关闭行为：
  - 监听 `tauri::WindowEvent::CloseRequested`，调用 `hide()` 并阻止默认关闭。

## 关键实现步骤
1. 接入托盘 API
   - 引入 tray 相关类型（如 `tauri::tray::{TrayIconBuilder, TrayIconEvent, TrayIcon}`）。
   - 创建托盘图标，绑定菜单与事件回调。
2. 菜单定义
   - 菜单项 ID 规划：
     - `tray_show`
     - `tray_hide`
     - `tray_services_start`
     - `tray_services_stop`
     - `tray_autolaunch_toggle`
     - `tray_quit`
   - 封装菜单构建函数，便于动态刷新。
3. 事件处理
   - Tray Icon 事件：
     - 左键单击显示主窗口
     - 右键显示菜单（默认行为）
   - Menu 事件：根据 ID 执行对应动作。
4. 窗口显示逻辑
   - `show_main_window(app)`：
     - 若窗口已存在则 `show()` + `set_focus()`
     - 若隐藏则 `show()`
   - `hide_main_window(app)`：
     - `hide()`
5. 关闭按钮改为隐藏
   - 在窗口事件监听中拦截关闭请求：
     - `event.prevent_close()`
     - `window.hide()`
6. 与服务状态联动（可选迭代）
   - 托盘菜单动态显示：
     - “服务状态：已运行/未运行”
     - 支持一键启动/停止
   - 使用已有 `ServiceManagerState` 查询状态。
7. 与开机自启动联动
   - 菜单增加 “开机自启动” 复选项
   - 调用 `autolaunch_get` / `autolaunch_set` 更新状态

## 平台差异处理
- macOS
  - 托盘图标在状态栏（Menu Bar）
  - 左键点击默认弹出菜单
  - “关闭按钮隐藏”更符合 macOS 常见行为
- Windows/Linux
  - 左键点击通常显示主窗口
  - 需要显式实现“最小化到托盘”逻辑

## 风险与注意点
- Tauri 2 Tray API 与 1.x 不兼容，需确认当前版本 API 使用方式。
- 关闭窗口拦截后需保证真正退出仍可用（托盘菜单 “退出” 调用 `app.exit(0)`）。
- 动态菜单刷新可能需要重新构建菜单或更新菜单项状态。

## 测试清单
- 启动后托盘图标是否出现。
- 左键/右键交互是否符合预期（不同平台）。
- 关闭主窗口是否隐藏而非退出。
- 托盘菜单 “退出” 是否真正结束进程。
- 服务启动/停止菜单是否可用。
- 开机自启动开关是否生效。

## 交付物
- Rust 侧托盘逻辑实现（`crates/agent-tauri-client/src-tauri/src/lib.rs`）。
- 若需要前端提示，可添加简要文案说明（可选）。
- 本计划文档：`docs/agent-tauri-client-tray-plan.md`。
