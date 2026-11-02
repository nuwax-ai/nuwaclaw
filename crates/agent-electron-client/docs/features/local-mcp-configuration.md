# 本地 MCP 配置特性实现方案

## 架构分析

### 当前架构流程

```
┌─────────────────────────────────────────────────────────────┐
│                    ACP 协议请求                              │
│                   (来自 GUI Agent Server)                    │
├─────────────────────────────────────────────────────────────┤
│  request.agent_config.context_servers                        │
│       ↓                                                      │
│  unifiedAgent.ensureEngineForRequest()                       │
│       ↓                                                      │
│  mcp.syncMcpConfigToProxyAndReload()                        │
│       ↓                                                      │
│  mcpProxyManager.getAgentMcpConfig()                        │
│       ↓                                                      │
│  通过 engine.init() 传递给 ACP agent                          │
└─────────────────────────────────────────────────────────────┘
```

### 目标架构

```
                    ┌─────────────┐
                    │  用户界面    │
                    │ 配置 MCP 服务器 │
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │  SQLite     │
                    │ 持久化存储   │
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │ 本地 MCP 配置  │ ← 用户启用的服务器
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │  合并配置    │ ← 合并到 ACP 请求
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │  ACP agent  │ ← 最终传递给 agent
                    └─────────────┘
```

---

## 实现方案

### 一、数据模型设计

```typescript
// 本地 MCP 服务器配置类型
interface LocalMcpServer {
  id: string;                    // 唯一标识符
  name: string;                  // 显示名称
  command?: string;             // 对于 stdio 服务器
  args?: string[];
  env?: Record<string, string>;
  url?: string;                 // 对于远程服务器
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
  authToken?: string;
  enabled: boolean;             // 用户可启用/禁用
  allowTools?: string[];       // 工具白名单
  denyTools?: string[];        // 工具黑名单
  toolCount?: number;          // 缓存的工具数量
  tools?: McpToolInfo[];       // 发现的工具列表
  lastUpdated?: number;        // 时间戳
  source?: "user" | "builtin"; // 分类用
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: object;
  annotations?: object;
}
```

---

### 二、服务层实现

创建 `src/main/services/packages/localMcpService.ts`:

```typescript
import { getDb } from "../../db";
import type { McpServerEntry } from "./mcp";

export interface LocalMcpServer {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
  authToken?: string;
  enabled: boolean;
  allowTools?: string[];
  denyTools?: string[];
  toolCount?: number;
  tools?: McpToolInfo[];
  lastUpdated?: number;
  source?: "user" | "builtin";
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: object;
  annotations?: object;
}

class LocalMcpService {
  /**
   * 获取所有本地 MCP 服务器
   */
  getLocalMcpServers(): LocalMcpServer[] {
    const db = getDb();
    if (!db) return [];
    
    const result = db
      .prepare("SELECT * FROM local_mcp_servers ORDER BY name")
      .all() as any[];
    
    return result.map((row) => this.parseRow(row));
  }

  /**
   * 根据 ID 获取单个服务器
   */
  getLocalMcpServer(id: string): LocalMcpServer | undefined {
    const db = getDb();
    if (!db) return undefined;
    
    const row = db
      .prepare("SELECT * FROM local_mcp_servers WHERE id = ?")
      .get() as any;
    
    return row ? this.parseRow(row) : undefined;
  }

  /**
   * 添加或更新本地 MCP 服务器
   */
  upsertLocalMcpServer(server: LocalMcpServer): void {
    const db = getDb();
    if (!db) return;
    
    db.prepare(`
      INSERT OR REPLACE INTO local_mcp_servers 
      (id, name, command, args, env, url, transport, headers, auth_token, 
       enabled, allow_tools, deny_tools, tool_count, tools, last_updated, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      server.id,
      server.name,
      server.command || null,
      JSON.stringify(server.args),
      JSON.stringify(server.env),
      server.url || null,
      server.transport || null,
      JSON.stringify(server.headers),
      server.authToken || null,
      server.enabled ? 1 : 0,
      JSON.stringify(server.allowTools),
      JSON.stringify(server.denyTools),
      server.toolCount || 0,
      JSON.stringify(server.tools),
      Date.now(),
      server.source || "user"
    );
  }

  /**
   * 删除本地 MCP 服务器
   */
  removeLocalMcpServer(id: string): void {
    const db = getDb();
    if (!db) return;
    
    db.prepare("DELETE FROM local_mcp_servers WHERE id = ?").run(id);
  }

  /**
   * 启用/禁用本地 MCP 服务器
   */
  toggleLocalMcpServer(id: string, enabled: boolean): void {
    const db = getDb();
    if (!db) return;
    
    db.prepare("UPDATE local_mcp_servers SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
  }

  /**
   * 更新已发现的工具
   */
  updateServerTools(
    id: string,
    tools: McpToolInfo[],
    toolCount: number,
  ): void {
    const db = getDb();
    if (!db) return;
    
    db.prepare(`
      UPDATE local_mcp_servers 
      SET tools = ?, tool_count = ?
      WHERE id = ?
    `).run(JSON.stringify(tools), toolCount, id);
  }

  /**
   * 获取启用的服务器，转换为 McpServerEntry 格式
   */
  getEnabledServersAsEntries(): Record<string, McpServerEntry> {
    const servers = this.getLocalMcpServers();
    const result: Record<string, McpServerEntry> = {};
    
    for (const server of servers) {
      if (!server.enabled) continue;
      
      if (server.url) {
        // 远程服务器
        result[server.name] = {
          url: server.url,
          transport: server.transport,
          headers: server.headers,
          authToken: server.authToken,
          allowTools: server.allowTools,
          denyTools: server.denyTools,
        } as McpServerEntry;
      } else if (server.command) {
        // Stdio 服务器
        result[server.name] = {
          command: server.command,
          args: server.args,
          env: server.env,
          allowTools: server.allowTools,
          denyTools: server.denyTools,
        } as McpServerEntry;
      }
    }
    
    return result;
  }

  /**
   * 解析数据库行
   */
  private parseRow(row: any): LocalMcpServer {
    return {
      id: row.id,
      name: row.name,
      command: row.command,
      args: row.args ? JSON.parse(row.args) : [],
      env: row.env ? JSON.parse(row.env) : {},
      url: row.url,
      transport: row.transport,
      headers: row.headers ? JSON.parse(row.headers) : {},
      authToken: row.authToken,
      enabled: row.enabled === 1,
      allowTools: row.allow_tools ? JSON.parse(row.allow_tools) : [],
      denyTools: row.deny_tools ? JSON.parse(row.deny_tools) : [],
      toolCount: row.tool_count,
      tools: row.tools ? JSON.parse(row.tools) : [],
      lastUpdated: row.last_updated,
      source: row.source,
    };
  }
}

export const localMcpService = new LocalMcpService();
```

---

### 三、数据库迁移

创建 `src/main/db/migrations/003-add-local-mcp-servers.ts`:

```typescript
export const migration = (db: any) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT,
      args TEXT,
      env TEXT,
      url TEXT,
      transport TEXT,
      headers TEXT,
      auth_token TEXT,
      enabled INTEGER DEFAULT 1,
      allow_tools TEXT,
      deny_tools TEXT,
      tool_count INTEGER DEFAULT 0,
      tools TEXT,
      last_updated INTEGER,
      source TEXT DEFAULT 'user'
    )
  `);
  
  // 创建索引以加速查询
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_local_mcp_enabled 
    ON local_mcp_servers(enabled)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_local_mcp_source 
    ON local_mcp_servers(source)
  `);
};
```

在 `src/main/db/index.ts` 中注册迁移:

```typescript
import { migration as m003 } from "./migrations/003-add-local-mcp-servers";

// 在迁移列表中添加
const migrations = [
  // ... 现有迁移
  { id: "003-add-local-mcp-servers", fn: m003 },
];
```

---

### 四、IPC 处理器

创建 `src/main/ipc/handlers/mcp-local.ts`:

```typescript
import { ipcMain } from "electron";
import { localMcpService, type LocalMcpServer } from "../../services/packages/localMcpService";

