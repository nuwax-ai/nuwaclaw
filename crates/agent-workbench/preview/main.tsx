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

      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px 0',
          background: 'var(--xagi-color-bg-layout, #f5f5f5)',
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
              16. 权限请求卡片 (PermissionCard)
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
              17. MarkdownRenderer 直接渲染（无消息气泡包装）
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
