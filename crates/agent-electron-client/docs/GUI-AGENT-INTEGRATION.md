# GUI Agent 集成方案 (深度研究)

> 基于 NuwaClaw Electron 现有架构，集成 GUI 自动化能力

**版本**: v3.0 (深度研究版)
**日期**: 2026-03-15

> **注意**: 本文档是实现前的技术调研报告，其中的 API 设计（如独立的 `/click`、`/type` 端点和 `X-GUI-Agent-Token` 头部）与最终实现有所不同。实际实现采用了统一的 `/gui/input` 端点和标准 `Authorization: Bearer` 认证。请参阅 [`docs/GUI-AGENT-IMPLEMENTATION.md`](../../docs/GUI-AGENT-IMPLEMENTATION.md) 获取最终 API 文档。

---

## 1. ACP 协议深度分析

### 1.1 ACP Tool Call 机制

ACP (Agent Client Protocol) 的工具调用流程：

```
┌──────────────────────────────────────────────────────────────┐
│                     Agent Process                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    ACP Engine                           │  │
│  │                                                         │  │
│  │  1. 决定调用工具 ──► 2. 调用 MCP Server                  │  │
│  │                           │                             │  │
│  │                           ▼                             │  │
│  │                     3. MCP 执行工具                      │  │
│  │                           │                             │  │
│  │                           ▼                             │  │
│  │  5. 发送 tool_call_update ◄─ 4. 返回结果                │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                    │
                    │ NDJSON stdio
                    ▼
┌──────────────────────────────────────────────────────────────┐
│                   Electron Main Process                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              AcpEngine (Client)                         │  │
│  │                                                         │  │
│  │  sessionUpdate: (type: 'tool_call') ──► UI 通知        │  │
│  │  sessionUpdate: (type: 'tool_call_update') ──► UI 更新 │  │
│  │                                                         │  │
│  │  ⚠️ 客户端无法干预工具执行过程                           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**关键发现**：
1. MCP Server 在 Agent 进程内部执行
2. 客户端只接收 `tool_call` 通知，无法干预执行
3. ACP 协议是单向的：Agent → Client
4. 客户端无法主动向 Agent 发送消息

### 1.2 现有权限机制

```typescript
// Agent 请求权限时的流程
requestPermission: async (params: AcpPermissionRequest): Promise<AcpPermissionResponse> => {
  // params.toolCall 包含工具调用信息
  // params.options 包含可选操作 (allow_once, allow_always, reject)
  
  // 客户端只能选择：
  // - allow_once: 允许这次
  // - allow_always: 总是允许
  // - reject: 拒绝
  
  // 返回后 Agent 继续执行或取消
}
```

**限制**：权限请求只能"允许"或"拒绝"，无法替换执行逻辑。

---

## 2. 集成方案对比

### 2.1 方案 A：MCP Server（推荐）

**原理**：将 GUI Agent 实现为 MCP Server，通过现有机制注入

**优点**：
- ✅ 完全符合 ACP 协议设计
- ✅ Agent 原生支持
- ✅ 无需修改 AcpEngine

**缺点**：
- ⚠️ 需要额外进程
- ⚠️ stdio 通信开销

### 2.2 方案 B：Bash 脚本 + System Prompt

**原理**：
1. 在 System Prompt 中告知 Agent 有 GUI 脚本可用
2. Agent 通过 bash 权限执行脚本
3. 脚本执行 GUI 操作并返回 JSON 结果

```
Agent 决定截图
    │
    ▼
执行 bash: node /app/gui-tool.js screenshot
    │
    ▼
GUI Tool 执行截图，输出 JSON
    │
    ▼
Agent 解析结果
```

**优点**：
- ✅ 不需要 MCP
- ✅ 使用现有 bash 权限
- ✅ 实现简单

**缺点**：
- ⚠️ 依赖 Agent 理解 System Prompt
- ⚠️ 脚本执行有进程开销
- ⚠️ 调试困难

### 2.3 方案 C：本地 HTTP 服务 + curl

**原理**：
1. 启动本地 HTTP 服务（端口如 60174）
2. Agent 通过 bash curl 调用服务
3. 服务执行 GUI 操作并返回结果

```
┌──────────────────────────────────────────────────────────────┐
│                   Electron Main Process                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              GUI Agent HTTP Server                      │  │
│  │              (localhost:60174)                          │  │
│  │                                                         │  │
│  │  POST /screenshot ──► ScreenshotService ──► base64     │  │
│  │  POST /click ──► InputService ──► result               │  │
│  │  POST /type ──► InputService ──► result                │  │
│  │  POST /analyze ──► VLMAdapter ──► actions              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                    ▲
                    │ HTTP
                    │
┌──────────────────────────────────────────────────────────────┐
│                     Agent Process                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  bash: curl -X POST http://localhost:60174/screenshot  │  │
│  │  bash: curl -X POST http://localhost:60174/click       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**优点**：
- ✅ 不需要 MCP
- ✅ 使用现有 bash 权限
- ✅ HTTP 服务性能好
- ✅ 易于调试（可独立测试）
- ✅ 支持并发请求

**缺点**：
- ⚠️ 需要管理 HTTP 服务生命周期
- ⚠️ 需要端口管理
- ⚠️ 依赖 Agent 理解 curl 命令

### 2.4 方案 D：作为 ACP 内置能力（不可行）

**原理**：在 AcpEngine 中拦截 tool_call 并执行

**问题**：
- ❌ ACP 协议不支持客户端主动发消息
- ❌ 无法向 Agent 返回工具执行结果
- ❌ tool_call_update 只能由 Agent 发送

---

## 3. 推荐方案：本地 HTTP 服务 (方案 C)

### 3.1 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                   NuwaClaw Electron                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              GUI Agent HTTP Server                   │    │
│  │              (localhost:GUI_AGENT_PORT)              │    │
│  │                                                      │    │
│  │  Routes:                                             │    │
│  │  ├─ POST /screenshot     ──► ScreenshotService       │    │
│  │  ├─ POST /click          ──► InputService            │    │
│  │  ├─ POST /type           ──► InputService            │    │
│  │  ├─ POST /press_key      ──► InputService            │    │
│  │  ├─ POST /hotkey         ──► InputService            │    │
│  │  ├─ POST /scroll         ──► InputService            │    │
│  │  ├─ POST /drag           ──► InputService            │    │
│  │  ├─ POST /analyze        ──► VLMAdapter              │    │
│  │  ├─ GET  /screen_size    ──► ScreenshotService       │    │
│  │  ├─ GET  /mouse_position ──► InputService            │    │
│  │  └─ GET  /health         ──► { status: 'ok' }        │    │
│  │                                                      │    │
│  │  Features:                                           │    │
│  │  ├─ Token 验证 (X-GUI-Agent-Token)                   │    │
│  │  ├─ 请求日志                                          │    │
│  │  └─ 操作审计                                          │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 System Prompt 注入

```typescript
// src/main/services/gui/systemPrompt.ts

export const GUI_AGENT_SYSTEM_PROMPT = `
## GUI Automation Capabilities

You have access to GUI automation tools via a local HTTP service.

### Available Endpoints

**Base URL**: http://localhost:\${GUI_AGENT_PORT}

