# mcp-proxy

## 项目概述

MCP (Model Context Protocol) 代理服务集合，包含 MCP 代理、文档解析、语音处理、OSS 客户端等功能。

**本地路径**: `vendors/mcp-proxy`

## 目录结构

```
mcp-proxy/
├── Cargo.toml                    # workspace 配置
├── mcp-proxy/                    # MCP 代理服务
│   └── src/
│       ├── main.rs
│       ├── server.rs             # HTTP 服务
│       ├── handler.rs            # 请求处理
│       └── state.rs              # 状态管理
├── document-parser/              # 文档解析
│   └── src/
│       ├── lib.rs
│       ├── pdf.rs
│       ├── office.rs
│       └── parser.rs
├── voice-cli/                    # 语音服务
│   └── src/
│       ├── lib.rs
│       ├── recognize.rs
│       └── synthesize.rs
├── oss-client/                   # OSS 客户端
│   └── src/
│       ├── lib.rs
│       ├── client.rs
│       └── error.rs
├── mcp-common/                   # 共享模块
│   └── src/
│       ├── lib.rs
│       ├── types.rs
│       └── util.rs
└── Cargo.toml
```

## 核心依赖

```toml
[dependencies]
# Web 框架
axum = "0.7"
tokio = { version = "1.0", features = ["full"] }
tower-http = { version = "0.6", features = ["cors", "auth"] }

# MCP 协议
rmcp = "1.0"

# 任务队列
apalis = "1.0"

# 数据库
sqlx = "0.7"
sled = "1.0"

# 网络
reqwest = { version = "0.11", features = ["json"] }
tokio-tungstenite = "0.23"

# 并发
dashmap = "6.0"

# OpenTelemetry
opentelemetry = "0.30"
opentelemetry-otlp = "0.27"

# 文档处理
pdf = "0.8"
calamine = "0.5"  # Excel
```

## 核心模块

### MCP 代理服务

```rust
// mcp-proxy/src/server.rs

pub struct McpProxyServer {
    // MCP 工具注册表
    tools: DashMap<String, Box<dyn McpTool>>,

    // 连接管理
    connections: ConnectionManager,

    // 状态
    state: Arc<McpState>,
}

impl McpProxyServer {
    /// 注册 MCP 工具
    pub fn register_tool<T: McpTool>(&self, tool: T);

    /// 列出所有工具
    pub fn list_tools(&self) -> Vec<ToolInfo>;

    /// 调用工具
    pub async fn call_tool(&self, name: &str, params: Value) -> Result<Value>;
}
```

### 文档解析

```rust
// document-parser/src/parser.rs

pub enum Document {
    Pdf(PdfDocument),
    Word(WordDocument),
    Excel(ExcelDocument),
    Text(TextDocument),
}

pub struct ParseOptions {
    pub max_pages: Option<usize>,
    pub extract_images: bool,
    pub extract_tables: bool,
}

impl DocumentParser {
    /// 解析文档
    pub async fn parse(
        &self,
        path: &Path: ParseOptions,
    ) -> Result,
        options<Document>;

    /// 提取文本
    pub async fn extract_text(&self, doc: &Document) -> Result<String>;
}
```

### 任务队列 (Apolis)

```rust
use apalis::prelude::*;

pub struct JobQueue {
    storage: SqliteStorage<JobData>,
    worker: Worker<SqliteStorage<JobData>>,
}

impl JobQueue {
    pub async fn new(db_path: &str) -> Result<Self> {
        let storage = SqliteStorage::new(db_path);
        storage.setup().await?;

        Ok(Self {
            storage,
            worker: Worker::new(),
        })
    }

    /// 添加任务
    pub async fn enqueue(&self, job: JobData) -> Result<()>;

    /// 处理任务
    pub async fn process_jobs(&self);
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JobData {
    pub id: String,
    pub job_type: JobType,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

pub enum JobType {
    DocumentParse,
    VoiceRecognize,
    VoiceSynthesize,
    McpRequest,
}
```

## 使用示例

```rust
use mcp_proxy::McpProxyServer;

#[tokio::main]
async fn main() -> Result<()> {
    let server = McpProxyServer::new();

    // 注册自定义工具
    server.register_tool(SearchTool);
    server.register_tool(FileTool);

    // 启动 HTTP 服务
    let app = axum::Router::new()
        .route("/tools", axum::routing::get(list_tools))
        .route("/tools/:name/call", axum::routing::post(call_tool))
        .with_state(server);

    axum::Server::bind(&"0.0.0.0:3000".parse()?)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}
```

## 在本项目中的使用

用于提供 MCP 服务能力，支持管理端的 MCP 工具调用：

```
agent-server-admin (管理端)
    │
    ├── MCP 工具调用 --> mcp-proxy
    │                      │
    │                      ├── 文档解析
    │                      ├── 语音处理
    │                      └── OSS 存储
    │
    └── SSE 响应 <---------
```

## gRPC 服务定义

```protobuf
service McpProxyService {
    // 列出可用工具
    rpc ListTools(ListToolsRequest) returns (ListToolsResponse);

    // 调用工具
    rpc CallTool(CallToolRequest) returns (CallToolResponse);

    // 订阅工具执行进度
    rpc Subscribe(SubscribeRequest) returns (stream ProgressEvent);
}
```
