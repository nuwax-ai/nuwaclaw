# Nuwax Agent 客户端存储数据结构

> 本文档记录了 Nuwax Agent Tauri 客户端使用 `@tauri-apps/plugin-store` 存储的所有持久化数据。
>
> 存储文件：`nuwax_store.bin`（位于应用数据目录）

---

## 目录

- [1. 认证信息 (auth)](#1-认证信息-auth)
- [2. 配置信息 (config)](#2-配置信息-config)
- [3. 应用设置 (settings)](#3-应用设置-settings)
- [4. 初始化向导 (setup)](#4-初始化向导-setup)
- [5. 依赖管理 (deps)](#5-依赖管理-deps)
- [6. Rust 后端读取示例](#6-rust-后端读取示例)
- [7. TypeScript/React 前端调用示例](#7-typescriptreact-前端调用示例)

---

## 1. 认证信息 (auth)

用户登录和认证相关的持久化数据。

| 键名 | 类型 | 说明 | 示例值 |
|------|------|------|--------|
| `auth.username` | `string` | 登录用户名 | `"admin"` |
| `auth.password` | `string` | 登录密码（建议加密存储） | `"******"` |
| `auth.config_key` | `string` | 配置密钥（用于服务端验证） | `"abc123..."` |
| `auth.saved_key` | `string` | 保存的密钥 | `"xyz789..."` |
| `auth.user_info` | `AuthUserInfo` | 用户详细信息（JSON 对象） | 见下方类型定义 |
| `auth.online_status` | `boolean` | 在线状态 | `true` |

### AuthUserInfo 类型定义

```typescript
interface AuthUserInfo {
  username: string;      // 用户名
  displayName?: string;  // 显示名称
  avatar?: string;       // 头像 URL
  email?: string;        // 邮箱
  phone?: string;        // 手机号
}
```

---

## 2. 配置信息 (config)

场景配置和自定义配置相关数据。

| 键名 | 类型 | 说明 | 示例值 |
|------|------|------|--------|
| `config.current_scene` | `string` | 当前激活的场景 ID | `"production"` |
| `config.custom_scenes` | `CustomScene[]` | 自定义场景列表（JSON 数组） | 见下方类型定义 |
| `config.version` | `string` | 配置版本号（用于数据迁移） | `"1"` |

### CustomScene 类型定义

```typescript
interface CustomScene {
  id: string;            // 场景唯一标识
  name: string;          // 场景名称
  description?: string;  // 场景描述
  isDefault?: boolean;   // 是否为默认场景
  server: {
    apiUrl: string;      // API 服务地址
    apiKey?: string;     // API 密钥
    timeout?: number;    // 请求超时（毫秒）
  };
  local: {
    agent: {
      host: string;      // Agent 主机
      port: number;      // Agent 端口
      scheme?: string;   // 协议（http/https）
      path?: string;     // 路径前缀
    };
    vnc: {
      host: string;      // VNC 主机
      port: number;      // VNC 端口
      scheme?: string;   // 协议
    };
    fileServer: {
      host: string;      // 文件服务主机
      port: number;      // 文件服务端口
      scheme?: string;   // 协议
      path?: string;     // 路径前缀
    };
    websocket: {
      host: string;      // WebSocket 主机
      port: number;      // WebSocket 端口
      scheme?: string;   // 协议（ws/wss）
      path?: string;     // 路径前缀
    };
  };
}
```

---

## 3. 应用设置 (settings)

应用行为相关的设置。

| 键名 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `settings.auto_connect` | `boolean` | 自动连接服务 | `false` |
| `settings.notifications` | `boolean` | 启用通知 | `true` |

> **注意**：开机自启动功能通过系统 API 实现（LaunchAgent/Registry/XDG Autostart），不存储在此处。

---

## 4. 初始化向导 (setup)

首次启动配置向导的状态和数据。

| 键名 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `setup.completed` | `boolean` | 是否完成初始化向导 | `false` |
| `setup.current_step` | `number` | 当前向导步骤（1/2/3） | `1` |
| `setup.server_host` | `string` | 服务域名 | `"https://agent.nuwax.com"` |
| `setup.server_port` | `number` | 服务 HTTPS 端口 | `443` |
| `setup.agent_port` | `number` | Agent 服务端口 | `9086` |
| `setup.file_server_port` | `number` | 文件服务端口 | `60000` |
| `setup.proxy_port` | `number` | 代理服务端口 | `9099` |
| `setup.workspace_dir` | `string` | 工作区目录路径 | `""` |

### SetupState 类型定义

```typescript
interface SetupState {
  completed: boolean;      // 是否完成初始化
  currentStep: number;     // 当前步骤 (1/2/3)
  serverHost: string;      // 服务域名
  serverPort: number;      // 服务 HTTPS 端口
  agentPort: number;       // Agent 端口
  fileServerPort: number;  // 文件服务端口
  proxyPort: number;       // 代理服务端口
  workspaceDir: string;    // 工作区目录
}
```

### 向导步骤说明

| 步骤 | 名称 | 说明 |
|------|------|------|
| 1 | 基础设置 | 配置服务域名、端口、工作区目录 |
| 2 | 账号登录 | 用户名密码登录验证 |
| 3 | 依赖安装 | 检测 Node.js、安装本地 npm 依赖 |

---

## 5. 依赖管理 (deps)

本地 npm 依赖安装相关路径。

| 键名 | 类型 | 说明 | 示例值 |
|------|------|------|--------|
| `deps.install_dir` | `string` | npm 包安装根目录（应用数据目录） | macOS: `~/Library/Application Support/com.nuwax.agent-tauri-client/` |
| `deps.node_modules_path` | `string` | node_modules 完整路径 | `~/Library/Application Support/com.nuwax.agent-tauri-client/node_modules/` |

### 本地安装的 npm 依赖

| 包名 | 说明 |
|------|------|
| `nuwax-file-server` | 文件服务器 |
| `nuwaxcode` | Nuwax 代码服务 |
| `claude-code-acp-ts` | Claude Code ACP 服务 |

### 各平台应用数据目录

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/com.nuwax.agent-tauri-client/` |
| Windows | `C:\Users\<用户名>\AppData\Roaming\com.nuwax.agent-tauri-client\` |
| Linux | `~/.local/share/com.nuwax.agent-tauri-client/` |

---

## 6. Rust 后端读取示例

Rust 后端只需读取存储数据，写入操作由前端 UI 负责。

### 6.1 依赖配置

```toml
# Cargo.toml
[dependencies]
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### 6.2 初始化插件

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        // ... 其他配置
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 6.3 数据结构定义

```rust
use serde::{Deserialize, Serialize};

/// 用户认证信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUserInfo {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

/// 初始化配置状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupState {
    pub completed: bool,
    pub current_step: i32,
    pub server_host: String,
    pub server_port: i32,
    pub agent_port: i32,
    pub file_server_port: i32,
    pub proxy_port: i32,
    pub workspace_dir: String,
}

/// 自定义场景配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomScene {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    pub server: ServerConfig,
    pub local: LocalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub api_url: String,
    pub api_key: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    pub agent: EndpointConfig,
    pub vnc: EndpointConfig,
    pub file_server: EndpointConfig,
    pub websocket: EndpointConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointConfig {
    pub host: String,
    pub port: u16,
    pub scheme: Option<String>,
    pub path: Option<String>,
}
```

### 6.4 读取函数

```rust
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "nuwax_store.bin";

/// 读取字符串值
fn read_string(app: &tauri::AppHandle, key: &str) -> Option<String> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(key))
        .and_then(|v| v.as_str().map(String::from))
}

/// 读取布尔值
fn read_bool(app: &tauri::AppHandle, key: &str) -> Option<bool> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(key))
        .and_then(|v| v.as_bool())
}

/// 读取数值
fn read_number(app: &tauri::AppHandle, key: &str) -> Option<i64> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(key))
        .and_then(|v| v.as_i64())
}

/// 读取 JSON 对象
fn read_object<T: serde::de::DeserializeOwned>(app: &tauri::AppHandle, key: &str) -> Option<T> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(key))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
```

### 6.5 读取初始化配置

```rust
/// 获取初始化状态（用于服务启动）
pub fn get_setup_state(app: &tauri::AppHandle) -> SetupState {
    SetupState {
        completed: read_bool(app, "setup.completed").unwrap_or(false),
        current_step: read_number(app, "setup.current_step").unwrap_or(1) as i32,
        server_host: read_string(app, "setup.server_host")
            .unwrap_or_else(|| "https://agent.nuwax.com".to_string()),
        server_port: read_number(app, "setup.server_port").unwrap_or(443) as i32,
        agent_port: read_number(app, "setup.agent_port").unwrap_or(9086) as i32,
        file_server_port: read_number(app, "setup.file_server_port").unwrap_or(60000) as i32,
        proxy_port: read_number(app, "setup.proxy_port").unwrap_or(9099) as i32,
        workspace_dir: read_string(app, "setup.workspace_dir").unwrap_or_default(),
    }
}

// 使用示例
fn start_services(app: &tauri::AppHandle) {
    let config = get_setup_state(app);

    if !config.completed {
        log::warn!("初始化未完成，跳过服务启动");
        return;
    }

    log::info!("服务配置: host={}, agent_port={}, file_port={}",
        config.server_host, config.agent_port, config.file_server_port);

    // 启动 Agent 服务
    // start_agent_service(&config.server_host, config.agent_port);

    // 启动文件服务
    // start_file_service(config.file_server_port);
}
```

### 6.6 读取认证信息

```rust
/// 获取用户认证信息
pub fn get_auth_info(app: &tauri::AppHandle) -> Option<AuthUserInfo> {
    read_object::<AuthUserInfo>(app, "auth.user_info")
}

/// 获取 ConfigKey（用于服务端验证）
pub fn get_config_key(app: &tauri::AppHandle) -> Option<String> {
    read_string(app, "auth.config_key")
}

/// 检查是否已登录
pub fn is_logged_in(app: &tauri::AppHandle) -> bool {
    read_bool(app, "auth.online_status").unwrap_or(false)
}

// 使用示例
fn connect_to_server(app: &tauri::AppHandle) {
    if !is_logged_in(app) {
        log::warn!("用户未登录");
        return;
    }

    if let Some(config_key) = get_config_key(app) {
        log::info!("使用 ConfigKey 连接服务器");
        // connect_with_key(&config_key);
    }

    if let Some(user) = get_auth_info(app) {
        log::info!("当前用户: {}", user.username);
    }
}
```

### 6.7 读取场景配置

```rust
/// 获取当前场景 ID
pub fn get_current_scene_id(app: &tauri::AppHandle) -> Option<String> {
    read_string(app, "config.current_scene")
}

/// 获取自定义场景列表
pub fn get_custom_scenes(app: &tauri::AppHandle) -> Vec<CustomScene> {
    read_object::<Vec<CustomScene>>(app, "config.custom_scenes").unwrap_or_default()
}

/// 获取当前激活的场景配置
pub fn get_current_scene(app: &tauri::AppHandle) -> Option<CustomScene> {
    let scene_id = get_current_scene_id(app)?;
    let scenes = get_custom_scenes(app);
    scenes.into_iter().find(|s| s.id == scene_id)
}

// 使用示例
fn get_api_endpoint(app: &tauri::AppHandle) -> String {
    if let Some(scene) = get_current_scene(app) {
        scene.server.api_url
    } else {
        // 使用默认配置
        let setup = get_setup_state(app);
        setup.server_host
    }
}
```

### 6.8 读取依赖路径

```rust
/// 获取 npm 包安装目录
pub fn get_deps_install_dir(app: &tauri::AppHandle) -> Option<String> {
    read_string(app, "deps.install_dir")
}

/// 获取 node_modules 路径
pub fn get_node_modules_path(app: &tauri::AppHandle) -> Option<String> {
    read_string(app, "deps.node_modules_path")
}

/// 获取本地 npm 包的 bin 路径
pub fn get_local_bin_path(app: &tauri::AppHandle, package_name: &str) -> Option<String> {
    let node_modules = get_node_modules_path(app)?;
    let bin_path = std::path::Path::new(&node_modules)
        .join(".bin")
        .join(package_name);

    if bin_path.exists() {
        Some(bin_path.to_string_lossy().to_string())
    } else {
        None
    }
}

// 使用示例
fn start_nuwax_services(app: &tauri::AppHandle) {
    // 获取各服务的可执行文件路径
    let file_server_bin = get_local_bin_path(app, "nuwax-file-server");
    let nuwaxcode_bin = get_local_bin_path(app, "nuwaxcode");
    let claude_code_bin = get_local_bin_path(app, "claude-code-acp-ts");

    if let Some(bin) = file_server_bin {
        log::info!("文件服务路径: {}", bin);
        // std::process::Command::new(&bin).spawn();
    }
}
```

### 6.9 完整使用示例

```rust
use tauri::Manager;

/// 应用启动时读取配置并初始化服务
pub fn on_app_ready(app: &tauri::AppHandle) {
    // 1. 检查初始化状态
    let setup = get_setup_state(app);
    if !setup.completed {
        log::info!("等待用户完成初始化向导");
        return;
    }

    // 2. 检查登录状态
    if !is_logged_in(app) {
        log::info!("等待用户登录");
        return;
    }

    // 3. 获取配置
    let config_key = get_config_key(app);
    let workspace = &setup.workspace_dir;

    log::info!("工作区目录: {}", workspace);
    log::info!("Agent 端口: {}", setup.agent_port);
    log::info!("文件服务端口: {}", setup.file_server_port);

    // 4. 获取依赖路径
    if let Some(deps_dir) = get_deps_install_dir(app) {
        log::info!("依赖安装目录: {}", deps_dir);
    }

    // 5. 启动服务
    // start_all_services(app, &setup, config_key);
}
```

---

## 7. TypeScript/React 前端调用示例

在前端 UI 中访问存储数据。

### 7.1 导入存储服务

```typescript
// 导入存储服务
import {
  initStore,
  STORAGE_KEYS,
  authStorage,
  configStorage,
  settingsStorage,
  setupStorage,
  getString,
  setString,
  getBoolean,
  setBoolean,
  getNumber,
  setNumber,
  getObject,
  setObject,
  remove,
  save,
} from './services/store';
```

### 7.2 初始化存储（应用启动时）

```typescript
// App.tsx 或 main.tsx
import { useEffect, useState } from 'react';
import { initStore } from './services/store';

function App() {
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await initStore();
        setStoreReady(true);
      } catch (error) {
        console.error('存储初始化失败:', error);
      }
    };
    init();
  }, []);

  if (!storeReady) {
    return <div>加载中...</div>;
  }

  return <MainApp />;
}
```

### 7.3 读取存储数据

```typescript
// 使用模块化 API
import { authStorage, setupStorage, configStorage } from './services/store';

// 获取用户名
const username = await authStorage.getUsername();
console.log('用户名:', username);

// 获取用户信息对象
const userInfo = await authStorage.getUserInfo();
console.log('用户信息:', userInfo);

// 获取在线状态
const isOnline = await authStorage.getOnlineStatus();
console.log('在线状态:', isOnline);

// 获取初始化状态
const setupState = await setupStorage.getState();
console.log('初始化状态:', setupState);
/*
{
  completed: false,
  currentStep: 1,
  serverHost: 'https://agent.nuwax.com',
  serverPort: 443,
  agentPort: 9086,
  fileServerPort: 60000,
  proxyPort: 9099,
  workspaceDir: ''
}
*/

// 检查是否完成初始化
const isSetupCompleted = await setupStorage.isCompleted();
console.log('是否完成初始化:', isSetupCompleted);

// 获取当前步骤
const currentStep = await setupStorage.getCurrentStep();
console.log('当前步骤:', currentStep);

// 获取当前场景
const sceneId = await configStorage.getCurrentSceneId();
console.log('当前场景:', sceneId);

// 获取自定义场景列表
const customScenes = await configStorage.getCustomScenes();
console.log('自定义场景:', customScenes);
```

### 7.4 写入存储数据

```typescript
import { authStorage, setupStorage, configStorage } from './services/store';

// 保存用户名和密码
await authStorage.setUsername('admin');
await authStorage.setPassword('encrypted_password');

// 保存用户信息对象
await authStorage.setUserInfo({
  username: 'admin',
  displayName: '管理员',
  email: 'admin@example.com',
});

// 保存在线状态
await authStorage.setOnlineStatus(true);

// 保存初始化配置（步骤1）
await setupStorage.saveStep1({
  serverHost: 'https://api.example.com',
  agentPort: 9086,
  fileServerPort: 60000,
  proxyPort: 9099,
  workspaceDir: '/Users/test/workspace',
});

// 完成步骤2（登录）
await setupStorage.completeStep2();

// 完成初始化
await setupStorage.complete();

// 保存当前场景
await configStorage.setCurrentSceneId('production');

// 添加自定义场景
await configStorage.addCustomScene({
  id: 'my-scene',
  name: '我的场景',
  description: '测试用场景',
  server: {
    apiUrl: 'https://api.example.com',
  },
  local: {
    agent: { host: 'localhost', port: 9086 },
    vnc: { host: 'localhost', port: 5900 },
    fileServer: { host: 'localhost', port: 60000 },
    websocket: { host: 'localhost', port: 9088 },
  },
});
```

### 7.5 删除存储数据

```typescript
import { authStorage, configStorage, setupStorage, clear } from './services/store';

// 清除认证信息（登出）
await authStorage.clear();

// 清除配置信息
await configStorage.clear();

// 重置初始化向导
await setupStorage.reset();

// 清除所有数据
await clear();
```

### 7.6 React Hook 示例

```typescript
// hooks/useSetupState.ts
import { useState, useEffect, useCallback } from 'react';
import { setupStorage, SetupState } from '../services/store';

export function useSetupState() {
  const [state, setState] = useState<SetupState | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载状态
  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const data = await setupStorage.getState();
      setState(data);
    } catch (error) {
      console.error('加载初始化状态失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadState();
  }, [loadState]);

  // 更新状态
  const updateState = useCallback(async (updates: Partial<SetupState>) => {
    await setupStorage.setState(updates);
    await loadState(); // 重新加载
  }, [loadState]);

  // 重置状态
  const resetState = useCallback(async () => {
    await setupStorage.reset();
    await loadState();
  }, [loadState]);

  return {
    state,
    loading,
    updateState,
    resetState,
    reload: loadState,
  };
}
```

```typescript
// hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { authStorage, AuthUserInfo } from '../services/store';

export function useAuth() {
  const [userInfo, setUserInfo] = useState<AuthUserInfo | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // 加载认证信息
  const loadAuth = useCallback(async () => {
    setLoading(true);
    try {
      const [info, online] = await Promise.all([
        authStorage.getUserInfo(),
        authStorage.getOnlineStatus(),
      ]);
      setUserInfo(info);
      setIsOnline(online ?? false);
    } catch (error) {
      console.error('加载认证信息失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  // 登录
  const login = useCallback(async (username: string, password: string, userInfo: AuthUserInfo) => {
    await authStorage.setUsername(username);
    await authStorage.setPassword(password);
    await authStorage.setUserInfo(userInfo);
    await authStorage.setOnlineStatus(true);
    await loadAuth();
  }, [loadAuth]);

  // 登出
  const logout = useCallback(async () => {
    await authStorage.clear();
    setUserInfo(null);
    setIsOnline(false);
  }, []);

  return {
    userInfo,
    isOnline,
    loading,
    login,
    logout,
    reload: loadAuth,
  };
}
```

### 7.7 React 组件示例

```tsx
// components/SetupWizard.tsx
import React, { useState, useEffect } from 'react';
import { Form, Input, InputNumber, Button, Steps, message } from 'antd';
import { setupStorage, DEFAULT_SETUP_STATE } from '../services/store';

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();

  // 加载已保存的配置
  useEffect(() => {
    const loadConfig = async () => {
      const state = await setupStorage.getState();
      setCurrentStep(state.currentStep);
      form.setFieldsValue({
        serverHost: state.serverHost,
        agentPort: state.agentPort,
        fileServerPort: state.fileServerPort,
        proxyPort: state.proxyPort,
        workspaceDir: state.workspaceDir,
      });
      setLoading(false);
    };
    loadConfig();
  }, [form]);

  // 保存步骤1
  const handleStep1Submit = async () => {
    try {
      const values = await form.validateFields();
      await setupStorage.saveStep1(values);
      setCurrentStep(2);
      message.success('基础配置已保存');
    } catch (error) {
      message.error('请填写完整配置');
    }
  };

  // 完成初始化
  const handleComplete = async () => {
    await setupStorage.complete();
    message.success('初始化完成');
    onComplete();
  };

  if (loading) {
    return <div>加载中...</div>;
  }

  return (
    <div>
      <Steps current={currentStep - 1}>
        <Steps.Step title="基础设置" />
        <Steps.Step title="账号登录" />
        <Steps.Step title="依赖安装" />
      </Steps>

      {currentStep === 1 && (
        <Form form={form} layout="vertical">
          <Form.Item
            name="serverHost"
            label="服务域名"
            rules={[{ required: true }]}
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item
            name="agentPort"
            label="Agent 端口"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={65535} />
          </Form.Item>
          <Form.Item
            name="fileServerPort"
            label="文件服务端口"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={65535} />
          </Form.Item>
          <Form.Item
            name="proxyPort"
            label="代理服务端口"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={65535} />
          </Form.Item>
          <Form.Item
            name="workspaceDir"
            label="工作区目录"
            rules={[{ required: true }]}
          >
            <Input placeholder="/path/to/workspace" />
          </Form.Item>
          <Button type="primary" onClick={handleStep1Submit}>
            下一步
          </Button>
        </Form>
      )}

      {currentStep === 2 && (
        <div>
          {/* 登录表单 */}
          <Button onClick={() => setupStorage.completeStep2().then(() => setCurrentStep(3))}>
            登录完成，下一步
          </Button>
        </div>
      )}

      {currentStep === 3 && (
        <div>
          {/* 依赖安装界面 */}
          <Button type="primary" onClick={handleComplete}>
            完成初始化
          </Button>
        </div>
      )}
    </div>
  );
}
```

### 7.8 前端与 Rust 的职责划分

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (TypeScript/React)               │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   读取数据   │  │   写入数据   │  │   删除数据   │         │
│  │  ✅ 支持    │  │  ✅ 支持    │  │  ✅ 支持    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  使用: store.ts 中的 authStorage / setupStorage / ...       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri Store Plugin
                              │ (nuwax_store.bin)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        后端 (Rust)                          │
│                                                             │
│  ┌─────────────┐                                           │
│  │   读取数据   │  用于服务启动、配置获取等                   │
│  │  ✅ 支持    │                                           │
│  └─────────────┘                                           │
│                                                             │
│  写入/删除: ❌ 不支持（由前端负责）                          │
└─────────────────────────────────────────────────────────────┘
```

**设计原则**：
- **前端**：负责所有 UI 交互相关的数据读写（用户配置、登录状态等）
- **Rust 后端**：只读取配置用于服务启动、连接验证等系统级操作

这样设计的好处：
1. 数据流向清晰，避免前后端同时写入导致的冲突
2. 前端可即时响应用户操作，无需等待 Rust 命令返回
3. Rust 专注于服务逻辑，不处理 UI 状态

---

## 存储 API 概览

### 通用操作

```typescript
// 初始化存储
await initStore();

// 字符串操作
await getString(key);
await setString(key, value);

// 布尔值操作
await getBoolean(key);
await setBoolean(key, value);

// 数值操作
await getNumber(key);
await setNumber(key, value);

// 对象操作（JSON）
await getObject<T>(key);
await setObject<T>(key, value);

// 其他操作
await remove(key);
await has(key);
await save();
await clear();
await keys();
```

### 模块化存储操作

| 模块 | 导出名 | 说明 |
|------|--------|------|
| 认证 | `authStorage` | 用户登录信息管理 |
| 配置 | `configStorage` | 场景配置管理 |
| 设置 | `settingsStorage` | 应用设置管理 |
| 向导 | `setupStorage` | 初始化向导状态管理 |

---

## 数据清理

### 清除认证信息

```typescript
await authStorage.clear();
```

### 清除配置信息

```typescript
await configStorage.clear();
```

### 重置初始化向导

```typescript
await setupStorage.reset();
```

### 清除所有数据

```typescript
await clear();
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.3 | 2026-02-05 | 更新默认域名：生产环境为 agent.nuwax.com，新增 server_port 字段 |
| 1.2 | 2026-02-04 | Rust 示例精简为只读操作，明确前后端职责划分 |
| 1.1 | 2026-02-04 | 添加 Rust 和 TypeScript 调用示例 |
| 1.0 | 2026-02-04 | 初始版本，包含认证、配置、设置、向导、依赖管理 |