**Authentication**: Add header \`X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}\`

#### 1. Screenshot
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/screenshot \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"scale": 0.5}'
\`\`\`
Returns: \`{"image": "<base64>", "width": 1920, "height": 1080}\`

#### 2. Click
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/click \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"x": 100, "y": 200, "button": "left", "doubleClick": false}'
\`\`\`
Returns: \`{"success": true, "message": "Clicked at (100, 200)"}\`

#### 3. Type Text
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/type \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello World", "delay": 0}'
\`\`\`
Returns: \`{"success": true, "message": "Typed: Hello World"}\`

#### 4. Press Key
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/press_key \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"key": "enter"}'
\`\`\`
Valid keys: enter, tab, escape, backspace, delete, space, up, down, left, right, home, end, pageup, pagedown

#### 5. Hotkey
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/hotkey \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"keys": ["ctrl", "c"]}'
\`\`\`
Valid modifiers: ctrl, alt, shift, cmd (macOS), win (Windows)

#### 6. Scroll
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/scroll \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"direction": "down", "amount": 5}'
\`\`\`
Valid directions: up, down, left, right

#### 7. Drag
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/drag \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"startX": 100, "startY": 100, "endX": 300, "endY": 300}'
\`\`\`

#### 8. Analyze Screen (VLM)
\`\`\`bash
curl -X POST http://localhost:\${GUI_AGENT_PORT}/analyze \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"instruction": "找到登录按钮"}'
\`\`\`
Returns: \`{"actions": [...], "reasoning": "...", "confidence": 0.95}\`

#### 9. Get Screen Size
\`\`\`bash
curl -X GET http://localhost:\${GUI_AGENT_PORT}/screen_size \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}"
\`\`\`
Returns: \`{"width": 1920, "height": 1080}\`

#### 10. Get Mouse Position
\`\`\`bash
curl -X GET http://localhost:\${GUI_AGENT_PORT}/mouse_position \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}"
\`\`\`
Returns: \`{"x": 100, "y": 200}\`

### Usage Examples

**Example 1: Open Browser and Navigate**
\`\`\`bash
# 1. Take screenshot to find browser icon
curl -X POST http://localhost:\${GUI_AGENT_PORT}/screenshot -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}"

# 2. Click on browser icon (after analyzing screenshot)
curl -X POST http://localhost:\${GUI_AGENT_PORT}/click \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"x": 50, "y": 100}'

# 3. Wait for browser to open
sleep 2

# 4. Type URL
curl -X POST http://localhost:\${GUI_AGENT_PORT}/type \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "https://github.com"}'

# 5. Press Enter
curl -X POST http://localhost:\${GUI_AGENT_PORT}/press_key \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"key": "enter"}'
\`\`\`

**Example 2: Use VLM for Complex Tasks**
\`\`\`bash
# Let VLM analyze and suggest actions
curl -X POST http://localhost:\${GUI_AGENT_PORT}/analyze \\
  -H "X-GUI-Agent-Token: \${GUI_AGENT_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"instruction": "登录到 GitHub，用户名是 myuser，密码在环境变量 GITHUB_PASSWORD 中"}'
\`\`\`

### Important Notes

1. Always check the response for success/failure
2. Use \`scale: 0.5\` for screenshots to reduce token usage
3. Add delays between actions when waiting for UI updates
4. The VLM analyze endpoint is slower but more intelligent
5. Be careful with sensitive operations (passwords, deletes, etc.)
`;

/**
 * 生成带变量的 System Prompt
 */
export function generateGUISystemPrompt(port: number, token: string): string {
  return GUI_AGENT_SYSTEM_PROMPT
    .replace(/\${GUI_AGENT_PORT}/g, String(port))
    .replace(/\${GUI_AGENT_TOKEN}/g, token);
}
```

### 3.3 HTTP Server 实现

```typescript
// src/main/services/gui/guiAgentServer.ts

import * as http from 'http';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { ScreenshotService } from './screenshotService';
import { InputService } from './inputService';
import { VLMAdapter } from './vlmAdapter';
import { SecurityManager } from './securityManager';

export interface GUIAgentServerConfig {
  port: number;
  token: string;
  enabled: boolean;
  vlmProvider?: string;
  vlmApiKey?: string;
}

export class GUIAgentServer extends EventEmitter {
  private server: http.Server | null = null;
  private config: GUIAgentServerConfig;
  private screenshot: ScreenshotService;
  private input: InputService;
  private vlm: VLMAdapter | null = null;
  private security: SecurityManager;
  
  constructor(config: GUIAgentServerConfig) {
    super();
    this.config = config;
    this.screenshot = new ScreenshotService();
    this.input = new InputService();
    this.security = new SecurityManager({
      maxOperations: 100,
      requireConfirmation: false, // HTTP API 不需要确认
    });
  }
  
  /**
   * 启动 HTTP 服务
   */
  async start(): Promise<void> {
    if (this.server) {
      log.warn('[GUIAgentServer] Server already running');
      return;
    }
    
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });
    
    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, '127.0.0.1', () => {
        log.info(`[GUIAgentServer] 🚀 Server started on port ${this.config.port}`);
        this.emit('started', { port: this.config.port });
        resolve();
      });
      
      this.server!.on('error', (err) => {
        log.error('[GUIAgentServer] Server error:', err);
        this.emit('error', err);
        reject(err);
      });
    });
  }
  
  /**
   * 停止 HTTP 服务
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    
    return new Promise((resolve) => {
      this.server!.close(() => {
        log.info('[GUIAgentServer] Server stopped');
        this.server = null;
        resolve();
      });
    });
  }
  
  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now();
    const method = req.method!;
    const url = req.url!;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-GUI-Agent-Token');
    
    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Token 验证
    const token = req.headers['x-gui-agent-token'];
    if (token !== this.config.token) {
      log.warn('[GUIAgentServer] Invalid token');
      this.sendError(res, 401, 'Unauthorized');
      return;
    }
    
    // 检查是否启用
    if (!this.config.enabled) {
      this.sendError(res, 503, 'GUI Agent is disabled');
      return;
    }
    
    try {
      // 路由处理
      const result = await this.route(method, url, req);
      
      const duration = Date.now() - startTime;
      log.info(`[GUIAgentServer] ${method} ${url} - ${duration}ms`);
      
      this.sendJson(res, 200, result);
      
      // 发送操作审计事件
      this.emit('operation', { method, url, duration, success: true });
    } catch (error: any) {
      log.error('[GUIAgentServer] Request error:', error);
      this.sendError(res, 500, error.message);
      
      this.emit('operation', { method, url, duration: Date.now() - startTime, success: false, error: error.message });
    }
  }
  
  /**
   * 路由处理
   */
  private async route(method: string, url: string, req: http.IncomingMessage): Promise<any> {
    // 解析 body (POST 请求)
    let body: any = null;
    if (method === 'POST') {
      body = await this.parseBody(req);
    }
    
    // 路由匹配
    switch (`${method} ${url}`) {
      // Screenshot
      case 'POST /screenshot': {
        const img = await this.screenshot.capture({
          scale: body?.scale,
          region: body?.region,
        });
        const size = await this.screenshot.getScreenSize();
        return {
          image: img.toString('base64'),
          width: size.width,
          height: size.height,
        };
      }
      
      // Click
      case 'POST /click': {
        await this.input.click(body.x, body.y, {
          button: body?.button,
          doubleClick: body?.doubleClick,
        });
        return { success: true, message: `Clicked at (${body.x}, ${body.y})` };
      }
      
      // Type
      case 'POST /type': {
        await this.input.type(body.text, { delay: body?.delay });
        return { success: true, message: `Typed: ${body.text}` };
      }
      
      // Press Key
      case 'POST /press_key': {
        await this.input.pressKey(body.key);
        return { success: true, message: `Pressed key: ${body.key}` };
      }
      
      // Hotkey
      case 'POST /hotkey': {
        await this.input.hotkey(...body.keys);
        return { success: true, message: `Pressed hotkey: ${body.keys.join('+')}` };
      }
      
      // Scroll
      case 'POST /scroll': {
        await this.input.scroll({
          direction: body.direction,
          amount: body?.amount,
        });
        return { success: true, message: `Scrolled ${body.direction}` };
      }
      
      // Drag
      case 'POST /drag': {
        await this.input.drag(body.startX, body.startY, body.endX, body.endY);
        return { success: true, message: `Dragged from (${body.startX}, ${body.startY}) to (${body.endX}, ${body.endY})` };
      }
      
      // Analyze
      case 'POST /analyze': {
        const img = await this.screenshot.capture();
        
        if (!this.vlm) {
          this.vlm = new VLMAdapter({
            provider: this.config.vlmProvider || body?.provider || 'qwen',
            apiKey: this.config.vlmApiKey,
          });
        }
        
        const result = await this.vlm.analyzeScreen(img, body.instruction);
        return result;
      }
      
      // Get Screen Size
      case 'GET /screen_size': {
        const size = await this.screenshot.getScreenSize();
        return size;
      }
      
      // Get Mouse Position
      case 'GET /mouse_position': {
        const pos = await this.input.getMousePosition();
        return pos;
      }
      
      // Health
      case 'GET /health': {
        return { status: 'ok', timestamp: new Date().toISOString() };
      }
      
      default:
        throw new Error(`Unknown route: ${method} ${url}`);
    }
  }
  
  /**
   * 解析请求 body
   */
  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
  
  /**
   * 发送 JSON 响应
   */
  private sendJson(res: http.ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
  
  /**
   * 发送错误响应
   */
  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJson(res, status, { error: message });
  }
  
  /**
   * 获取服务状态
   */
  getStatus(): { running: boolean; port?: number } {
    return {
      running: !!this.server,
      port: this.server ? this.config.port : undefined,
    };
  }
}
```

### 3.4 与 UnifiedAgentService 集成

```typescript
// src/main/services/engines/unifiedAgent.ts (修改)

