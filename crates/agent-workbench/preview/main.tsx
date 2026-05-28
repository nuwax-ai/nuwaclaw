/**
 * Markdown rendering preview page.
 *
 * Run with:  cd crates/agent-workbench && npx vite --config vite.preview.ts
 *
 * Covers every rendering type supported by MarkdownRenderer + ChatMessage:
 *   1. Basic markdown (headings, bold, italic, lists, links, inline code, blockquote, hr)
 *   2. Code blocks (TypeScript, Python, Bash, JSON)
 *   3. Math formulas (KaTeX inline + display)
 *   4. Mermaid diagrams
 *   5. Thinking trace (metadata.thinking)
 *   6. Tool execution / RunOver (metadata.runOverSteps)
 *   7. Tables (GFM)
 *   8. Images (OptimizedImage + lightbox)
 *   9. Task result cards
 *  10. Inline <markdown-custom-process> tags
 *  11. Permission card
 *  12. Error state
 *  13. Streaming indicator
 *
 * A toolbar at the top toggles between workbench default tokens and nuwax's
 * actual Ant Design ConfigProvider values, so you can spot style drift.
 */

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../src/styles.css';

import { ChatMessage, PermissionCard } from '../src/components/OpenApp/Message';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';
import type { RunOverStep } from '../src/components/MarkdownRenderer';
import { zh } from '../src/components/OpenApp/labels';
import type { WorkbenchAgentDetail, WorkbenchMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Mock agent
// ---------------------------------------------------------------------------

const mockAgent: WorkbenchAgentDetail = {
  id: 'agent-preview',
  name: 'Nuwax Agent',
  description: 'Markdown rendering preview agent',
  type: 'TaskAgent',
  variables: [],
  customPageMenus: [],
  guidQuestionDtos: [],
};

// ---------------------------------------------------------------------------
// Sample messages — one per rendering type
// ---------------------------------------------------------------------------

const messages: Array<{ label: string; message: WorkbenchMessage }> = [
  {
    label: '1. 用户消息',
    message: {
      id: 'u1',
      conversationId: 'preview',
      role: 'user',
      content: '帮我分析这段 TypeScript 代码的性能问题，特别是内存泄漏方面。',
      createdAt: '2026-05-28T10:00:00Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '2. 基础 Markdown（标题/粗体/斜体/列表/链接/行内代码/引用/分割线）',
    message: {
      id: 'a2',
      conversationId: 'preview',
      role: 'assistant',
      content: `## 代码分析结果

经过仔细审查，我发现以下几个 **关键性能问题**：

### 1. 内存泄漏风险

你的代码中存在 *未清理的事件监听器*，这会导致内存持续增长。

> **注意**: 这类问题在生产环境中通常不会立即暴露，但随着运行时间增长会越来越严重。

具体来说：
- \`addEventListener\` 注册后没有对应的 \`removeEventListener\`
- \`setInterval\` 没有在组件卸载时清理
- 闭包引用了外部大对象

详见 [MDN 内存管理指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Memory_Management)

---

### 2. 建议修复方案

1. 使用 \`AbortController\` 统一管理事件生命周期
2. 用 \`WeakRef\` 替代强引用
3. 添加 \`finally\` 块确保资源释放

这是一个 ~O(n²)~ 的优化点，改为 \`O(n log n)\` 后性能提升显著。`,
      createdAt: '2026-05-28T10:00:05Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '3. 代码块（TypeScript / Python / Bash / JSON）',
    message: {
      id: 'a3',
      conversationId: 'preview',
      role: 'assistant',
      content: `以下是修复后的代码：

\`\`\`typescript
import { useEffect, useRef } from 'react';

function useEventCleanup(
  target: EventTarget,
  event: string,
  handler: EventListener,
) {
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current = new AbortController();
    target.addEventListener(event, handler, {
      signal: controllerRef.current.signal,
    });
    return () => controllerRef.current?.abort();
  }, [target, event, handler]);
}
\`\`\`

对应的 Python 版本使用 \`weakref\`：

\`\`\`python
import weakref

class ResourceManager:
    def __init__(self):
        self._refs = weakref.WeakSet()

    def register(self, resource):
        self._refs.add(resource)

    def cleanup(self):
        for ref in list(self._refs):
            ref.close()
\`\`\`

验证脚本：

\`\`\`bash
#!/bin/bash
echo "Running memory profiler..."
node --inspect-brk --max-old-space-size=512 app.js &
sleep 5
curl -s http://localhost:9229/json | jq '.[0].webSocketDebuggerUrl'
\`\`\`

配置文件：

\`\`\`json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "target": "ES2022",
    "moduleResolution": "bundler"
  }
}
\`\`\`

行内代码示例：使用 \`console.time('label')\` 和 \`console.timeEnd('label')\` 来测量耗时。`,
      createdAt: '2026-05-28T10:00:10Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '4. 数学公式（KaTeX 行内 + 块级）',
    message: {
      id: 'a4',
      conversationId: 'preview',
      role: 'assistant',
      content: `该算法的时间复杂度分析如下：

行内公式：$T(n) = 2T(n/2) + O(n)$，根据主定理可得 $T(n) = O(n \\log n)$。

块级公式（高斯积分）：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

矩阵表示：

$$
A = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}, \\quad \\det(A) = a_{11}a_{22} - a_{12}a_{21}
$$

欧拉恒等式：$e^{i\\pi} + 1 = 0$`,
      createdAt: '2026-05-28T10:00:15Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '5. Mermaid 图表',
    message: {
      id: 'a5',
      conversationId: 'preview',
      role: 'assistant',
      content: `下面是修复后的事件处理流程：

\`\`\`mermaid
graph TD
    A[Component Mount] --> B[Create AbortController]
    B --> C[addEventListener with signal]
    C --> D{User Action?}
    D -->|Yes| E[Handle Event]
    D -->|No| F[Wait]
    E --> D
    F --> G[Component Unmount]
    G --> H[AbortController.abort]
    H --> I[All listeners removed]
\`\`\`

以及一个时序图：

\`\`\`mermaid
sequenceDiagram
    participant C as Component
    participant T as EventTarget
    participant AC as AbortController
    C->>AC: new AbortController()
    C->>T: addEventListener(signal)
    Note over C,T: Event handling...
    C->>AC: abort()
    AC->>T: Remove all listeners
\`\`\``,
      createdAt: '2026-05-28T10:00:20Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '6. Thinking 推理过程（metadata.thinking）',
    message: {
      id: 'a6',
      conversationId: 'preview',
      role: 'assistant',
      content:
        '根据分析，这段代码的主要问题是事件监听器没有在组件卸载时清理。\n\n建议使用 `AbortController` 来统一管理事件生命周期，这样可以确保所有监听器在组件卸载时自动移除。',
      createdAt: '2026-05-28T10:00:25Z',
      kind: 'text',
      status: 'complete',
      metadata: {
        thinking:
          'Let me analyze the user\'s code for performance issues.\n\nFirst, I need to look at the event listener registration pattern. The code uses addEventListener in a useEffect but doesn\'t return a cleanup function.\n\nSecond, there\'s a setInterval that runs every 100ms but is never cleared.\n\nThird, the closure in the event handler captures the entire state object, which prevents garbage collection of old state references.\n\nThe most critical issue is the missing cleanup — this is a classic memory leak pattern in React.',
      },
    },
  },
  {
    label: '7. 工具执行可视化（RunOver — 完成状态）',
    message: {
      id: 'a7',
      conversationId: 'preview',
      role: 'assistant',
      content: '已完成代码分析，发现了 3 个潜在问题并提供了修复建议。',
      createdAt: '2026-05-28T10:00:30Z',
      kind: 'text',
      status: 'complete',
      metadata: {
        runOverSteps: [
          {
            id: 'step-read',
            name: 'Read File',
            status: 'done',
            durationMs: 230,
            args: 'src/components/App.tsx',
          },
          {
            id: 'step-grep',
            name: 'Grep Search',
            status: 'done',
            durationMs: 45,
            args: 'addEventListener',
          },
          {
            id: 'step-edit',
            name: 'Edit File',
            status: 'done',
            durationMs: 180,
            output: 'Added AbortController cleanup pattern',
          },
        ] as RunOverStep[],
        runOverStatus: 'done',
      },
    },
  },
  {
    label: '8. 工具执行可视化（RunOver — 运行中）',
    message: {
      id: 'a8',
      conversationId: 'preview',
      role: 'assistant',
      content: '',
      createdAt: '2026-05-28T10:00:35Z',
      kind: 'text',
      status: 'streaming',
      metadata: {
        runOverSteps: [
          { id: 's1', name: 'Bash', status: 'done', durationMs: 1200, args: 'npm run build' },
          { id: 's2', name: 'Read File', status: 'executing' },
        ] as RunOverStep[],
        runOverStatus: 'running',
      },
    },
  },
  {
    label: '9. 表格（GFM）',
    message: {
      id: 'a9',
      conversationId: 'preview',
      role: 'assistant',
      content: `### 性能对比

| 指标 | 修复前 | 修复后 | 改善 |
|------|--------|--------|------|
| 内存占用 | 256 MB | 48 MB | **-81%** |
| 首次渲染 | 3.2s | 1.1s | **-66%** |
| 事件监听器 | 128 个 | 12 个 | **-91%** |
| GC 暂停 | 450ms | 30ms | **-93%** |

> 数据来源：Chrome DevTools Performance 面板`,
      createdAt: '2026-05-28T10:00:40Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '10. 图片（OptimizedImage + 点击放大）',
    message: {
      id: 'a10',
      conversationId: 'preview',
      role: 'assistant',
      content: `下面是内存使用趋势图（点击图片可放大）：

![Memory Usage Chart](https://placehold.co/600x300/e6f4ff/1677ff?text=Memory+Usage+Chart&font=roboto)

修复后内存曲线平稳，未修复前持续增长。`,
      createdAt: '2026-05-28T10:00:45Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '11. Task Result 文件卡片',
    message: {
      id: 'a11',
      conversationId: 'preview',
      role: 'assistant',
      content: `分析报告已生成：

<task-result>
  <description>性能分析报告</description>
  <file>performance-report-2026.md</file>
</task-result>

<task-result>
  <description>修复补丁</description>
  <file>fix-memory-leak.patch</file>
</task-result>

你可以点击上方卡片查看文件详情。`,
      createdAt: '2026-05-28T10:00:50Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '12. 内联 <markdown-custom-process> 标签',
    message: {
      id: 'a12',
      conversationId: 'preview',
      role: 'assistant',
      content: `<markdown-custom-process status="done" title="Search Codebase">
{"query":"addEventListener without cleanup"}
</markdown-custom-process>
<markdown-custom-process status="done" title="Read File">
{"path":"src/hooks/useEventListener.ts"}
</markdown-custom-process>

找到了 3 处未清理的事件监听器，分布在以下文件中。`,
      createdAt: '2026-05-28T10:00:55Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '13. 错误状态',
    message: {
      id: 'a13',
      conversationId: 'preview',
      role: 'assistant',
      content: 'Connection timeout: unable to reach the model API after 30s',
      createdAt: '2026-05-28T10:01:00Z',
      kind: 'error',
      status: 'error',
    },
  },
  {
    label: '14. 流式输出中（streaming indicator）',
    message: {
      id: 'a14',
      conversationId: 'preview',
      role: 'assistant',
      content: '',
      createdAt: '2026-05-28T10:01:05Z',
      kind: 'text',
      status: 'streaming',
    },
  },
  {
    label: '15. 流式 Thinking（streaming + thinking）',
    message: {
      id: 'a15',
      conversationId: 'preview',
      role: 'assistant',
      content: '',
      createdAt: '2026-05-28T10:01:10Z',
      kind: 'text',
      status: 'streaming',
      metadata: {
        thinking: 'Analyzing the user\'s request... Let me think about the best approach to solve this problem. I need to consider multiple factors including performance, maintainability, and code clarity.',
      },
    },
  },
  {
    label: '16. 文件预览区块',
    message: {
      id: 'a16',
      conversationId: 'preview',
      role: 'assistant',
      content: `已生成项目文件：

<task-result>
  <description>项目文档</description>
  <file>feature-doc.md</file>
</task-result>

<task-result>
  <description>测试用例</description>
  <file>manual-test-cases.md</file>
</task-result>

文件树结构：

\`\`\`
project-members/
├── docs/
│   ├── feature-doc.md
│   └── manual-test-cases.md
├── src/
│   ├── types/
│   │   └── members.ts
│   ├── api/
│   │   └── members.ts
│   └── views/
│       └── project-members/
│           ├── index.vue
│           └── components/
├── package.json
└── README.md
\`\`\``,
      createdAt: '2026-05-28T10:02:00Z',
      kind: 'text',
      status: 'complete',
    },
  },
  {
    label: '17. 执行计划（Plan）渲染',
    message: {
      id: 'a17',
      conversationId: 'preview',
      role: 'assistant',
      content: `**执行计划（3/5 已完成）**

| Step | 状态 | 描述 |
|------|------|------|
| Step 1: 收集上下文 | ✅ 完成 | 确认技术栈和需求范围 |
| Step 2: 需求梳理 | ✅ 完成 | 用户故事和功能范围 |
| Step 3: 边界拷问 | ✅ 完成 | 识别 30 个边界场景 |
| Step 4: 技术方案 | ⏳ 进行中 | 目录结构和组件设计 |
| Step 5: 实现 | ⏸ 待开始 | 代码编写和测试 |

**关键决策：**

1. 使用 Vue 3 + TypeScript + Vite
2. 组件化设计，复用现有 UI 库
3. 状态管理使用 Pinia
4. API 层统一封装，支持 Mock 数据`,
      createdAt: '2026-05-28T10:02:30Z',
      kind: 'text',
      status: 'complete',
    },
  },
];

// ---------------------------------------------------------------------------
// Antd default token overrides (for side-by-side comparison)
// Now the default styles.css uses nuwax tokens; toggle shows antd defaults.
// ---------------------------------------------------------------------------

const ANTD_DEFAULT_OVERRIDES: Record<string, string> = {
  '--xagi-font-weight-strong': '600',
  '--xagi-line-width': '1px',
  '--xagi-color-primary': '#1677ff',
  '--xagi-color-primary-hover': '#4096ff',
  '--xagi-color-primary-active': '#0958d9',
  '--xagi-color-primary-bg': '#e6f4ff',
  '--xagi-color-primary-border': '#91caff',
  '--xagi-color-primary-text': '#1677ff',
  '--xagi-color-primary-text-hover': '#4096ff',
  '--xagi-color-fill': 'rgba(0, 0, 0, 0.15)',
  '--xagi-line-height-sm': '1.3',
};

// ---------------------------------------------------------------------------
// Preview App
// ---------------------------------------------------------------------------

function PreviewApp() {
  const [useAntdDefaults, setUseAntdDefaults] = useState(false);
  const [filter, setFilter] = useState('');
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'code'>('preview');

  const filteredMessages = filter
    ? messages.filter((m) => m.label.toLowerCase().includes(filter.toLowerCase()))
    : messages;

  return (
    <div className="nuwax-open-app" style={useAntdDefaults ? ANTD_DEFAULT_OVERRIDES : undefined}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderBottom: '1px solid #e9edf3',
          background: '#fff',
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        <strong style={{ marginRight: 8 }}>Markdown 渲染预览</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={useAntdDefaults}
            onChange={(e) => setUseAntdDefaults(e.target.checked)}
          />
          切换为 Antd 默认 tokens（对比用）
        </label>
        <span style={{ color: '#999' }}>|</span>
        <input
          type="text"
          placeholder="筛选消息..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '4px 8px',
            border: '1px solid #ddd',
            borderRadius: 4,
            fontSize: 13,
            width: 200,
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showFilePreview}
            onChange={(e) => setShowFilePreview(e.target.checked)}
          />
          显示文件预览面板
        </label>
        <span style={{ color: '#999', marginLeft: 'auto' }}>
          {filteredMessages.length} / {messages.length} 条消息
        </span>
      </div>

      {/* Token comparison panel */}
      {useAntdDefaults && (
        <div
          style={{
            padding: '6px 16px',
            background: '#e6f4ff',
            borderBottom: '1px solid #91caff',
            fontSize: 12,
            color: '#1677ff',
            flexShrink: 0,
          }}
        >
          ⚠️ Antd 默认 tokens: fontWeightStrong=600, lineWidth=1px, colorPrimary=#1677ff — 与 nuwax 有差异
        </div>
      )}

      {/* Main content: messages + optional file preview side panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px 0',
          background: 'var(--xagi-color-bg-layout, #f5f5f5)',
          minWidth: 0,
        }}
      >
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 20px' }}>
          {filteredMessages.map(({ label, message }) => (
            <div key={message.id} style={{ marginBottom: 24 }}>
              {/* Section label */}
              <div
                style={{
                  fontSize: 11,
                  color: '#999',
                  marginBottom: 4,
                  paddingLeft: 4,
                  fontFamily: 'monospace',
                }}
              >
                {label}
              </div>
              <ChatMessage
                message={message}
                agent={mockAgent}
                conversationId="preview"
              />
            </div>
          ))}

          {/* Permission card (not a ChatMessage) */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 11,
                color: '#999',
                marginBottom: 4,
                paddingLeft: 4,
                fontFamily: 'monospace',
              }}
            >
              19. 权限请求卡片 (PermissionCard)
            </div>
            <PermissionCard
              labels={zh}
              request={{
                id: 'perm-preview',
                title: '允许执行 Bash 命令？',
                description:
                  'Agent 想要运行 "rm -rf node_modules && npm install"，这可能影响项目依赖。',
                choices: [
                  { id: 'once', label: '允许一次' },
                  { id: 'always', label: '总是允许' },
                  { id: 'reject', label: '拒绝', destructive: true },
                ],
              }}
              onRespond={() => {}}
            />
          </div>

          {/* Raw MarkdownRenderer (without ChatMessage wrapper) */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 11,
                color: '#999',
                marginBottom: 4,
                paddingLeft: 4,
                fontFamily: 'monospace',
              }}
            >
              20. MarkdownRenderer 直接渲染（无消息气泡包装）
            </div>
            <div
              style={{
                background: '#fff',
                padding: 16,
                borderRadius: 8,
                border: '1px solid #eee',
              }}
            >
              <MarkdownRenderer
                content={`这是一段直接通过 **MarkdownRenderer** 渲染的内容，不经过 ChatMessage 包装。

\`\`\`python
print("Hello from raw MarkdownRenderer!")
\`\`\`

支持 $E = mc^2$ 行内公式和完整 Markdown 语法。`}
              />
            </div>
          </div>

        </div>
      </div>

      {/* File Preview Side Panel */}
      {showFilePreview && (
        <div
          style={{
            width: 450,
            flexShrink: 0,
            borderLeft: '1px solid rgba(5, 5, 5, 0.06)',
            background: 'rgb(245, 245, 245)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header: filePathHeader */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              height: 48,
              padding: '0 8px 0 16px',
              borderBottom: '0.5px solid rgba(5, 5, 5, 0.06)',
              background: 'transparent',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 14, color: 'rgba(0, 0, 0, 0.88)' }}>
                文件预览
              </span>
              <button
                style={{
                  width: 24,
                  height: 24,
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(0, 0, 0, 0.45)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontSize: 16,
                }}
                onClick={() => setShowFilePreview(false)}
              >
                <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor">
                  <path d="M909.1 209.3l-56.4 44.1C775.8 155.1 653.5 96 512 96 282.7 96 96.5 282.3 96 511.6 95.5 741.2 282.1 928 512 928c141.2 0 263.3-58.8 340.3-156.6l56.3 44.1C822.7 925.4 678.2 992 512 992 245.8 992 32 778.8 32 512S245.8 32 512 32c166.4 0 310.9 66.8 397.1 177.3zM192 512c0-176.7 143.3-320 320-320 88.4 0 168.4 35.9 226.3 93.7L192 512zm320 320c-88.4 0-168.4-35.9-226.3-93.7L832 512C832 688.7 688.7 832 512 832z" />
                </svg>
              </button>
            </div>

            <div style={{ marginLeft: 16, fontSize: 14, color: 'rgba(0, 0, 0, 0.65)' }}>
              feature-doc.md
            </div>

            {/* Segmented control */}
            <div
              style={{
                marginLeft: 12,
                display: 'inline-flex',
                background: 'rgba(12, 20, 102, 0.04)',
                borderRadius: 6,
                padding: 2,
                gap: 0,
              }}
            >
              <div
                onClick={() => setPreviewTab('preview')}
                style={{
                  padding: '0 12px',
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 14,
                  color: previewTab === 'preview' ? 'rgb(81, 71, 255)' : 'rgba(0, 0, 0, 0.45)',
                  background: previewTab === 'preview' ? '#fff' : 'transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxShadow: previewTab === 'preview' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}
              >
                预览
              </div>
              <div
                onClick={() => setPreviewTab('code')}
                style={{
                  padding: '0 12px',
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 14,
                  color: previewTab === 'code' ? 'rgb(81, 71, 255)' : 'rgba(0, 0, 0, 0.45)',
                  background: previewTab === 'code' ? '#fff' : 'transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxShadow: previewTab === 'code' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}
              >
                代码
              </div>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 0 }}>
              <button
                style={{
                  width: 42,
                  height: 32,
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(0, 0, 0, 0.45)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontSize: 14,
                }}
                title="下载"
              >
                <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor">
                  <path d="M505.7 661a8 8 0 0012.6 0l112-141.7c4.1-5.2.4-12.9-6.3-12.9h-74.1V168c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v338.3H400c-6.7 0-10.4 7.7-6.3 12.9l112 141.8zM878 626h-60c-4.4 0-8 3.6-8 8v154H214V634c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v198c0 17.7 14.3 32 32 32h684c17.7 0 32-14.3 32-32V634c0-4.4-3.6-8-8-8z" />
                </svg>
              </button>
              <button
                style={{
                  width: 42,
                  height: 32,
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(0, 0, 0, 0.45)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontSize: 14,
                }}
                title="关闭"
                onClick={() => setShowFilePreview(false)}
              >
                <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor">
                  <path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9A7.95 7.95 0 00203 838h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body: collapsed file tree + preview content */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'rgb(245, 245, 245)' }}>
            {/* Collapsed file tree sidebar */}
            <div
              style={{
                width: 32,
                flexShrink: 0,
                borderRight: '1px solid rgba(5, 5, 5, 0.06)',
                background: 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 8,
              }}
            >
              <div
                style={{
                  writingMode: 'vertical-rl',
                  fontSize: 12,
                  color: 'rgba(0, 0, 0, 0.45)',
                  letterSpacing: 2,
                }}
              >
                文件
              </div>
            </div>

            {/* Preview content area */}
            <div style={{ flex: 1, padding: 16, overflow: 'auto', background: '#fff' }}>
              {previewTab === 'preview' ? (
                <>
                  <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: 'rgba(0, 0, 0, 0.88)' }}>
                    功能文档
                  </h3>
                  <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, color: 'rgba(0, 0, 0, 0.65)' }}>
                    本文档描述了项目成员管理功能的完整需求和技术方案。
                  </p>
                  <h4 style={{ margin: '12px 0 8px', fontSize: 14, fontWeight: 600, color: 'rgba(0, 0, 0, 0.88)' }}>
                    功能范围
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6, color: 'rgba(0, 0, 0, 0.65)' }}>
                    <li>成员列表展示（筛选、分页）</li>
                    <li>新增成员（表单校验、手机号唯一性）</li>
                    <li>编辑成员（仅允许修改角色）</li>
                    <li>删除成员（确认弹窗、不可恢复）</li>
                  </ul>
                </>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1.5,
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: 'rgba(0, 0, 0, 0.88)',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >{`# 功能文档

本文档描述了项目成员管理功能的完整需求和技术方案。

## 功能范围

- 成员列表展示（筛选、分页）
- 新增成员（表单校验、手机号唯一性）
- 编辑成员（仅允许修改角色）
- 删除成员（确认弹窗、不可恢复）

## 技术方案

### 目录结构

\`\`\`
src/
├── types/members.ts
├── api/members.ts
└── views/project-members/
    ├── index.vue
    └── components/
        ├── MemberSearch.vue
        ├── MemberTable.vue
        └── MemberDialog.vue
\`\`\``}</pre>
              )}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: 'center',
          padding: '6px 0',
          fontSize: 10,
          color: 'rgba(0,0,0,0.25)',
          background: '#fff',
          borderTop: '1px solid #eee',
          flexShrink: 0,
        }}
      >
        内容由 AI 生成，请仔细甄别
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = createRoot(document.getElementById('root')!);
root.render(<PreviewApp />);
