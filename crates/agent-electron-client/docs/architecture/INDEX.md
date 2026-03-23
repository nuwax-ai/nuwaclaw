---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Agent 自我进化架构 - 文档索引

> 本目录包含 Nuwax Agent 自我进化系统的完整架构设计文档。

---

## 快速导航

### 核心文档

| 文档 | 描述 | 优先级 |
|------|------|--------|
| [总览](./OVERVIEW.md) | 产品定位、核心原则、系统架构图 | P0 |
| [核心组件](./COMPONENTS.md) | Memory、Skill Creator、EvoMap、Soul.md | P0 |
| [循环流程](./LOOP.md) | 七层循环、接口定义、数据流 | P0 |
| [存储实现](./STORAGE.md) | Markdown 格式、索引机制、读写接口 | P0 |
| [隔离策略](./ISOLATION.md) | 三区模型、环境变量、安全边界 | P0 |

### 功能文档

| 文档 | 描述 | 类型 |
|------|------|------|
| [Quick Init](./QUICK-INIT.md) | 快捷初始化（nuwaclaw.json / 环境变量） | stable |
| [初始化依赖版本固定与安装/升级](./dependency-version-pinning.md) | installVersion、升级同步、文案、尊重已安装版本不降级 | stable |
| [Auto Update](./auto-update.md) | 自动更新机制 | design |
| [认证机制与 SavedKey 生命周期](./auth-savedkey-lifecycle.md) | savedKey 设计、多账号隔离、退出登录与服务联动规则 | stable |
| [ACP 引擎性能优化](./ACP-ENGINE-PERF-OPTIMIZATION.md) | 引擎预热池、SDK 预加载、SSE 缓冲，降低 /computer/chat 首包延迟 | stable |
| [内嵌 Webview 与 Cookie 同步](./embedded-webview-cookie-sync.md) | 会话页面内嵌 webview + reg token 自动同步 httpOnly cookie 免登录 | stable |

### 参考文档

| 文档 | 描述 | 类型 |
|------|------|------|
| [OpenClaw 参考](./REF-OPENCLAW.md) | openclaw 架构分析与改进建议 | reference |
| [运行时环境配置](./RUNTIME-ENV-PROFILES.md) | strict/compat 环境配置策略 | design |

### 支持文档

| 文档 | 描述 |
|------|------|
| [签名指南](../release/SIGNING.md) | 应用签名与公证 |
| [安全审查](../reviews/SECURITY-REVIEW.md) | 安全性审查清单 |
| [日志规范](../operations/LOGGING.md) | 日志记录标准 |
| [审查记录](../reviews/REVIEW-2026-02.md) | 2026年2月架构审查记录 |

---

## 文档关系图

```
                        ARCHITECTURE-INDEX.md (本文档)
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
  ARCHITECTURE-OVERVIEW.md  ARCHITECTURE-COMPONENTS.md  ARCHITECTURE-ISOLATION.md
        │                           │                           │
        │         ┌─────────────────┼─────────────────┐         │
        │         │                 │                 │         │
        ▼         ▼                 ▼                 ▼         ▼
  ARCHITECTURE-LOOP.md    ARCHITECTURE-STORAGE.md  ARCHITECTURE-REF-OPENCLAW.md
        │                 │                           │
        │                 │                           │
        ▼                 ▼                           ▼
  ARCHITECTURE-RUNTIME-ENV-PROFILES.md
```

---

## 阅读顺序建议

### 新手入门

1. **[总览](./OVERVIEW.md)** - 了解产品定位和核心原则
2. **[核心组件](./COMPONENTS.md)** - 理解四大核心组件
3. **[循环流程](./LOOP.md)** - 掌握完整循环流程
4. **[存储实现](./STORAGE.md)** - 了解数据存储方式

### 架构师/高级开发者

1. **[总览](./OVERVIEW.md)** - 快速回顾
2. **[隔离策略](./ISOLATION.md)** - 理解安全边界
3. **[OpenClaw 参考](./REF-OPENCLAW.md)** - 参考优秀设计
4. **[运行时环境配置](./RUNTIME-ENV-PROFILES.md)** - 环境配置细节

### 运维/安全工程师

1. **[隔离策略](./ISOLATION.md)** - 安全隔离机制
2. **[安全审查](../reviews/SECURITY-REVIEW.md)** - 安全检查清单
3. **[签名指南](../release/SIGNING.md)** - 应用签名流程
4. **[日志规范](../operations/LOGGING.md)** - 日志审计要求

---

## 版本信息

| 文档 | 版本 | 最后更新 |
|------|------|----------|
| ARCHITECTURE-INDEX.md | 1.0 | 2026-02-24 |
| ARCHITECTURE-OVERVIEW.md | - | - |
| ARCHITECTURE-COMPONENTS.md | - | - |
| ARCHITECTURE-LOOP.md | - | - |
| ARCHITECTURE-STORAGE.md | - | - |
| ARCHITECTURE-ISOLATION.md | - | - |
| ARCHITECTURE-REF-OPENCLAW.md | 2.3 | 2026-02-24 |
| ARCHITECTURE-RUNTIME-ENV-PROFILES.md | - | 2026-02-24 |
| auth-savedkey-lifecycle.md | 1.0 | 2026-03-06 |
| embedded-webview-cookie-sync.md | 1.0 | 2026-03-12 |

---

## 贡献指南

### 文档更新规范

所有架构文档应遵循以下规范：

1. **版本信息** - 每个文档顶部包含 frontmatter
   ```yaml
   ---
   version: 1.0
   last-updated: YYYY-MM-DD
   status: design | draft | stable
   ---
   ```

2. **目录结构** - 使用一致的章节结构
   ```markdown
   ## 概述
   ## 核心内容
   ## 相关文档
   ```

3. **代码示例** - 使用语法高亮和详细注释
   ```typescript
   // 接口定义
   interface Example {
     // 说明
   }
   ```

4. **交叉引用** - 使用相对路径链接其他文档
   ```markdown
   - [总览](./OVERVIEW.md)
   ```

### 文档状态说明

| 状态 | 说明 |
|------|------|
| `draft` | 草稿，内容可能大幅变更 |
| `design` | 设计阶段，基本稳定但可能调整 |
| `stable` | 稳定版本，与实现一致 |

---

## TODO

- [ ] 为所有 ARCHITECTURE-*.md 文档添加版本 frontmatter
- [ ] 补充 IMPLEMENTATION.md 实施指南
- [ ] 添加 API.md 接口文档
- [ ] 创建 CHANGELOG.md 变更记录

---

*本文档由架构维护者负责更新*
*如有疑问，请查阅具体文档或联系架构团队*