import { GUIAgentServer, generateGUISystemPrompt } from '../gui';

export class UnifiedAgentService extends EventEmitter {
  private guiAgentServer: GUIAgentServer | null = null;
  private guiAgentPort: number = 60174;
  private guiAgentToken: string = '';
  
  /**
   * 初始化 GUI Agent 服务
   */
  async initGUIAgent(config: { enabled: boolean; vlmProvider?: string; vlmApiKey?: string }): Promise<void> {
    if (!config.enabled) {
      log.info('[UnifiedAgent] GUI Agent disabled');
      return;
    }
    
    // 生成随机 token
    this.guiAgentToken = crypto.randomBytes(32).toString('hex');
    
    // 查找可用端口
    this.guiAgentPort = await this.findAvailablePort(60174);
    
    // 创建并启动服务
    this.guiAgentServer = new GUIAgentServer({
      port: this.guiAgentPort,
      token: this.guiAgentToken,
      enabled: true,
      vlmProvider: config.vlmProvider,
      vlmApiKey: config.vlmApiKey,
    });
    
    await this.guiAgentServer.start();
    
    log.info(`[UnifiedAgent] GUI Agent started on port ${this.guiAgentPort}`);
  }
  
  /**
   * 停止 GUI Agent 服务
   */
  async stopGUIAgent(): Promise<void> {
    if (this.guiAgentServer) {
      await this.guiAgentServer.stop();
      this.guiAgentServer = null;
    }
  }
  
  /**
   * 获取 GUI Agent System Prompt
   */
  getGUISystemPrompt(): string | null {
    if (!this.guiAgentServer) return null;
    
    return generateGUISystemPrompt(this.guiAgentPort, this.guiAgentToken);
  }
  
