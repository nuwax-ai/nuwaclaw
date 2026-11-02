---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Agent 自我进化架构 - 存储实现

## 概述

本文档详细描述 Nuwax Agent 记忆存储的实现方案，基于 Markdown 文件格式，提供人类可读、Git 友好、简单可靠的存储机制。

---

## 设计原则

参考 OpenClaw 的 Markdown 存储方案，核心优势：

1. **人类可读** - 直接编辑，无需工具
2. **Git 友好** - 版本控制天然支持
3. **渐进加载** - Frontmatter → Body → References
4. **简单可靠** - 无需数据库，文件系统即存储

---

## 目录结构

```
~/.nuwaclaw/
├── soul/                          # Agent 自我认知
│   ├── soul.md                    # 主灵魂文件
│   ├── principles.md              # 学习到的原则
│   └── anti-patterns.md           # 避免的陷阱
│
├── memory/                        # 记忆存储
│   ├── short-term.md              # 当前会话记忆（每次会话覆盖）
│   ├── successes/                 # 成功经验
│   │   ├── 2024-02-24-parse-json.md
│   │   ├── 2024-02-24-install-tool.md
│   │   └── ...
│   ├── failures/                  # 失败教训
│   │   ├── 2024-02-23-pip-failed.md
│   │   └── ...
│   ├── insights/                  # 洞察
│   │   ├── pattern-uv-better.md
│   │   └── ...
│   └── index.json                 # 检索索引
│
├── skills/                        # 技能库
│   ├── core/                      # 核心技能（内置）
│   │   ├── file-read/SKILL.md
│   │   ├── file-write/SKILL.md
│   │   └── ...
│   └── learned/                   # 学到的技能
│       ├── parse-json/SKILL.md
│       ├── install-uv/SKILL.md
│       └── ...
│
└── evo-map/                       # 进化图谱
    ├── decisions/                 # 决策树
    │   ├── install-python.md
    │   ├── parse-json.md
    │   └── ...
    └── patterns/                  # 模式库
        ├── success-patterns.md
        └── failure-patterns.md
```

---

## 文件格式设计

### 1. Soul.md（灵魂文件）

```markdown
---
name: soul
version: 3
last-updated: 2024-02-24
---

# Soul.md - Agent 自我认知

## 身份
我是 Nuwax Agent，一个可以自我进化的 AI 助手。

## 核心原则
1. 用户目标优先
2. 优先使用验证过的方法
3. 失败时尝试备选方案
4. 记录所有尝试以供学习

## 我的能力
- [x] 文件操作
- [x] 代码执行
- [x] 工具安装
- [x] 自我诊断

## 我的限制
- [ ] 不能写入系统目录
- [ ] 网络下载需要用户确认
- [ ] 资源使用有限制

## 学习到的经验

### 成功模式
- `2024-02-24`: 使用 uv pip 安装 Python 包，98% 成功率
  - 参考: `memory/successes/2024-02-24-install-uv.md`
- `2024-02-24`: 使用 node 内置 JSON 解析，避免 jq 依赖

### 失败教训
- `2024-02-23`: 尝试直接写入 /usr/lib 失败 → 使用工作区

### 技能清单
- `parse-json` - JSON 文件解析（已学会）
- `install-uv` - Python 包安装（已学会）
- `grep-log` - 日志文件分析（已学会）

## 统计数据
- 总任务数: 1,234
- 成功率: 87.5%
- 最常用方法: uv pip install (45次)
- 最省时方法: node JSON parse (平均 0.5s)
```

### 2. 成功记忆文件

`memory/successes/2024-02-24-parse-json.md`:

```markdown
---
type: success
task: parse-json
confidence: 0.98
created: 2024-02-24T10:30:00Z
---

# JSON 文件解析成功案例

## 任务
解析用户指定的 JSON 文件并提取特定字段

## 使用的方案
使用 Node.js 内置 `JSON.parse()` 方法

## 执行步骤
\`\`\`bash
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('${file}', 'utf8')); console.log(JSON.stringify(data, null, 2));"
\`\`\`

## 结果
- 成功解析: `data.json`
- 耗时: 0.5s
- 输出格式正确

## 为什么成功
- Node.js 是 Electron 内置，无需安装
- 不依赖外部工具如 jq
- 处理大文件也很快

## 相关技能
- `skills/learned/parse-json/SKILL.md`
```

### 3. 失败记忆文件

