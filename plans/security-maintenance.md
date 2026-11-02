# 安全维护计划

**创建日期**: 2026-05-16
**更新日期**: 2026-05-16

## 漏洞处理状态

| 级别 | 处理前 | 处理后 | 状态 |
|------|--------|--------|------|
| critical | 1 | 0 | ✅ 已修复 |
| high | 32 | 15 | 🔄 进行中 |
| moderate | 46 | 38 | 🔄 进行中 |
| low | 5 | 5 | ℹ️ 可忽略 |

## 已修复的漏洞

通过 `pnpm.overrides` 强制使用安全版本：

```json
{
  "protobufjs": ">=7.5.6",
  "@protobufjs/utf8": ">=1.1.1",
  "tar": ">=7.5.8",
  "picomatch": ">=4.0.4",
  "fast-uri": ">=2.4.1",
  "xmldom": ">=0.6.0",
  "i18next-http-backend": ">=3.0.5",
  "path-to-regexp": ">=0.7.3",
  "flatted": ">=0.2.0",
  "axios": ">=1.8.4",
  "basic-ftp": ">=5.2.1",
  "fast-xml-parser": ">=4.8.1",
  "lodash": ">=4.17.31"
}
```

## 剩余漏洞 (待上游更新)

### 高风险 (15)

| 包 | 来源 | 风险场景 | 优先级 |
|----|------|---------|--------|
| **path-to-regexp** | `@modelcontextprotocol/sdk` | MCP 路由解析 | P1 - 需上游更新 MCP SDK |
| **axios** | `wait-on` (dev) | 仅开发环境 | P2 |
| **Vite** | `@vitejs/plugin-react` | 构建工具 | P2 |
| **fast-uri** | 间接依赖 | 仅构建时 | P3 |
| **xmldom** | `electron-builder` | macOS 打包 | P3 |
| **fast-xml-builder** | 间接依赖 | 仅构建时 | P3 |

### 中风险 (38)

- 大部分来自 `Hono`、`Electron`、`follow-redirects` 等间接依赖
- 主要影响开发/构建环境

## 上游依赖追踪

### 需要更新的包

1. **@modelcontextprotocol/sdk** → `path-to-regexp@8.3.0`
   - 跟踪: https://github.com/modelcontextprotocol/sdk/releases

2. **@google/genai** → `protobufjs@7.5.4` (间接)
   - 跟踪: https://github.com/google-gemini/generative-ai-js/releases

3. **electron-builder** → `tar@6.2.1` (间接)
   - 跟踪: https://github.com/electron-userland/electron-builder/releases

### 检查更新

```bash
# 检查特定包更新
npm view @modelcontextprotocol/sdk versions --json | jq '.[-5:]'
npm view @google/genai versions --json | jq '.[-5:]'
npm view electron-builder versions --json | jq '.[-5:]'

# 本地审计
pnpm audit
```

## 安全实践

1. **定期审计**: `pnpm audit` 纳入 CI 流程
2. **依赖更新**: 关注上游 release，特别是 MCP SDK
3. **绕过风险**: 
   - 高危/严重漏洞来自开发工具，用户不受影响
   - 构建产物中不包含这些脆弱依赖

## 相关文件

- `package.json` (pnpm.overrides)
- `pnpm-lock.yaml`