  /**
   * 查找可用端口
   */
  private async findAvailablePort(startPort: number): Promise<number> {
    const net = require('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(startPort, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        // 端口被占用，尝试下一个
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }
}
```

### 3.5 在 chat 时注入 System Prompt

```typescript
// src/main/services/engines/unifiedAgent.ts

async chat(request: ComputerChatRequest): Promise<ComputerChatResponse> {
  // ... 现有代码 ...
  
  // 构建 system prompt
  let systemPrompt = request.system_prompt || '';
  
  // 注入 GUI Agent System Prompt
  const guiPrompt = this.getGUISystemPrompt();
  if (guiPrompt) {
    systemPrompt = systemPrompt 
      ? `${systemPrompt}\n\n${guiPrompt}` 
      : guiPrompt;
  }
  
  // 创建 session 时传入
  await engine.createSession({
    title: request.project_id,
    cwd: workspaceDir,
    mcpServers: effectiveMcpServers,
    systemPrompt: systemPrompt, // 注入
  });
  
  // ... 其余代码 ...
}
```

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     NuwaClaw Electron                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │           UnifiedAgentService                       │     │
│  └─────────────────────┬──────────────────────────────┘     │
│                        │                                     │
│                        ▼                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │           AcpEngine (claude-code/nuwaxcode)         │     │
│  │                                                      │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │         ClientHandler                         │  │     │
│  │  │  - toolCall()  ◄─── Agent 调用工具            │  │     │
│  │  │  - listTools() ◄─── Agent 查询工具列表        │  │     │
│  │  └───────────────┬───────────────────────────────┘  │     │
│  │                    │                                 │     │
│  │      ┌─────────────┼─────────────┐                  │     │
│  │      ▼             ▼             ▼                  │     │
│  │  [MCP tools]  [Built-in tools] [More...]            │     │
│  │      │             │                                │     │
│  └──────┼─────────────┼────────────────────────────────┘     │
│         │             │                                       │
│         │             ▼                                       │
│         │    ┌────────────────────────┐                      │
│         │    │   GUIAgentService      │ (新增)               │
│         │    │                        │                      │
│         │    │ ┌────────────────────┐ │                      │
│         │    │ │ Built-in Tools:    │ │                      │
│         │    │ │ - gui_screenshot   │ │                      │
│         │    │ │ - gui_click        │ │                      │
│         │    │ │ - gui_type         │ │                      │
│         │    │ │ - gui_press_key    │ │                      │
│         │    │ │ - gui_hotkey       │ │                      │
│         │    │ │ - gui_scroll       │ │                      │
│         │    │ │ - gui_drag         │ │                      │
│         │    │ │ - gui_analyze      │ │                      │
│         │    │ └──────────┬─────────┘ │                      │
│         │    └────────────┼───────────┘                      │
│         │                 │                                   │
│         │    ┌────────────┼────────────┐                     │
│         │    ▼            ▼            ▼                     │
│         │ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│         │ │Screenshot│ │ Input  │ │  VLM    │                │
│         │ │ Service │ │ Service│ │ Adapter │                │
│         │ └─────────┘ └─────────┘ └─────────┘                │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────┐                                        │
│  │ nuwax-mcp-stdio- │ (现有 MCP 服务器)                       │
│  │ proxy            │                                        │
│  └──────────────────┘                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
src/main/services/
├── engines/
│   ├── acp/
│   │   └── acpEngine.ts      # 修改：添加内置工具支持
│   └── unifiedAgent.ts
│
└── gui/                       # 新增
    ├── index.ts               # 导出
    ├── guiAgentService.ts     # GUI Agent 服务入口
    ├── screenshotService.ts   # 截图服务
    ├── inputService.ts        # 键鼠控制
    ├── vlmAdapter.ts          # VLM 适配器
    ├── securityManager.ts     # 安全管理
    ├── builtinTools.ts        # 内置工具定义
    └── types.ts               # 类型定义
```

### 3.3 数据流

```
1. Agent 调用工具
   Agent → ACP protocol → AcpEngine.clientHandler.toolCall()
   
2. 工具路由
   toolCall() → 判断工具名前缀
              → "gui_*" → GUIAgentService.handleToolCall()
              → 其他 → MCP Proxy (现有流程)
   
3. 执行 GUI 操作
   GUIAgentService → ScreenshotService / InputService / VLMAdapter
   
4. 返回结果
   GUIAgentService → AcpEngine → Agent
```

---

## 4. 详细实现

### 4.1 内置工具定义

```typescript
// src/main/services/gui/builtinTools.ts

/**
 * 内置 GUI 工具定义
 * 这些工具会被注册到 AcpEngine，Agent 可以直接调用
 */
export const BUILTIN_GUI_TOOLS = [
  {
    name: 'gui_screenshot',
    description: '捕获屏幕截图，返回 base64 编码的图片。用于查看当前屏幕内容。',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: '截图区域 (可选，默认全屏)',
          properties: {
            x: { type: 'number', description: '起始 X 坐标' },
            y: { type: 'number', description: '起始 Y 坐标' },
            width: { type: 'number', description: '宽度' },
            height: { type: 'number', description: '高度' },
          },
        },
        scale: {
          type: 'number',
          description: '缩放比例 (0.1-1)，默认 1。降低可减少 token 消耗',
        },
      },
    },
  },
  {
    name: 'gui_click',
    description: '在指定位置点击鼠标',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标' },
        y: { type: 'number', description: 'Y 坐标' },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: '鼠标按钮，默认 left',
        },
        doubleClick: {
          type: 'boolean',
          description: '是否双击，默认 false',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'gui_type',
    description: '输入文本到当前焦点元素',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本' },
        delay: {
          type: 'number',
          description: '每个字符间隔毫秒数，默认 0',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'gui_press_key',
    description: '按下并释放单个按键',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '按键名称: enter, tab, escape, backspace, delete, space, up, down, left, right, home, end, pageup, pagedown',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'gui_hotkey',
    description: '执行组合键 (快捷键)，如 Ctrl+C, Cmd+V',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '按键列表，修饰键在前，如 ["ctrl", "c"] 或 ["cmd", "v"]',
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'gui_scroll',
    description: '滚动屏幕',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: '滚动方向',
        },
        amount: {
          type: 'number',
          description: '滚动量，默认 5',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'gui_drag',
    description: '拖拽操作，从起点拖到终点',
    inputSchema: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: '起点 X' },
        startY: { type: 'number', description: '起点 Y' },
        endX: { type: 'number', description: '终点 X' },
        endY: { type: 'number', description: '终点 Y' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'gui_analyze',
    description: '使用视觉模型分析屏幕内容，返回操作建议。用于复杂场景理解。',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '分析指令，如"找到登录按钮"或"阅读屏幕内容"',
        },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'gui_get_screen_size',
    description: '获取屏幕尺寸',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'gui_get_mouse_position',
    description: '获取鼠标当前位置',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'gui_wait',
    description: '等待指定时间，用于等待界面加载',
    inputSchema: {
      type: 'object',
      properties: {
        ms: {
          type: 'number',
          description: '等待毫秒数',
        },
      },
      required: ['ms'],
    },
  },
];

/**
 * 判断是否为内置 GUI 工具
 */
export function isBuiltinGuiTool(toolName: string): boolean {
  return toolName.startsWith('gui_') && 
    BUILTIN_GUI_TOOLS.some(t => t.name === toolName);
}
```

---

## 6. 使用示例

### 6.1 Agent 调用 GUI 工具

```typescript
// 用户指令: "打开浏览器访问 github.com 并登录"

// Agent 自动调用 MCP 工具序列:
// 1. gui_analyze({ instruction: "打开浏览器" })
//    → 返回浏览器图标位置

// 2. gui_click({ x: 100, y: 200 })  // 点击浏览器图标

// 3. gui_type({ text: "github.com" })  // 输入 URL

// 4. gui_press_key({ key: "enter" })  // 按回车

// 5. gui_analyze({ instruction: "找到登录按钮" })
//    → 返回登录按钮位置

// 6. gui_click({ x: 500, y: 300 })  // 点击登录
```

### 6.2 手动调用示例

```typescript
// 通过 IPC 调用 (可选，用于调试)
const result = await ipcRenderer.invoke('gui:screenshot');
const analysis = await ipcRenderer.invoke('gui:analyze', {
  instruction: '找到搜索框',
});
await ipcRenderer.invoke('gui:click', { x: analysis.x, y: analysis.y });
```

---

## 7. 安全考虑

### 7.1 权限管理

```typescript
// src/main/services/gui/securityManager.ts

export class SecurityManager {
  private operationCount = 0;
  private readonly MAX_OPERATIONS = 100;
  private enabled = true;
  
  // 敏感操作关键词
  private readonly SENSITIVE_KEYWORDS = [
    'password', '密码', 'pin', 'cvv', 'token',
    'delete', '删除', 'format', 'shutdown',
  ];
  
  /**
   * 检查操作权限
   */
  async checkPermission(action: GUIAction): Promise<{
    allowed: boolean;
    reason?: string;
    requireConfirmation?: boolean;
  }> {
    if (!this.enabled) {
      return { allowed: true };
    }
    
    // 检查操作次数
    if (this.operationCount >= this.MAX_OPERATIONS) {
      return {
        allowed: false,
        reason: 'Maximum operations reached',
      };
    }
    
    // 检查敏感操作
    if (this.isSensitiveAction(action)) {
      return {
        allowed: true,
        requireConfirmation: true,
      };
    }
    
    this.operationCount++;
    return { allowed: true };
  }
  
  private isSensitiveAction(action: GUIAction): boolean {
    if (action.type === 'type' && action.text) {
      return this.SENSITIVE_KEYWORDS.some(kw =>
        action.text!.toLowerCase().includes(kw)
      );
    }
    return false;
  }
  
  /**
   * 重置计数器 (每次新会话)
   */
  reset(): void {
    this.operationCount = 0;
  }
}
```

### 7.2 隐私保护

```typescript
// 在截图发送给 VLM 前，检测并遮罩敏感区域
async function maskSensitiveRegions(screenshot: Buffer): Promise<Buffer> {
  // TODO: 实现敏感区域检测
  // 1. OCR 提取文本
  // 2. 匹配敏感关键词
  // 3. 在敏感区域绘制黑色矩形
  return screenshot;
}
```

---

## 8. 测试策略

### 8.1 单元测试

```typescript
// src/main/services/gui/__tests__/inputService.test.ts

import { describe, it, expect, vi } from 'vitest';
import { InputService } from '../inputService';

describe('InputService', () => {
  it('should move mouse to specified position', async () => {
    const service = new InputService();
    await service.moveMouse(100, 200);
    const pos = await service.getMousePosition();
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });
});
```

### 8.2 集成测试

```typescript
// tests/gui-agent-integration.test.ts

describe('GUI Agent MCP Integration', () => {
  it('should capture screenshot via MCP tool', async () => {
    const result = await callMcpTool('gui_screenshot', {});
    expect(result.content[0].type).toBe('image');
  });
  
  it('should analyze screen and return actions', async () => {
    const result = await callMcpTool('gui_analyze', {
      instruction: '找到计算器图标',
    });
    expect(result.actions).toBeDefined();
    expect(result.actions.length).toBeGreaterThan(0);
  });
});
```

---

## 9. 实施计划

### Phase 1: 基础能力 (1 周)

- [ ] 实现 ScreenshotService
- [ ] 实现 InputService
- [ ] 创建 GUI Agent MCP Server
- [ ] 集成到 NuwaClaw

### Phase 2: VLM 集成 (1 周)

- [ ] 实现 VLMAdapter (Qwen/GLM)
- [ ] 添加 `gui_analyze` 工具
- [ ] 优化 Prompt

### Phase 3: 安全增强 (3 天)

- [ ] 实现 SecurityManager
- [ ] 敏感操作确认 UI
- [ ] 操作审计日志

### Phase 4: 测试与优化 (3 天)

- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化

---

## 4. 安全考虑

### 4.1 Token 认证

```typescript
// Token 生成：使用加密随机数
const token = crypto.randomBytes(32).toString('hex');
// 例如: "a1b2c3d4e5f6...64 chars..."

// 请求时验证
const token = req.headers['x-gui-agent-token'];
if (token !== this.config.token) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### 4.2 本地绑定

```typescript
// 只监听 localhost，不接受外部连接
server.listen(port, '127.0.0.1', () => {
  // ...
});
```

### 4.3 操作审计

```typescript
// 每次操作记录日志
this.emit('operation', {
  method,
  url,
  duration,
  success,
  error,
  timestamp: new Date().toISOString(),
});

// 可配置写入 SQLite
await auditLog.insert({
  type: 'gui_operation',
  method,
  url,
  duration,
  success,
  timestamp: Date.now(),
});
```

### 4.4 速率限制

```typescript
// 防止 Agent 高频调用
const rateLimiter = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 60;

private checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const window = 60000; // 1 minute
  