`memory/failures/2024-02-23-pip-failed.md`:

```markdown
---
type: failure
task: install-python-package
created: 2024-02-23T15:20:00Z
---

# pip install 失败案例

## 任务
安装 Python 包 `requests`

## 尝试的方案
\`\`\`bash
pip install requests
\`\`\`

## 失败原因
- `pip: command not found` - 系统 Python 未配置或不存在
- 即使 pip 存在，可能污染系统 Python 环境

## 正确的方案
参考 `evo-map/decisions/install-python.md`，应该使用：
\`\`\`bash
uv pip install requests
\`\`\`

## 学到的教训
- 优先使用 uv（应用内打包）
- 避免使用系统 pip
- 参考 EvoMap 中的决策树

## 相关记录
- 修复后的成功: `memory/successes/2024-02-24-install-uv.md`
```

### 4. 技能文件

`skills/learned/parse-json/SKILL.md`:

```markdown
---
name: parse-json
description: 解析 JSON 文件，提取字段，格式化输出。当需要处理 JSON 文件时使用。
confidence: 0.98
created: 2024-02-24
version: 2
---

# JSON 文件解析技能

## 触发条件
当用户需要：
- 读取 JSON 文件
- 提取 JSON 中的字段
- 格式化 JSON 输出
- 验证 JSON 语法

## 推荐方法

### 方法 1: Node.js（推荐）
\`\`\`bash
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('${file}', 'utf8')); console.log(JSON.stringify(data.${field}, null, 2));"
\`\`\`
- 成功率: 98%
- 优点: Node.js 内置，无需依赖
- 缺点: 简单提取很方便

### 方法 2: jq（备选）
\`\`\`bash
jq '.field' < file.json
\`\`\`
- 成功率: 60%
- 优点: 功能强大
- 缺点: 需要安装 jq

## 常用模式

### 提取单个字段
\`\`\`bash
node -e "console.log(JSON.parse(require('fs').readFileSync('${file}')).${field})"
\`\`\`

### 格式化输出
\`\`\`bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('${file}')), null, 2))"
\`\`\`

## 相关记忆
- 成功案例: `memory/successes/2024-02-24-parse-json.md`
```

### 5. EvoMap 决策文件

`evo-map/decisions/install-python.md`:

```markdown
---
task: install-python-package
last-updated: 2024-02-24
---

# Python 包安装决策

## 决策树

\`\`\`
需要安装 Python 包
    │
    ├─ 方案 A: uv pip install
    │   置信度: 95%
    │   成功率: 98%
    │   预期时间: 5s
    │   证据: 45 次成功 / 1 次失败
    │   推荐: ✅ 首选
    │
    ├─ 方案 B: pip install
    │   置信度: 70%
    │   成功率: 80%
    │   预期时间: 10s
    │   证据: 30 次成功 / 7 次失败
    │   下一步: 若失败 → 切换到 uv
    │
    └─ 方案 C: 系统包管理器
        置信度: 50%
        成功率: 60%
        预期时间: 30s
        证据: 10 次成功 / 8 次失败
        备注: 最后手段，可能需要 sudo
\`\`\`

## 选择逻辑

1. 优先使用 `uv pip install`
2. 如果 uv 不可用，尝试 `pip install`
3. 如果都失败，提示用户手动安装

## 相关记录
- `memory/successes/2024-02-24-install-uv.md`
- `memory/failures/2024-02-23-pip-failed.md`
```

---

## 索引机制

### 简单文件索引

`memory/index.json`:

```json
{
  "successes": [
    {
      "file": "successes/2024-02-24-parse-json.md",
      "task": "parse-json",
      "confidence": 0.98,
      "timestamp": "2024-02-24T10:30:00Z",
      "keywords": ["json", "parse", "node"]
    },
    {
      "file": "successes/2024-02-24-install-uv.md",
      "task": "install-python-package",
      "confidence": 0.95,
      "timestamp": "2024-02-24T09:15:00Z",
      "keywords": ["python", "uv", "install"]
    }
  ],
  "failures": [
    {
      "file": "failures/2024-02-23-pip-failed.md",
      "task": "install-python-package",
      "timestamp": "2024-02-23T15:20:00Z",
      "keywords": ["python", "pip", "failed"]
    }
  ]
}
```

### 索引更新策略

