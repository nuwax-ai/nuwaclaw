/**
 * MCP 配置模板
 * 预置常用 MCP 服务器配置，方便用户快速添加
 */

export interface McpTemplate {
  id: string;
  name: string;
  description: string;
  category: "file" | "network" | "data" | "ai" | "dev" | "other";
  icon?: string;
  config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  // 需要用户填写的参数（如路径、token 等）
  requiredParams?: {
    key: string;
    label: string;
    placeholder: string;
    type: "text" | "path" | "password";
    defaultValue?: string;
  }[];
}

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "读写本地文件系统",
    category: "file",
    icon: "📁",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "{path}"],
    },
    requiredParams: [
      {
        key: "path",
        label: "文件系统路径",
        placeholder: "/Users/username/workspace",
        type: "path",
        defaultValue: "",
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "访问 GitHub 仓库、Issues、PRs",
    category: "dev",
    icon: "🐙",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "{token}",
      },
    },
    requiredParams: [
      {
        key: "token",
        label: "GitHub Personal Access Token",
        placeholder: "ghp_xxxxxxxxxxxx",
        type: "password",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "发送 Slack 消息、读取频道",
    category: "network",
    icon: "💬",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "{token}",
      },
    },
    requiredParams: [
      {
        key: "token",
        label: "Slack Bot Token",
        placeholder: "xoxb-xxxxxxxxxxxx",
        type: "password",
      },
    ],
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "查询 SQLite 数据库",
    category: "data",
    icon: "🗄️",
    config: {
      command: "uvx",
      args: ["mcp-server-sqlite", "--db-path", "{dbPath}"],
    },
    requiredParams: [
      {
        key: "dbPath",
        label: "数据库文件路径",
        placeholder: "/path/to/database.db",
        type: "path",
      },
    ],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "HTTP 请求工具",
    category: "network",
    icon: "🌐",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "查询 PostgreSQL 数据库",
    category: "data",
    icon: "🐘",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        POSTGRES_CONNECTION_STRING: "{connectionString}",
      },
    },
    requiredParams: [
      {
        key: "connectionString",
        label: "PostgreSQL 连接字符串",
        placeholder: "postgresql://user:password@localhost:5432/dbname",
        type: "password",
      },
    ],
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "浏览器自动化",
    category: "dev",
    icon: "🎭",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    },
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Brave 搜索引擎",
    category: "network",
    icon: "🔍",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: "{apiKey}",
      },
    },
    requiredParams: [
      {
        key: "apiKey",
        label: "Brave Search API Key",
        placeholder: "BSA_xxxxxxxxxxxx",
        type: "password",
      },
    ],
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "地图和地理位置服务",
    category: "network",
    icon: "🗺️",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-google-maps"],
      env: {
        GOOGLE_MAPS_API_KEY: "{apiKey}",
      },
    },
    requiredParams: [
      {
        key: "apiKey",
        label: "Google Maps API Key",
        placeholder: "AIzaSyxxxxxxxxxx",
        type: "password",
      },
    ],
  },
  {
    id: "memory",
    name: "Memory",
    description: "持久化记忆存储",
    category: "ai",
    icon: "🧠",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
  },
];

/**
 * 根据分类获取模板
 */
export function getTemplatesByCategory(category?: string): McpTemplate[] {
  if (!category) return MCP_TEMPLATES;
  return MCP_TEMPLATES.filter((t) => t.category === category);
}

/**
 * 根据 ID 获取模板
 */
export function getTemplateById(id: string): McpTemplate | undefined {
  return MCP_TEMPLATES.find((t) => t.id === id);
}

/**
 * 应用模板参数，生成最终配置
 */
export function applyTemplateParams(
  template: McpTemplate,
  params: Record<string, string>,
): { command: string; args: string[]; env?: Record<string, string> } {
  const config = { ...template.config };

  // 替换 args 中的占位符
  config.args = config.args.map((arg) =>
    arg.replace(/\{(\w+)\}/g, (_, key) => params[key] || ""),
  );

  // 替换 env 中的占位符
  if (config.env) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env)) {
      env[key] = value.replace(
        /\{(\w+)\}/g,
        (_, paramKey) => params[paramKey] || "",
      );
    }
    config.env = env;
  }

  return config;
}