export function registerMcpLocalHandlers(): void {
  // 获取所有服务器列表
  ipcMain.handle("mcp-local:list", () => {
    return localMcpService.getLocalMcpServers();
  });

  // 获取单个服务器
  ipcMain.handle("mcp-local:get", (_, id: string) => {
    return localMcpService.getLocalMcpServer(id);
  });

  // 添加新服务器
  ipcMain.handle("mcp-local:add", (_, server: LocalMcpServer) => {
    // 生成 UUID 如果没有提供
    if (!server.id) {
      server.id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    localMcpService.upsertLocalMcpServer(server);
    return server;
  });

  // 更新服务器
  ipcMain.handle("mcp-local:update", (_, server: LocalMcpServer) => {
    localMcpService.upsertLocalMcpServer(server);
    return server;
  });

  // 删除服务器
  ipcMain.handle("mcp-local:remove", (_, id: string) => {
    localMcpService.removeLocalMcpServer(id);
  });

  // 切换启用/禁用状态
  ipcMain.handle("mcp-local:toggle", (_, id: string, enabled: boolean) => {
    localMcpService.toggleLocalMcpServer(id, enabled);
  });

  // 获取已启用的服务器
  ipcMain.handle("mcp-local:get-enabled", () => {
    const servers = localMcpService.getLocalMcpServers();
    return servers.filter((s) => s.enabled);
  });
}
```

在主进程入口注册:

```typescript
// src/main/main.ts 或类似文件
import { registerMcpLocalHandlers } from "./ipc/handlers/mcp-local";

registerMcpLocalHandlers();
```

---

### 五、Preload 脚本扩展

添加 TypeScript 类型声明到 preload:

```typescript
// src/main/preload.ts

contextBridge.exposeInMainWorld("electron", {
  // ... 现有 API
  
  mcpLocal: {
    list: () => ipcRenderer.invoke("mcp-local:list"),
    get: (id: string) => ipcRenderer.invoke("mcp-local:get", id),
    add: (server: LocalMcpServer) =>
      ipcRenderer.invoke("mcp-local:add", server),
    update: (server: LocalMcpServer) =>
      ipcRenderer.invoke("mcp-local:update", server),
    remove: (id: string) => ipcRenderer.invoke("mcp-local:remove", id),
    toggle: (
      id: string,
      enabled: boolean,
    ) => ipcRenderer.invoke("mcp-local:toggle", id, enabled),
    getEnabled: () => ipcRenderer.invoke("mcp-local:get-enabled"),
  },
});
```

添加全局类型声明:

```typescript
// src/types/global.d.ts

interface ElectronAPI {
  // ... 现有接口
  
  mcpLocal: {
    list: () => Promise<LocalMcpServer[]>;
    get: (id: string) => Promise<LocalMcpServer | undefined>;
    add: (server: LocalMcpServer) => Promise<LocalMcpServer>;
    update: (server: LocalMcpServer) => Promise<LocalMcpServer>;
    remove: (id: string) => Promise<void>;
    toggle: (id: string, enabled: boolean) => Promise<void>;
    getEnabled: () => Promise<LocalMcpServer[]>;
  };
}

interface LocalMcpServer {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
  authToken?: string;
  enabled: boolean;
  allowTools?: string[];
  denyTools?: string[];
  toolCount?: number;
  tools?: McpToolInfo[];
  lastUpdated?: number;
  source?: "user" | "builtin";
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: object;
  annotations?: object;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
```

---

### 六、UI 组件

创建 `src/components/LocalMcpSettings.tsx`:

```typescript
import React, { useState, useEffect } from "react";
import { Column, Row, Button, Card, SearchInput, Switch, Icon } from "@components/ui";
import type { LocalMcpServer } from "@shared/types";

export const LocalMcpSettings: React.FC = () => {
  const [servers, setServers] = useState<LocalMcpServer[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // 加载服务器列表
  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    const list = await window.electron.mcpLocal.list();
    setServers(list);
  };

  // 处理启用/禁用切换
  const handleToggle = async (id: string, enabled: boolean) => {
    await window.electron.mcpLocal.toggle(id, enabled);
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
    );
  };

  // 处理删除
  const handleDelete = async (id: string) => {
    if (window.confirm("确定要删除这个 MCP 服务器吗？")) {
      await window.electron.mcpLocal.remove(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    }
  };

  // 过滤服务器
  const filteredServers = servers.filter((server) => {
    const query = searchTerm.toLowerCase();
    return (
      server.name.toLowerCase().includes(query) ||
      server.command?.toLowerCase().includes(query) ||
      server.url?.toLowerCase().includes(query)
    );
  });

  return (
    <Column gap={16} className="mcp-settings">
      {/* 标题栏 */}
      <Row justify="space-between" align="center">
        <h2>本地 MCP 服务器</h2>
        <Button icon="plus" onClick={() => setIsAdding(true)}>
          添加服务器
        </Button>
      </Row>

      {/* 搜索框 */}
      <SearchInput
        placeholder="搜索服务器..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {/* 服务器列表 */}
      <Column gap={8}>
        {filteredServers.length === 0 ? (
          <Card padding={24}>
            <p style={{ color: "#888", textAlign: "center" }}>
              {searchTerm
                ? "未找到匹配的服务器"
                : "暂无服务器，点击上方按钮添加"}
            </p>
          </Card>
        ) : (
          filteredServers.map((server) => (
            <Card key={server.id} padding={12} className="mcp-server-card">
              <Row justify="space-between" align="flex-start">
                <div style={{ flex: 1 }}>
                  <Row align="center" gap={8} mb={4}>
                    <h3 style={{ margin: 0 }}>{server.name}</h3>
                    {server.source === "builtin" && (
                      <span className="badge badge-built-in">内置</span>
                    )}
                  </Row>

                  {/* 服务器信息 */}
                  <div style={{ fontSize: "12px", color: "#666" }}>
                    {server.command ? (
                      <code>{server.command}</code>
                    ) : (
                      <span>{server.url}</span>
                    )}
                  </div>

                  {/* 工具统计 */}
                  {server.toolCount ? (
                    <div style={{ marginTop: 4 }}>
                      <span className="tool-count">{server.toolCount} 个工具</span>
                    </div>
                  ) : null}

                  {/* 工具列表预览 */}
                  {server.tools && server.tools.length > 0 ? (
                    <div className="tools-preview" style={{ marginTop: 8 }}>
                      <small>工具：</small>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {server.tools.slice(0, 5).map((tool) => (
                          <span key={tool.name} className="tool-tag">
                            {tool.name}
                          </span>
                        ))}
                        {server.tools.length > 5 && (
                          <span className="tool-tag">
                            +{server.tools.length - 5}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* 操作区 */}
                <Row gap={8} align="center">
                  <div className="server-status">
                    {server.enabled ? (
                      <Icon name="check-circle" color="green" />
                    ) : (
                      <Icon name="circle" color="gray" />
                    )}
                  </div>
                  <Switch
                    checked={server.enabled}
                    onChange={(checked) =>
                      handleToggle(server.id, checked)
                    }
                  />
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => handleDelete(server.id)}
                  >
                    删除
                  </Button>
                </Row>
              </Row>
            </Card>
          ))
        )}
      </Column>

      {/* 添加服务器模态框 */}
      {isAdding && <AddServerModal onClose={() => setIsAdding(false)} />}
    </Column>
  );
};

// 添加服务器模态框
const AddServerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");

  const handleSubmit = async () => {
    if (!name) return alert("请输入服务器名称");

    await window.electron.mcpLocal.add({
      name,
      command: command || undefined,
      args: args
        ? args
            .split(" ")
            .filter((a) => a.trim())
            .map((a) => a.trim())
        : undefined,
      url: url || undefined,
      enabled: true,
    });

    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>添加 MCP 服务器</h3>

        <div className="form-group">
          <label>服务器名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-mcp-server"
          />
        </div>

        <div className="form-group">
          <label>类型</label>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                name="type"
                value="stdio"
                checked={!url}
                onChange={() => setUrl("")}
              />
              Stdio (本地命令)
            </label>
            <label>
              <input
                type="radio"
                name="type"
                value="remote"
                checked={!!url}
                onChange={() => setCommand("")}
              />
              Remote (HTTP URL)
            </label>
          </div>
        </div>

        {!url ? (
          <div className="form-group">
            <label>命令 *</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y mcp-server-github"
            />
            <label style={{ marginTop: 8, display: "block" }}>
              参数 (可选)
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--token xxx"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
        ) : (
          <div className="form-group">
            <label>URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3001/mcp"
            />
          </div>
        )}

        <Row gap={8} justify="flex-end" mt={16}>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button primary onClick={handleSubmit}>
            添加
          </Button>
        </Row>
      </div>
    </div>
  );
};
```

---

### 七、集成到 ACP 协议流程

修改 `crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts`:

在 `ensureEngineForRequest` 方法中，在获取 freshMcpServers 之后，添加本地 MCP 配置的合并:

```typescript
// ... 在 existing code 中，获取 freshMcpServers 之后

// ==================== 新增代码开始 ====================
// 合并本地 MCP 配置 (启用的服务器)
const localMcpEntries = localMcpService.getEnabledServersAsEntries();
if (Object.keys(localMcpEntries).length > 0) {
  log.info(
    `[UnifiedAgent] 📚 Merging ${Object.keys(localMcpEntries).length} local MCP servers`,
  );

  // 将本地 MCP 同步到 proxy
  await syncMcpConfigToProxyAndReload(localMcpEntries);

  // 合并到 freshMcpServers
  freshMcpServers = {
    ...(freshMcpServers || {}),
    ...localMcpEntries,
  };
}
// ==================== 新增代码结束 ====================

// ... existing code continues
```

---

## 总结

### 需要创建/修改的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/services/packages/localMcpService.ts` | 新建 | 本地 MCP 服务层 |
| `src/main/db/migrations/003-add-local-mcp-servers.ts` | 新建 | 数据库迁移 |
| `src/main/ipc/handlers/mcp-local.ts` | 新建 | IPC 处理器 |
| `src/components/LocalMcpSettings.tsx` | 新建 | UI 组件 |
| `src/main/preload.ts` | 修改 | 添加 mcpLocal API 暴露 |
| `src/types/global.d.ts` | 修改 | 添加 TypeScript 类型 |
| `crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts` | 修改 | 合并本地 MCP 到 ACP 配置 |
| `src/main/db/index.ts` | 修改 | 注册迁移 |

### 核心流程

```
用户配置 MCP 服务器
       ↓
  存储到 SQLite
       ↓
用户启用/禁用
       ↓
获取启用的服务器
       ↓
合并到 ACP 请求配置
       ↓
通过 proxy 传递给 agent
```

### 特性清单

- ✅ 本地 MCP 服务器配置
- ✅ SQLite 持久化
- ✅ 启用/禁用控制
- ✅ 支持 stdio 和 remote 两种类型
- ✅ 自动合并到 ACP 协议配置
- ✅ 与现有 MCP proxy 架构兼容

---

## 后续优化方向

1. **工具发现功能**
   - 实现 `mcp-local:fetch-tools` IPC 处理器
   - 支持从配置的 MCP 服务器获取工具列表
   - 缓存工具信息到数据库

2. **工具白名单/黑名单**
   - 实现 `allowTools` 和 `denyTools` 配置
   - 在 UI 中提供工具选择界面

3. **预设服务器模板**
   - 添加常用 MCP 服务器预设
   - 一键导入配置

4. **服务器健康检查**
   - 定期检查 MCP 服务器是否可用
   - 显示连接状态

5. **配置导入/导出**
   - 支持将 MCP 配置导出为 JSON
   - 支持从 JSON 导入配置

---

*文档创建时间：2026-04-22*
*最后更新：2026-04-22*