```typescript
// 每次写入记忆后更新索引
async function updateIndex(type: 'successes' | 'failures', filepath: string) {
  const index = await loadIndex();
  const frontmatter = await extractFrontmatter(filepath);

  index[type].push({
    file: filepath,
    task: frontmatter.task,
    confidence: frontmatter.confidence || 0,
    timestamp: frontmatter.created,
    keywords: extractKeywords(frontmatter),
  });

  await fs.writeFile('memory/index.json', JSON.stringify(index, null, 2));
}

// 快速检索：只读索引，不需要遍历文件
async function searchByTask(task: string): Promise<string[]> {
  const index = await loadIndex();
  return index.successes
    .filter(m => m.task === task || m.keywords.includes(task))
    .sort((a, b) => b.confidence - a.confidence)
    .map(m => m.file);
}
```

---

## 读写接口

### 写入（编码）

```typescript
interface MemoryWriter {
  // 写入成功记忆
  writeSuccess(memory: SuccessMemory): Promise<void>;

  // 写入失败记忆
  writeFailure(memory: FailureMemory): Promise<void>;

  // 更新 Soul.md
  updateSoul(update: SoulUpdate): Promise<void>;
}

class MarkdownMemoryWriter implements MemoryWriter {
  async writeSuccess(memory: SuccessMemory): Promise<void> {
    const filename = `memory/successes/${memory.date}-${memory.slug}.md`;
    const content = this.formatSuccessMarkdown(memory);
    await fs.writeFile(filename, content, 'utf-8');

    // 更新索引
    await this.updateIndex('successes', filename);
  }

  private formatSuccessMarkdown(memory: SuccessMemory): string {
    return `---
type: success
task: ${memory.task}
confidence: ${memory.confidence}
created: ${memory.timestamp}
---

# ${memory.title}

## 任务
${memory.description}

## 使用的方案
\`\`\`bash
${memory.command}
\`\`\`

## 结果
${memory.result}

## 为什么成功
${memory.reasoning}

## 相关技能
- ${memory.relatedSkill || '无'}
`;
  }
}
```

### 检索（读取）

```typescript
interface MemoryReader {
  // 语义检索（基于 frontmatter）
  search(query: string): Promise<MemoryFile[]>;

  // 读取特定记忆
  read(path: string): Promise<MemoryContent>;

  // 获取相关决策
  getDecision(task: string): Promise<DecisionNode>;
}

class MarkdownMemoryReader implements MemoryReader {
  async search(query: string): Promise<MemoryFile[]> {
    // 1. 遍历 memory 目录
    const files = await this.getAllMemoryFiles();

    // 2. 读取 frontmatter
    const results: MemoryFile[] = [];
    for (const file of files) {
      const frontmatter = await this.extractFrontmatter(file);

      // 3. 匹配查询
      if (this.matches(query, frontmatter)) {
        results.push({ file, frontmatter });
      }
    }

    // 4. 按置信度/时间排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  private matches(query: string, frontmatter: Frontmatter): boolean {
    const { task, type, keywords } = frontmatter;
    return (
      task?.includes(query) ||
      type === query ||
      keywords?.some((k: string) => k.includes(query))
    );
  }

  async getDecision(task: string): Promise<DecisionNode> {
    const decisionFile = `evo-map/decisions/${this.slugify(task)}.md`;

    if (await fs.exists(decisionFile)) {
      return this.parseDecisionFile(await fs.readFile(decisionFile, 'utf-8'));
    }

    // 回退到通用决策
    return this.getGenericDecision(task);
  }
}
```

---

## 记忆清理策略

```typescript
interface MemoryCleanupPolicy {
  maxShortTermEntries: number;    // 最多 50 条
  maxLongTermEntries: number;     // 最多 1000 条
  maxAge: number;                 // 90 天
  lowConfidenceThreshold: number; // 置信度 < 0.3
}