  const requests = rateLimiter.get(clientId) || [];
  const recent = requests.filter(t => now - t < window);
  
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    return false; // 限流
  }
  
  recent.push(now);
  rateLimiter.set(clientId, recent);
  return true;
}
```

---

## 5. 目录结构

```
src/main/services/gui/
├── index.ts                    # 导出
├── guiAgentServer.ts           # HTTP 服务
├── screenshotService.ts        # 截图服务
├── inputService.ts             # 键鼠控制
├── vlmAdapter.ts               # VLM 适配器
├── securityManager.ts          # 安全管理
├── systemPrompt.ts             # System Prompt 生成
├── types.ts                    # 类型定义
└── __tests__/
    ├── screenshotService.test.ts
    ├── inputService.test.ts
    └── guiAgentServer.test.ts
```

---

## 6. 依赖

```json
{
  "dependencies": {
    "screenshot-desktop": "^1.15.0",
    "@nut-tree/nut-js": "^4.2.0",
    "sharp": "^0.34.5"
  }
}
```

---

## 7. 实施计划

### Phase 1: 基础能力 (3 天)

- [ ] 实现 ScreenshotService
- [ ] 实现 InputService
- [ ] 实现 GUIAgentServer (HTTP)
- [ ] 添加 System Prompt 生成

### Phase 2: 集成 (2 天)

- [ ] 与 UnifiedAgentService 集成
- [ ] 端口管理
- [ ] Token 生成与注入
- [ ] 环境变量传递

### Phase 3: VLM 集成 (2 天)

- [ ] 实现 VLMAdapter
- [ ] 添加 /analyze 接口
- [ ] 支持 Qwen/GLM/Claude

### Phase 4: 安全与测试 (2 天)

- [ ] Token 认证
- [ ] 速率限制
- [ ] 操作审计
- [ ] 单元测试
- [ ] 集成测试

**总工期**: 1.5-2 周

---

## 8. 使用示例

### 8.1 Agent 调用示例

Agent 通过 bash 执行 curl 命令：

```bash
# 截图
curl -X POST http://localhost:60174/screenshot \
  -H "X-GUI-Agent-Token: a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"scale": 0.5}'

# 点击
curl -X POST http://localhost:60174/click \
  -H "X-GUI-Agent-Token: a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"x": 100, "y": 200}'

# 分析屏幕
curl -X POST http://localhost:60174/analyze \
  -H "X-GUI-Agent-Token: a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"instruction": "找到登录按钮并点击"}'
```

### 8.2 调试方法

```bash
# 手动测试接口
curl -X GET http://localhost:60174/health \
  -H "X-GUI-Agent-Token: <your-token>"

# 获取屏幕尺寸
curl -X GET http://localhost:60174/screen_size \
  -H "X-GUI-Agent-Token: <your-token>"

# 测试截图 (保存到文件)
curl -X POST http://localhost:60174/screenshot \
  -H "X-GUI-Agent-Token: <your-token>" \
  -H "Content-Type: application/json" \
  | jq -r '.image' | base64 -d > screenshot.png
```

---

## 9. 与 MCP 方案对比

| 对比项 | MCP Server | HTTP 服务 |
|--------|-----------|-----------|
| **集成方式** | stdio | HTTP |
| **协议复杂度** | MCP 协议 | 简单 REST |
| **Agent 调用** | 原生 tool call | bash + curl |
| **性能** | ~50ms | ~10ms |
| **调试** | 困难 | 简单 |
| **进程开销** | 额外进程 | 同进程 |
| **实现难度** | 高 | 低 |

---

## 10. 市面上其他方案调研

### 10.1 Anthropic Computer Use (官方方案)

**架构**：
```
Claude API
    │
    ▼ tool_use: { type: 'computer', action: 'click', ... }
客户端执行器 (用户实现)
    │
    ▼ 执行操作
截图反馈
    │
    ▼ 继续对话
```

**特点**：
- 官方支持，Claude 原生理解 GUI
- 客户端需要自己实现执行层
- 闭源，需要付费 API

**参考实现**：
- Anthropic 官方 quickstart: https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo

---

### 10.2 OpenAI Operator

**架构**：
```
GPT-4o + CUA (Computer-Using Agent)
    │
    ▼ 浏览器自动化
Playwright / Puppeteer
```

**特点**：
- 2025年1月发布
- 仅支持浏览器场景
- 尚未开放 API

**限制**：
- 不支持原生应用
- 需要 Web 环境

---

### 10.3 OpenInterpreter (开源)

**GitHub**: https://github.com/OpenInterpreter/open-interpreter

**架构**：
```
LLM (任意)
    │
    ▼ Python 代码生成
执行环境 (Python)
    │
    ├─► pyautogui (键鼠)
    ├─► pyperclip (剪贴板)
    └─► PIL (截图)
```

**特点**：
- 开源，支持多种 LLM
- Python 实现
- 完整的 computer tool API

**代码示例**：
```python
from interpreter import interpreter

# LLM 配置
interpreter.llm.model = "gpt-4o"

# 截图
img = interpreter.computer.display.view()

# 点击
interpreter.computer.mouse.move(x=100, y=200)
interpreter.computer.mouse.click()

# 输入
interpreter.computer.keyboard.write("Hello")
```

**与 Electron 集成**：
```typescript
// 方案：作为 Python 子进程
import { spawn } from 'child_process';

class OpenInterpreterBridge {
  private process: ChildProcess;
  
  async start() {
    this.process = spawn('python', ['-m', 'interpreter', '--json']);
    this.process.stdout.on('data', this.handleResponse);
  }
  
