# 更新日志

所有值得注意的变更都会记录在此文件中。

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范，
并采用 [语义化版本控制](https://semver.org/lang/zh-CN/)。

---

## [待发布]

### 新增功能 [feat]

#### 登录认证 [auth]
- 用户名/密码登录功能
- 通过 `POST /api/sandbox/config/reg` 注册客户端
- 自动识别登录方式（用户名/邮箱/手机号）
- 动态表单验证规则
- Token/configKey 持久化存储
- savedKey 用户识别机制
- 用户会话管理
- 登录表单组件（成功状态显示）
- 退出登录功能
- 友好错误提示处理

#### 多场景配置 [config]
- 场景切换组件（本地/测试/生产环境）
- 自定义配置编辑模态框
- 设置页面完整配置管理
- 服务端配置（API 地址、超时时间）
- 本地服务配置（Agent、VNC、文件服务、WebSocket）
- 添加/编辑/删除/切换配置
- 导出/导入配置

#### 依赖管理 [deps]
- 通过 Rust 后端检测系统依赖
- 支持的依赖项：
  - 核心：Node.js、Git、npm
  - 运行时：Python、Docker、Rust
  - 命令行工具：cURL、jq、Pandoc、FFmpeg
  - npm 包：OpenCode、Claude Code
- 全局 npm/pnpm 包安装和卸载
- 依赖状态跟踪（已安装/未安装/需更新）
- 一键安装所有缺失依赖
- 依赖统计信息

#### 用户界面 [ui]
- 客户端页面顶部场景切换器
- 设置页面重构（配置管理）
- 依赖页面真实数据服务
- 登录表单组件
- npm 包标签标记
- 危险操作二次确认
- Tauri + React + Ant Design 客户端 UI
- 连接信息空状态展示

#### 日志功能 [log]
- 完整日志查看器组件（实时订阅、搜索过滤）
- 日志工具栏（导出 JSON/CSV/TXT、清空）
- 日志统计展示（按级别分类统计）
- 单条日志展示（时间、级别、来源、详情）
- 日志服务（logService.ts, 21 tests）
- 支持实时日志流订阅
- 支持关键词搜索和级别过滤
- 支持一键导出多种格式

#### 权限管理 [perm]
- macOS 权限请求类型和 UI 设计
- 系统权限监控
  - 相机、麦克风、屏幕录制
  - 辅助功能、完全磁盘访问权限
  - NuwaxCode/Claude Code 特定权限
- 权限状态跟踪（已授权/已拒绝/待授权）
- 打开系统偏好设置授权
- 权限状态刷新功能
- Tauri 多平台权限管理方案

#### 核心框架 [core]
- nuwax-agent-core 公共核心库
- agent-tauri-client 模块
- AgentRunnerApi Trait 接口
- 跨平台系统权限库
- HTTP 服务支持
- SQLx 编译时验证

### 变更 [change]

#### 配置管理 [config]
- 重构设置页面，使用新的配置服务
- 更新依赖页面真实数据服务

#### API 服务 [api]
- 统一 HTTP 服务器错误处理机制
- 重构 API 模块和 ViewModel 架构

#### 权限管理 [perm]
- 修复权限系统并迁移到 objc2

#### 远程桌面 [remote]
- 修复 BusinessEnvelope 和 BusinessMessageType 编译错误

#### 用户界面 [ui]
- 移除未使用的 Layout 组件导入
- 移除标题栏并修复 UI 布局
- 重构聊天组件，支持多行输入
- 增强聊天组件 UI 和消息处理

#### 日志功能 [log]
- 添加日志功能

### 修复 [fix]

#### 用户界面 [ui]
- 修复 App.tsx 中缺失的 useEffect 声明
- 修复 LogViewer.tsx 中重复导入问题
- 修复 LogStats.tsx 中 JSX 标签不匹配问题
- 修复 LogToolbar.tsx 中不存在的 FileJsonOutlined 图标
- 修复 UI 布局问题

#### 远程桌面 [remote]
- 修复 vendors/nuwax-rustdesk 中不存在的 BusinessMessage 导出
- 修复 BusinessEnvelope 编译错误

#### 构建配置 [build]
- 从 workspace 排除 data-server 模块避免 hbb_common 包冲突

### 安全 [security]

- 待实现：心跳机制用于会话保持

### 测试 [test]

- 添加 Vitest 测试框架
- 添加配置服务单元测试 (16 tests)
- 添加依赖管理单元测试 (27 tests)
- 添加认证服务单元测试 (16 tests)
- 添加日志服务单元测试 (21 tests)
- 总计 80 个测试全部通过
- 添加测试运行脚本 (pnpm test / pnpm test:coverage)

### 文档 [docs]

- 添加项目指南文档和进程记录
- 代理权限计划（6周实施）
- 更新代理权限计划
- 从参考项目中移除本地路径
- 更新权限计划（添加 GitHub 链接）
- Tauri 多平台权限管理方案
- 权限管理综合方案
- 紧密结合现有实现的新方案

### 维护 [chore]

- 更新 Cargo.lock
- 暂时排除 data-server 模块避免 hbb_common 冲突
- 更新 rustdesk-server 子模块引用
- 将 rustdesk-server 默认地址改为公网 IP
- Makefile：默认启用所有功能

---

## [0.1.0] - 2026-02-04

### 新增功能 [feat]

#### 登录认证 [auth] [dc9e212]
- 用户名/密码登录功能
- 通过 `POST /api/sandbox/config/reg` 注册客户端
- Token/configKey 持久化存储
- 用户会话管理
- 登录表单组件（成功状态显示）
- 退出登录功能

#### 多场景配置 [config] [f9954b4]
- 场景切换组件（本地/测试/生产环境）
- 自定义配置编辑模态框
- 设置页面完整配置管理
- 服务端配置（API 地址、超时时间）
- 本地服务配置（Agent、VNC、文件服务、WebSocket）
- 添加/编辑/删除/切换配置
- 导出/导入配置

#### 依赖管理 [deps]
- 通过 Rust 后端检测系统依赖 ([6bb241a])
- 支持的依赖项：
  - 核心：Node.js、Git、npm
  - 运行时：Python、Docker、Rust
  - 命令行工具：cURL、jq、Pandoc、FFmpeg
  - npm 包：OpenCode、Claude Code
- 全局 npm/pnpm 包安装和卸载 ([de8e55a])
- 依赖状态跟踪（已安装/未安装/需更新）
- 一键安装所有缺失依赖
- 依赖统计信息

#### 用户界面 [ui] [f3f211b]
- 客户端页面顶部场景切换器
- 设置页面重构（配置管理）
- 依赖页面真实数据服务
- 登录表单组件
- npm 包标签标记
- 危险操作二次确认
- Tauri + React + Ant Design 客户端 UI ([d923976])

#### 日志功能 [log] [2614890]
- 完整日志查看器组件（实时订阅、搜索过滤）
- 日志工具栏（导出 JSON/CSV/TXT、清空）
- 日志统计展示（按级别分类统计）
- 单条日志展示（时间、级别、来源、详情）
- 日志服务（logService.ts, 21 tests）
- 支持实时日志流订阅
- 支持关键词搜索和级别过滤
- 支持一键导出多种格式

#### 权限管理 [perm]
- macOS 权限请求类型和 UI 设计 ([cba1ffd])
- 系统权限监控 ([11d6560])
  - 相机、麦克风、屏幕录制
  - 辅助功能、完全磁盘访问权限
  - NuwaxCode/Claude Code 特定权限
- 权限状态跟踪（已授权/已拒绝/待授权）
- 打开系统偏好设置授权
- 权限状态刷新功能
- Tauri 多平台权限管理方案 ([ae41658])

#### 核心框架 [core]
- nuwax-agent-core 公共核心库 ([837b8c5])
- agent-tauri-client 模块 ([444a8c5])
- AgentRunnerApi Trait 接口 ([da67507])
- 跨平台系统权限库 ([11d6560])
- HTTP 服务支持 ([cedbe91])
- SQLx 编译时验证 ([dfb380a])

### 变更 [change]

#### 配置管理 [config]
- 重构设置页面，使用新的配置服务

#### API 服务 [api]
- 统一 HTTP 服务器错误处理机制 ([e8c5e3d])
- 重构 API 模块和 ViewModel 架构 ([39efc1e], [edb1fee])

#### 权限管理 [perm]
- 修复权限系统并迁移到 objc2 ([d2f048b])

#### 远程桌面 [remote]
- 修复 BusinessEnvelope 和 BusinessMessageType 编译错误 ([8887647])

#### 用户界面 [ui]
- 移除未使用的 Layout 组件导入 ([a29005c])
- 移除标题栏并修复 UI 布局 ([8ae481b])
- 重构聊天组件，支持多行输入 ([7516f16])
- 增强聊天组件 UI 和消息处理 ([3bed47a])

#### 日志功能 [log]
- 添加日志功能 ([7e3b031])

### 修复 [fix]

#### 权限管理 [perm]
- 修复权限系统并迁移到 objc2 ([d2f048b])

#### 远程桌面 [remote]
- 修复 BusinessEnvelope 编译错误 ([8887647])

#### 用户界面 [ui]
- 修复 UI 布局问题 ([8ae481b])

### 安全 [security]

- 待实现：心跳机制用于会话保持

### 测试 [test]

- 添加 Vitest 测试框架 ([3546d6b])
- 添加配置服务单元测试 (16 tests)
- 添加依赖管理单元测试 (27 tests)
- 添加认证服务单元测试 (16 tests)
- 添加日志服务单元测试 (21 tests)
- 总计 80 个测试全部通过
- 添加测试运行脚本 (pnpm test / pnpm test:coverage)

### 文档 [docs]

- 添加项目指南文档和进程记录 ([8c9919a])
- 代理权限计划（6周实施）([16fc674])
- 更新代理权限计划 ([f088b5b])
- 从参考项目中移除本地路径 ([9d45829])
- 更新权限计划（添加 GitHub 链接）([86da7c2])
- Tauri 多平台权限管理方案 ([ae41658])
- 权限管理综合方案 ([3c35227])
- 紧密结合现有实现的新方案 ([1f0e51d])

### 维护 [chore]

- 更新 Cargo.lock ([d12c494], [6e9aaec])
- 暂时排除 data-server 模块避免 hbb_common 冲突 ([d99f1a6])
- 更新 rustdesk-server 子模块引用 ([8095826])
- 将 rustdesk-server 默认地址改为公网 IP ([7591816])
- Makefile：默认启用所有功能 ([8ae481b])

---

## 历史规划版本

### v3.0 - 新实施方案 [1f0e51d]
- 紧密结合现有实现的新方案

### v2.0 - 权限管理方案 [3c35227]
- 综合权限管理设计
- macOS 权限请求类型

---

## 版本号规范

本项目采用**语义化版本控制**：

- **主版本** (X.0.0)：破坏性变更
- **次版本** (0.X.0)：新功能，向后兼容
- **修订号** (0.0.X)：Bug 修复，向后兼容

---

[待发布]: https://github.com/nuwax-ai/nuwax-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nuwax-ai/nuwax-agent/releases/tag/v0.1.0