async function cleanupMemory(policy: MemoryCleanupPolicy): Promise<CleanupResult> {
  const index = await loadIndex();
  const now = Date.now();
  const toDelete: string[] = [];

  // 1. 清理过期的低置信度记忆
  for (const memory of index.successes) {
    const age = now - new Date(memory.timestamp).getTime();
    const ageDays = age / (1000 * 60 * 60 * 24);

    if (ageDays > policy.maxAge || memory.confidence < policy.lowConfidenceThreshold) {
      toDelete.push(memory.file);
    }
  }

  // 2. 限制总数量
  const sorted = [...index.successes].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  if (sorted.length > policy.maxLongTermEntries) {
    const excess = sorted.slice(policy.maxLongTermEntries);
    toDelete.push(...excess.map(m => m.file));
  }

  // 3. 执行删除
  for (const file of toDelete) {
    await fs.unlink(`memory/${file}`);
  }

  // 4. 更新索引
  await rebuildIndex();

  return { deleted: toDelete.length, remaining: index.successes.length - toDelete.length };
}
```

---

## 向量检索（可选升级）

当记忆数量超过 500 条时，可以引入语义向量检索以提升召回精度：

### 升级时机

- **当前阶段**：使用关键词匹配（已实现）
  - 基于 frontmatter 的 `task`、`type`、`keywords` 字段
  - 适用于记忆数量 < 500 条

- **升级阶段**：记忆数量 > 500 条时
  - 引入嵌入向量（embedding）进行语义检索
  - 保持 Markdown 格式不变，向量作为补充索引

### 向量检索方案

```typescript
// 记忆编码时添加嵌入向量
interface EncodedMemory {
  id: string;
  type: 'success' | 'failure' | 'insight';
  embedding?: number[];       // 语义向量（可选）
  context: {
    task: string;
    environment: string;
    constraints: string[];
  };
  // ... 其他字段
}

// 更新后的索引
interface MemoryIndex {
  successes: MemoryIndexEntry[];
  failures: MemoryIndexEntry[];
}

interface MemoryIndexEntry {
  file: string;
  task: string;
  confidence: number;
  timestamp: string;
  keywords: string[];
  embedding?: number[];       // 新增：嵌入向量
}
```

### 检索接口升级

```typescript
class MarkdownMemoryReader implements MemoryReader {
  async search(query: string): Promise<MemoryFile[]> {
    const files = await this.getAllMemoryFiles();

    // 初期：关键词匹配
    const results: MemoryFile[] = [];
    for (const file of files) {
      const frontmatter = await this.extractFrontmatter(file);
      if (this.matchesKeyword(query, frontmatter)) {
        results.push({ file, frontmatter });
      }
    }

    // 后期：记忆 > 500 条时使用向量检索
    if (files.length > 500) {
      const queryEmbedding = await this.generateEmbedding(query);
      return this.searchBySimilarity(queryEmbedding, files);
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  // 语义相似度检索（待实现）
  private async searchBySimilarity(
    queryEmbedding: number[],
    files: string[]
  ): Promise<MemoryFile[]> {
    const results: Array<{ file: string; score: number }> = [];

    for (const file of files) {
      const entry = await this.getIndexEntry(file);
      if (entry.embedding) {
        const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
        results.push({ file, score });
      }
    }

    return results
      .filter(r => r.score > 0.7)  // 相似度阈值
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);               // 返回 top-10
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}
```

### 向量存储

向量可以存储在以下位置：

```
~/.nuwaclaw/
├── memory/
│   ├── index.json              # 原有索引
│   └── embeddings.json         # 新增：向量索引（可选）
│       # 或者使用 SQLite 存储
├── memory.db                   # 新增：SQLite 向量数据库（可选）
```

### 实现优先级

| 阶段 | 记忆数量 | 检索方式 | 优先级 |
|------|----------|----------|--------|
| P0 | < 500 | 关键词匹配 | 已实现 |
| P1 | 500-2000 | 关键词 + 向量混合 | 可选 |
| P2 | > 2000 | 纯向量检索 | 待定 |

---

## 优势对比

| 特性 | Markdown 方案 | 数据库方案 |
|------|---------------|-----------|
| **可读性** | ✅ 人类可读 | ❌ 需要工具 |
| **版本控制** | ✅ Git 友好 | ⚠️ 需要 migration |
| **可移植性** | ✅ 纯文件 | ❌ 依赖软件 |
| **搜索** | ⚠️ 需索引 | ✅ SQL 查询 |
| **复杂度** | ✅ 简单 | ❌ 复杂 |
| **调试** | ✅ 直接查看 | ❌ 需要 query |

---

## 相关文档

- [总览](./OVERVIEW.md) - 产品定位、核心原则
- [核心组件](./COMPONENTS.md) - Memory、Skill Creator、EvoMap、Soul.md
- [循环流程](./LOOP.md) - 完整循环流程、接口定义
- [隔离策略](./ISOLATION.md) - 三区模型、环境变量