  async screenshot(): Promise<string> {
    const cmd = { method: 'computer.display.view' };
    this.process.stdin.write(JSON.stringify(cmd) + '\n');
    // 等待响应...
  }
}
```

**优点**：
- 成熟的开源方案
- 支持多种 LLM 后端
- 代码经过大量测试

**缺点**：
- 需要 Python 环境
- 进程间通信开销

---

### 10.4 UI-TARS (字节跳动)

**GitHub**: https://github.com/bytedance/UI-TARS

**架构**：
```
UI-TARS-72B 模型
    │
    ├─► 屏幕理解 (Grounding)
    ├─► 动作规划 (Planning)
    └─► 执行 (Execution)
```

**特点**：
- 开源模型，可本地部署
- 中文优化
- 原生 GUI Grounding

**模型规格**：
| 版本 | 参数 | 显存 | 性能 |
|------|------|------|------|
| UI-TARS-2B | 2B | 6GB | 轻量 |
| UI-TARS-7B | 7B | 16GB | 平衡 |
| UI-TARS-72B | 72B | 4xA100 | 最强 |

**集成方式**：
```typescript
// 方案 1: 作为本地模型服务
import { VLMAdapter } from './vlmAdapter';

const vlm = new VLMAdapter({
  provider: 'uitars',
  baseUrl: 'http://localhost:8000',
  model: 'ui-tars-7b',
});

const result = await vlm.analyzeScreen(screenshot, '点击登录按钮');
// 返回: { bbox: [x, y, w, h], action: 'click' }
```

**优点**：
- 开源，可本地部署
- 中文界面支持好
- Grounding 能力强

**缺点**：
- 需要部署模型服务
- 大模型需要 GPU

---

### 10.5 Agent-S (Simular AI)

**GitHub**: https://github.com/simular-sp/Agent-S

**架构**：
```
┌─────────────────────────────────────────────────────────────┐
│                      Agent-S Pipeline                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Grounding ───► 2. Planning ───► 3. Execution ──► 4. Verify │
│       │               │                │              │        │
│       ▼               ▼                ▼              ▼        │
│   OmniParser      ReAct Agent      pyautogui    Screenshot   │
│   (检测元素)      (推理规划)       (执行操作)    (验证结果)    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**特点**：
- 模块化设计
- 支持多种 VLM 后端
- 内置安全沙箱

**代码示例**：
```python
from agent_s import Agent

agent = Agent(
    model="gpt-4o",
    tools=["screenshot", "click", "type", "scroll"],
)

result = await agent.run("打开 Chrome 并访问 github.com")
```

**与 Electron 集成**：
```typescript
// 作为 Python 服务
class AgentSClient {
  private baseUrl = 'http://localhost:8080';
  
  async run(instruction: string): Promise<void> {
    await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    });
  }
}
```

**优点**：
- 模块化，易于定制
- 支持 GPT-4o / Claude / Qwen-VL
- 活跃维护

**缺点**：
- Python 实现
- 需要部署服务

---

### 10.6 Screen-to-Code (Vercel)

**GitHub**: https://github.com/vercel/screen-to-code

**架构**：
```
截图
    │
    ▼ VLM 分析
代码生成
    │
    ▼
可执行代码
```

**特点**：
- 专注于截图 → 代码
- 不直接操作 GUI
- 可与其他方案组合

---

### 10.7 Playwright / Puppeteer (浏览器自动化)

**适用场景**：仅 Web 应用

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto('https://github.com');
await page.click('text=Sign in');
await page.fill('input[name="login"]', 'username');
await page.fill('input[name="password"]', 'password');
await page.click('button[type="submit"]');
```

**优点**：
- 成熟稳定
- 可编程控制
- 跨浏览器支持

**缺点**：
- 仅限 Web 应用
- 不支持原生 GUI

---

### 10.8 Robot Framework + Selenium

**适用场景**：测试自动化

```robot
*** Test Cases ***
Login Test
    Open Browser    https://github.com    Chrome
    Input Text      name=login            username
    Input Text      name=password         password
    Click Button    type=submit
    Page Should Contain    Dashboard
```

**优点**：
- 测试领域标准
- 丰富的库

**缺点**：
- 不适合 AI Agent
- 仅限测试场景

---

### 10.9 AutoHotkey (Windows)

**适用场景**：Windows 自动化

```ahk
; 点击坐标
Click, 100, 200

; 输入文本
Send, Hello World

; 组合键
Send, ^c  ; Ctrl+C
```

**优点**：
- Windows 原生
- 轻量级

**缺点**：
- 仅限 Windows
- 不跨平台

---

### 10.10 AppleScript (macOS)

**适用场景**：macOS 自动化

```applescript
tell application "Safari"
    activate
    open location "https://github.com"
end tell

tell application "System Events"
    keystroke "username"
    keystroke tab
    keystroke "password"
end tell
```

**优点**：
- macOS 原生
- 可访问 Accessibility API

**缺点**：
- 仅限 macOS
- 语法复杂

---

## 11. 方案对比总结

### 11.1 技术方案对比

| 方案 | 平台 | 开源 | LLM 依赖 | 延迟 | 复杂度 |
|------|------|------|----------|------|--------|
| **HTTP 服务 (推荐)** | 全平台 | ✅ | 可选 | ~10ms | 低 |
| MCP Server | 全平台 | ✅ | 可选 | ~50ms | 中 |
| OpenInterpreter | 全平台 | ✅ | 可选 | ~100ms | 高 |
| Agent-S | 全平台 | ✅ | 必须 | ~500ms | 高 |
| UI-TARS | 全平台 | ✅ | 必须 | ~1s | 高 |
| Computer Use | 全平台 | ❌ | 必须 | ~2s | 中 |
| Playwright | Web | ✅ | 不需要 | ~50ms | 低 |
| AutoHotkey | Windows | ✅ | 不需要 | ~1ms | 低 |
| AppleScript | macOS | ✅ | 不需要 | ~1ms | 低 |

### 11.2 场景推荐

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| **生产环境** | HTTP 服务 | 简单、稳定、易调试 |
| **快速原型** | OpenInterpreter | 开箱即用 |
| **高精度** | UI-TARS + HTTP 服务 | Grounding 能力强 |
| **仅 Web** | Playwright | 成熟稳定 |
| **仅 Windows** | AutoHotkey | 原生性能最好 |
| **仅 macOS** | AppleScript | 原生性能最好 |

### 11.3 混合方案

**推荐混合架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                    NuwaClaw Electron                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          GUI Agent HTTP Server (核心)                │    │
│  │          localhost:60174                             │    │
│  │                                                      │    │
│  │  基础能力:                                            │    │
│  │  ├─ screenshot-desktop (截图)                        │    │
│  │  ├─ @nut-tree/nut-js (键鼠)                          │    │
│  │  └─ sharp (图像处理)                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          VLM 服务 (可选)                              │    │
│  │                                                      │    │
│  │  可选后端:                                            │    │
│  │  ├─ Qwen2-VL (阿里云 API / 本地)                      │    │
│  │  ├─ GLM-4V (智谱 API)                                │    │
│  │  ├─ UI-TARS (本地部署)                               │    │
│  │  └─ Claude 3.5 (海外)                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          特定场景适配器 (可选)                         │    │
│  │                                                      │    │
│  │  ├─ Playwright (Web 应用)                            │    │
│  │  ├─ AppleScript (macOS 原生)                         │    │
│  │  └─ AutoHotkey (Windows 原生)                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

---

## 13. Sub-Agent 集成方案 (推荐)

### 13.1 架构设计

**核心思路**：GUI Agent 作为独立子代理运行，主 Agent 通过任务委派方式调用

```
┌─────────────────────────────────────────────────────────────┐
│                    NuwaClaw Electron                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Main Agent (ACP)                             │  │
│  │           claude-code / nuwaxcode                      │  │
│  │                                                        │  │
│  │  职责：                                                │  │
│  │  - 对话、规划                                          │  │
│  │  - 任务分解                                            │  │
│  │  - 委派 GUI 任务给 Sub-Agent                           │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│                          │ Task delegation                   │
│                          │ (HTTP / stdio / file)            │
│                          ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           GUI Sub-Agent                                │  │
│  │           (独立进程)                                    │  │
│  │                                                        │  │
│  │  职责：                                                │  │
│  │  - 屏幕理解 (VLM)                                      │  │
│  │  - GUI 操作 (截图/键鼠)                                │  │
│  │  - 操作验证                                            │  │
│  │  - 结果反馈                                            │  │
│  │                                                        │  │
│  │  能力：                                                │  │
│  │  ├─ ScreenshotService (screenshot-desktop)            │  │
│  │  ├─ InputService (@nut-tree/nut-js)                   │  │
│  │  ├─ VLMAdapter (Qwen/GLM/Claude)                      │  │
│  │  └─ TaskExecutor (任务执行循环)                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 13.2 通信协议

**方案 A：HTTP API**

```typescript
// Main Agent 调用
POST http://localhost:60174/task
{
  "task": "打开浏览器访问 github.com 并登录",
  "context": {
    "username": "myuser",
    "password_env": "GITHUB_PASSWORD"
  }
}

// Sub-Agent 返回
{
  "status": "success",
  "steps": [
    { "action": "screenshot", "result": "captured" },
    { "action": "analyze", "result": "found browser icon at (50, 100)" },
    { "action": "click", "result": "clicked" },
    { "action": "wait", "result": "waited 2s" },
    { "action": "type", "result": "typed URL" },
    { "action": "press_key", "result": "pressed enter" },
    { "action": "screenshot", "result": "captured login page" },
    { "action": "analyze", "result": "found login form" },
    { "action": "type", "result": "typed username" },
    { "action": "type", "result": "typed password" },
    { "action": "click", "result": "clicked login" },
    { "action": "verify", "result": "login successful" }
  ],
  "summary": "成功登录 GitHub"
}
```

**方案 B：stdio JSON-RPC**

```typescript
// Main Agent 启动 Sub-Agent 进程
const subAgent = spawn('node', ['gui-sub-agent.js']);

// 发送任务
subAgent.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'executeTask',
  params: { task: '打开浏览器访问 github.com' }
}) + '\n');

// 接收结果
subAgent.stdout.on('data', (data) => {
  const response = JSON.parse(data);
  // { jsonrpc: '2.0', id: 1, result: { status: 'success', ... } }
});
```

**方案 C：共享文件 (最简单)**

```typescript
// Main Agent 写入任务
fs.writeFileSync('/tmp/gui-task.json', JSON.stringify({
  task: '打开浏览器访问 github.com',
  timeout: 60000,
}));

// Sub-Agent 监听文件变化
fs.watch('/tmp/gui-task.json', async () => {
  const task = JSON.parse(fs.readFileSync('/tmp/gui-task.json'));
  const result = await executeTask(task);
  fs.writeFileSync('/tmp/gui-result.json', JSON.stringify(result));
});

// Main Agent 读取结果
const result = JSON.parse(fs.readFileSync('/tmp/gui-result.json'));
```

### 13.3 Sub-Agent 实现

```typescript
// src/main/services/gui/guiSubAgent.ts

import { EventEmitter } from 'events';
import { ScreenshotService } from './screenshotService';
import { InputService } from './inputService';
import { VLMAdapter } from './vlmAdapter';
import * as http from 'http';
import log from 'electron-log';

export interface GUITask {
  id: string;
  instruction: string;
  context?: Record<string, any>;
  timeout?: number;
}

export interface GUITaskResult {
  id: string;
  status: 'success' | 'failed' | 'timeout';
  steps: GUIStep[];
  summary: string;
  error?: string;
}

export interface GUIStep {
  action: string;
  input?: any;
  result?: any;
  timestamp: number;
}

/**
 * GUI Sub-Agent
 * 
 * 独立的 GUI 操作代理，接收任务指令并执行
 */
export class GUISubAgent extends EventEmitter {
  private screenshot: ScreenshotService;
  private input: InputService;
  private vlm: VLMAdapter;
  private server: http.Server | null = null;
  private port: number;
  
  constructor(config: {
    port: number;
    vlmProvider: string;
    vlmApiKey: string;
  }) {
    super();
    this.port = config.port;
    this.screenshot = new ScreenshotService();
    this.input = new InputService();
    this.vlm = new VLMAdapter({
      provider: config.vlmProvider as any,
      apiKey: config.vlmApiKey,
    });
  }
  
  /**
   * 启动 HTTP 服务
   */
  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/task') {
        const body = await this.parseBody(req);
        const result = await this.executeTask(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    return new Promise((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        log.info(`[GUISubAgent] Started on port ${this.port}`);
        resolve();
      });
    });
  }
  
  /**
   * 执行 GUI 任务
   */
  async executeTask(task: GUITask): Promise<GUITaskResult> {
    const steps: GUIStep[] = [];
    const startTime = Date.now();
    const timeout = task.timeout || 60000;
    
    try {
      log.info(`[GUISubAgent] Executing task: ${task.instruction}`);
      
      // 1. 截图获取当前状态
      const screenshot = await this.screenshot.capture();
      steps.push({
        action: 'screenshot',
        result: { captured: true },
        timestamp: Date.now(),
      });
      
      // 2. VLM 分析，生成动作序列
      const analysis = await this.vlm.analyzeScreen(screenshot, task.instruction);
      steps.push({
        action: 'analyze',
        result: { actions: analysis.actions.length },
        timestamp: Date.now(),
      });
      
      // 3. 执行动作序列
      for (const action of analysis.actions) {
        // 检查超时
        if (Date.now() - startTime > timeout) {
          throw new Error('Task timeout');
        }
        
        // 执行单个动作
        await this.executeAction(action, steps);
        
        // 短暂等待，让界面响应
        await this.sleep(300);
      }
      
      // 4. 验证结果（可选：再次截图确认）
      const finalScreenshot = await this.screenshot.capture();
      steps.push({
        action: 'verify',
        result: { captured: true },
        timestamp: Date.now(),
      });
      
      return {
        id: task.id,
        status: 'success',
        steps,
        summary: analysis.reasoning || '任务完成',
      };
      
    } catch (error: any) {
      log.error('[GUISubAgent] Task failed:', error);
      
      return {
        id: task.id,
        status: 'failed',
        steps,
        summary: '任务失败',
        error: error.message,
      };
    }
  }
  
  /**
   * 执行单个动作
   */
  private async executeAction(action: any, steps: GUIStep[]): Promise<void> {
    const step: GUIStep = {
      action: action.type,
      input: action,
      timestamp: Date.now(),
    };
    
    try {
      switch (action.type) {
        case 'click':
          await this.input.click(action.x, action.y, {
            button: action.button,
            doubleClick: action.doubleClick,
          });
          step.result = { success: true };
          break;
          
        case 'type':
          await this.input.type(action.text);
          step.result = { success: true };
          break;
          
        case 'press_key':
          await this.input.pressKey(action.key);
          step.result = { success: true };
          break;
          
        case 'hotkey':
          await this.input.hotkey(...action.keys);
          step.result = { success: true };
          break;
          
        case 'scroll':
          await this.input.scroll({
            direction: action.direction,
            amount: action.amount,
          });
          step.result = { success: true };
          break;
          
        case 'drag':
          await this.input.drag(
            action.startX, action.startY,
            action.endX, action.endY
          );
          step.result = { success: true };
          break;
          
        case 'wait':
          await this.sleep(action.ms || 1000);
          step.result = { success: true };
          break;
          
        default:
          throw new Error(`Unknown action: ${action.type}`);
      }
    } catch (error: any) {
      step.result = { success: false, error: error.message };
      throw error;
    }
    
    steps.push(step);
    this.emit('step', step);
  }
  
  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          log.info('[GUISubAgent] Stopped');
          resolve();
        });
      });
    }
  }
}
```

### 13.4 Main Agent 集成

```typescript
// src/main/services/engines/unifiedAgent.ts

import { GUISubAgent } from '../gui/guiSubAgent';

export class UnifiedAgentService extends EventEmitter {
  private guiSubAgent: GUISubAgent | null = null;
  
  /**
   * 启动 GUI Sub-Agent
   */
  async startGUISubAgent(config: {
    enabled: boolean;
    port?: number;
    vlmProvider?: string;
    vlmApiKey?: string;
  }): Promise<void> {
    if (!config.enabled) return;
    
    this.guiSubAgent = new GUISubAgent({
      port: config.port || 60174,
      vlmProvider: config.vlmProvider || 'qwen',
      vlmApiKey: config.vlmApiKey || process.env.VLM_API_KEY,
    });
    
    // 监听步骤事件
    this.guiSubAgent.on('step', (step) => {
      this.emit('gui:step', step);
    });
    
    await this.guiSubAgent.start();
    
    // 将 Sub-Agent 信息注入 System Prompt
    this.guiSubAgentPrompt = this.generateSubAgentPrompt();
  }
  
  /**
   * 生成 Sub-Agent System Prompt
   */
  private generateSubAgentPrompt(): string {
    return `
## GUI Sub-Agent

You have access to a GUI Sub-Agent that can perform screen operations.

### Usage

Send a POST request to http://localhost:60174/task with a JSON body:

\`\`\`bash
curl -X POST http://localhost:60174/task \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "task-001",
    "instruction": "打开浏览器访问 github.com",
    "timeout": 60000
  }'
\`\`\`

### Response Format

\`\`\`json
{
  "id": "task-001",
  "status": "success",
  "steps": [...],
  "summary": "任务完成"
}
\`\`\`

### When to Use

- Opening applications
- Navigating websites
- Filling forms
- Clicking buttons
- Any GUI operation

### Notes

- Sub-Agent uses VLM to understand the screen
- Each task has a default 60s timeout
- You can chain multiple operations in one instruction
`;
  }
  
  /**
   * 获取 GUI System Prompt
   */
  getGUISystemPrompt(): string | null {
    return this.guiSubAgentPrompt;
  }
}
```

### 13.5 与现有架构集成

```typescript
// 在 chat 时注入 System Prompt
async chat(request: ComputerChatRequest): Promise<ComputerChatResponse> {
  // ...
  
  let systemPrompt = request.system_prompt || '';
  
  // 注入 GUI Sub-Agent Prompt
  if (this.guiSubAgent) {
    systemPrompt = systemPrompt 
      ? `${systemPrompt}\n\n${this.guiSubAgentPrompt}` 
      : this.guiSubAgentPrompt;
  }
  
  // ...
}
```

---

## 14. Sub-Agent vs 其他方案对比

| 对比项 | HTTP 服务 | Sub-Agent | MCP Server |
|--------|-----------|-----------|------------|
| **职责分离** | 中 | ✅ 高 | 高 |
| **独立演进** | 中 | ✅ 高 | 高 |
| **模型选择** | 无 | ✅ 可用不同模型 | 无 |
| **调试难度** | 低 | 低 | 中 |
| **通信开销** | ~10ms | ~10ms | ~50ms |
| **实现复杂度** | 低 | 中 | 高 |

### Sub-Agent 优势

1. **职责清晰**：Main Agent 负责规划，Sub-Agent 负责执行
2. **独立模型**：GUI 操作可以用专门的 VLM（如 UI-TARS）
3. **隔离性好**：Sub-Agent 崩溃不影响 Main Agent
4. **可扩展**：未来可以添加更多 Sub-Agent（File Agent、Web Agent 等）
5. **易于测试**：Sub-Agent 可独立测试

---

## 15. 总结

### 最终推荐方案

**Sub-Agent 架构 + HTTP 通信**（推荐）

### 三种方案对比

| 方案 | 复杂度 | 灵活性 | 推荐度 |
|------|--------|--------|--------|
| **Sub-Agent** (推荐) | 中 | ✅ 高 | ⭐⭐⭐⭐⭐ |
| HTTP 服务 (简单) | 低 | 中 | ⭐⭐⭐⭐ |
| MCP Server | 高 | 高 | ⭐⭐⭐ |

### 推荐理由

1. **Sub-Agent 架构**
   - 职责清晰：Main Agent 规划，Sub-Agent 执行
   - 可用不同模型：GUI 操作用专用 VLM
   - 隔离性好：崩溃不互相影响
   - 易于测试：Sub-Agent 可独立测试

2. **HTTP 通信**
   - 简单：标准 REST API
   - 调试容易：可用 curl 测试
   - 跨进程：不依赖复杂协议

3. **System Prompt 注入**
   - 灵活：不修改 Agent 代码
   - 可控：可动态开关
   - 透明：Agent 知道有哪些能力

### 实施路线

```
Phase 1 (MVP) ──► HTTP 服务 + 键鼠控制 + System Prompt
    │                    (1 周)
    ▼
Phase 2 (增强) ──► VLM 集成 (Qwen/GLM)
    │                    (3 天)
    ▼
Phase 3 (可选) ──► UI-TARS / 特定适配器
                         (2 天)
```

### 核心依赖

```json
{
  "dependencies": {
    "screenshot-desktop": "^1.15.0",
    "@nut-tree/nut-js": "^4.2.0",
    "sharp": "^0.34.5"
  }
}
```

### 工期

**总计: 1.5-2 周**

### 风险

| 风险 | 缓解措施 |
|------|----------|
| Agent 不理解 curl | 优化 System Prompt，提供示例 |
| VLM 延迟 | 可选功能，不强制使用 |
| 键鼠权限 | 检测并引导用户授权 |

### 下一步

1. ✅ 确定方案：Sub-Agent + HTTP
2. 📝 创建开发任务列表
3. 🔨 实现 Phase 1 MVP
4. 🧪 测试验证
5. 📚 完善文档

---

*文档版本: v3.2*
*最后更新: 2026-03-15*

### 推荐方案

**本地 HTTP 服务 + System Prompt 注入**

### 核心优势

1. **不依赖 MCP** - 使用现有 bash 权限
2. **简单易调试** - 标准 HTTP API
3. **性能好** - 同进程，无通信开销
4. **灵活** - Agent 可组合使用
5. **安全** - Token 认证 + 本地绑定

### 工期

**1.5-2 周**

### 风险

- Agent 需要理解 System Prompt 中的 curl 命令
- 依赖 bash 权限 (但这是 Agent 基本能力)
- VLM 调用有延迟 (可选功能)

---

*文档版本: v3.0*
*最后更新: 2026-03-15*
