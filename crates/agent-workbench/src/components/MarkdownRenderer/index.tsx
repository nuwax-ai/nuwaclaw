import { Fragment, useCallback, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './CodeBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { OptimizedImage } from './OptimizedImage';
import { RunOver, type RunOverStep } from './RunOver';
import { ProcessGroup } from './ProcessGroup';
import { TaskResult } from './TaskResult';
import { MathBlock } from './MathBlock';
import { MermaidBlock } from './MermaidBlock';
import { groupMarkdownProcesses, replaceMathBracket } from './groupMarkdownProcesses';
import { extractTableToMarkdown } from './tableUtils';
import {
  MarkdownRendererContext,
  type MarkdownRendererContextValue,
} from './context';

// Re-export public types and sub-components
export type { RunOverStep } from './RunOver';
export type { PlanTask } from './ExecutionPlan';
export { ThinkingBlock } from './ThinkingBlock';
export { RunOver } from './RunOver';
export { ExecutionPlan } from './ExecutionPlan';
export { OptimizedImage } from './OptimizedImage';
export { ProcessGroup } from './ProcessGroup';
export { TaskResult } from './TaskResult';
export { MathBlock } from './MathBlock';
export { MermaidBlock } from './MermaidBlock';
export { MarkdownRendererContext } from './context';

// ── Helpers ────────────────────────────────────────────────────────

function extractText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return '';
}

function extractLanguage(className: string | undefined): string {
  if (!className) return '';
  const match = /language-([\w+\-#.]+)/i.exec(className);
  return match ? match[1] : '';
}

interface HastNodeLike {
  position?: { start: { line: number }; end: { line: number } };
  tagName?: string;
}

function isFencedBlock(node: HastNodeLike | undefined, children: ReactNode): boolean {
  if (node?.position) {
    if (node.position.end.line !== node.position.start.line) return true;
  }
  return extractText(children).includes('\n');
}

// ── Thinking extraction ────────────────────────────────────────────

export function extractThinking(content: string): { thinking: string; rest: string } {
  if (!content) return { thinking: '', rest: '' };
  const match = /<thinking>([\s\S]*?)<\/thinking>/i.exec(content);
  if (!match) return { thinking: '', rest: content };
  const thinking = match[1].trim();
  const rest = `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`;
  return { thinking, rest };
}

// ── Segment types ──────────────────────────────────────────────────

export type ContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'thinking'; text: string; streaming?: boolean }
  | { kind: 'runover-step'; step: RunOverStep };

/**
 * Parse attributes from a tag start string.
 */
function parseAttributes(attrString: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrString))) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    out[key] = value;
  }
  return out;
}

function coerceStatus(raw: string | undefined): RunOverStep['status'] {
  const v = (raw || '').toLowerCase();
  if (v === 'running' || v === 'executing' || v === 'pending') return 'executing';
  if (v === 'error' || v === 'fail' || v === 'failed') return 'error';
  return 'done';
}

function buildRunOverStep(
  attrs: Record<string, string>,
  body: string,
  fallbackId: number,
): RunOverStep {
  const id = attrs['executeid'] || attrs['execute-id'] || attrs['id'] || `step-${fallbackId}`;
  const name = attrs['name'] || attrs['title'] || attrs['type'] || 'tool';
  const status = coerceStatus(attrs['status']);
  const start = Number(attrs['result-starttime']);
  const end = Number(attrs['result-endtime']);
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
  const args = body && body.trim() ? body.trim() : undefined;
  return { id, name, status, durationMs, args };
}

/**
 * Pre-split raw content, extracting `<thinking>` and
 * `<markdown-custom-process>` tags. Process tags use the pre-split approach
 * for reliable attribute parsing; all other custom HTML is handled by
 * rehype-raw.
 */
export function parseSegments(
  raw: string,
  options?: { streaming?: boolean },
): ContentSegment[] {
  if (!raw) return [];
  const segments: ContentSegment[] = [];
  const tagRe =
    /<\/?(thinking|markdown-custom-process)(\s[^>]*?)?(\/)?>/gi;
  let cursor = 0;
  let stepCounter = 0;

  while (true) {
    tagRe.lastIndex = cursor;
    const match = tagRe.exec(raw);
    if (!match) break;
    const tagName = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');
    const isSelfClosing = !!match[3];
    const tagStart = match.index;
    const tagEnd = tagRe.lastIndex;

    if (tagStart > cursor) {
      const text = raw.slice(cursor, tagStart);
      if (text.length > 0) segments.push({ kind: 'markdown', text });
    }

    if (tagName === 'thinking' && !isClosing) {
      const closeRe = /<\/thinking>/i;
      const remainder = raw.slice(tagEnd);
      const closeMatch = closeRe.exec(remainder);
      if (closeMatch) {
        const inner = remainder.slice(0, closeMatch.index);
        segments.push({ kind: 'thinking', text: inner.trim(), streaming: false });
        cursor = tagEnd + closeMatch.index + closeMatch[0].length;
        continue;
      }
      if (options?.streaming) {
        const inner = remainder;
        if (inner.trim().length > 0) {
          segments.push({ kind: 'thinking', text: inner.trim(), streaming: true });
        }
        cursor = raw.length;
        break;
      }
      segments.push({ kind: 'markdown', text: match[0] });
      cursor = tagEnd;
      continue;
    }

    if (tagName === 'thinking' && isClosing) {
      cursor = tagEnd;
      continue;
    }

    if (tagName === 'markdown-custom-process') {
      const attrString = match[2] ?? '';
      const attrs = parseAttributes(attrString);
      let body = '';
      let endIndex = tagEnd;
      if (!isSelfClosing && !isClosing) {
        const closeRe = /<\/markdown-custom-process>/i;
        const remainder = raw.slice(tagEnd);
        const closeMatch = closeRe.exec(remainder);
        if (closeMatch) {
          body = remainder.slice(0, closeMatch.index);
          endIndex = tagEnd + closeMatch.index + closeMatch[0].length;
        }
      }
      if (isClosing) {
        cursor = tagEnd;
        continue;
      }
      const step = buildRunOverStep(attrs, body, stepCounter++);
      segments.push({ kind: 'runover-step', step });
      cursor = endIndex;
      continue;
    }

    segments.push({ kind: 'markdown', text: match[0] });
    cursor = tagEnd;
  }

  if (cursor < raw.length) {
    const tail = raw.slice(cursor);
    if (tail.length > 0) segments.push({ kind: 'markdown', text: tail });
  }

  return segments;
}

// ── Props ──────────────────────────────────────────────────────────

export interface MarkdownRendererProps {
  content: string;
  thinking?: string;
  thinkingStreaming?: boolean;
  runOverSteps?: RunOverStep[];
  runOverStatus?: 'running' | 'done' | 'error';
  /** Callback when user clicks a task-result file card. */
  onFilePreview?: (fileId: string, context?: { conversationId?: string }) => void;
  /** Conversation ID for task-result file ID extraction. */
  conversationId?: string;
}

// ── Render items ───────────────────────────────────────────────────

interface RenderItem {
  key: string;
  node: ReactNode;
}

function buildRenderItems(
  segments: ContentSegment[],
  components: Record<string, unknown>,
): RenderItem[] {
  const items: RenderItem[] = [];
  let stepBuffer: RunOverStep[] = [];
  let stepIdx = 0;

  const flushSteps = () => {
    if (stepBuffer.length === 0) return;
    const steps = stepBuffer;
    stepBuffer = [];
    const status: 'running' | 'done' | 'error' = steps.some((s) => s.status === 'executing')
      ? 'running'
      : steps.some((s) => s.status === 'error')
        ? 'error'
        : 'done';
    items.push({
      key: `runover-${stepIdx++}`,
      node: <RunOver steps={steps} status={status} />,
    });
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === 'runover-step') {
      stepBuffer.push(seg.step);
      continue;
    }
    flushSteps();
    if (seg.kind === 'thinking') {
      items.push({
        key: `thinking-${i}`,
        node: <ThinkingBlock content={seg.text} streaming={!!seg.streaming} />,
      });
      continue;
    }
    if (seg.text.length === 0) continue;
    items.push({
      key: `md-${i}`,
      node: (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          components={components}
        >
          {seg.text}
        </ReactMarkdown>
      ),
    });
  }
  flushSteps();

  return items;
}

// ── Main component ─────────────────────────────────────────────────

export function MarkdownRenderer({
  content,
  thinking,
  thinkingStreaming,
  runOverSteps,
  runOverStatus,
  onFilePreview,
  conversationId,
}: MarkdownRendererProps): JSX.Element {
  const propThinkingProvided = typeof thinking === 'string' && thinking.length > 0;
  const propRunOverProvided = !!runOverSteps && runOverSteps.length > 0;

  // Pre-process: convert math brackets to $...$/$$...$$ syntax.
  // Process tags are handled by parseSegments (not rehype-raw) for reliable
  // attribute parsing, so groupMarkdownProcesses is not needed here —
  // buildRenderItems already merges consecutive runover-steps.
  let processed = replaceMathBracket(content);

  const allSegments = parseSegments(processed, { streaming: !!thinkingStreaming });

  const segments = allSegments.filter((seg) => {
    if (seg.kind === 'thinking' && propThinkingProvided) return false;
    if (seg.kind === 'runover-step' && propRunOverProvided) return false;
    return true;
  });

  const handleTableCopy = useCallback(
    (children: ReactNode) => {
      const md = extractTableToMarkdown(children);
      if (md) void navigator.clipboard?.writeText(md);
    },
    [],
  );

  const components = buildComponentOverrides(handleTableCopy) as Record<string, unknown>;

  const items = buildRenderItems(segments, components);
  const showRunOverFromProps = propRunOverProvided || runOverStatus === 'running';

  const ctxValue: MarkdownRendererContextValue = { onFilePreview, conversationId };

  return (
    <MarkdownRendererContext.Provider value={ctxValue}>
      <div className="ds-markdown open-app-markdown">
        {propThinkingProvided && (
          <ThinkingBlock content={thinking as string} streaming={!!thinkingStreaming} />
        )}
        {showRunOverFromProps && (
          <RunOver steps={runOverSteps ?? []} status={runOverStatus ?? 'done'} />
        )}
        {items.map((it) => (
          <Fragment key={it.key}>{it.node}</Fragment>
        ))}
      </div>
    </MarkdownRendererContext.Provider>
  );
}

/** Remove all <markdown-custom-process> and <markdown-custom-process-group> tags. */
function stripProcessTags(text: string): string {
  return text
    .replace(/<markdown-custom-process-group>[\s\S]*?<\/markdown-custom-process-group>/gi, '')
    .replace(/<markdown-custom-process\b[^>]*?(?:\/>|>[\s\S]*?<\/markdown-custom-process>)/gi, '')
    .replace(/<div>\s*<\/div>/g, '')
    .trim();
}

// ── Component overrides ────────────────────────────────────────────

function buildComponentOverrides(
  onTableCopy: (children: ReactNode) => void,
): Record<string, unknown> {
  return {
    // Security: suppress style and script tags
    style: () => null,
    script: () => null,
    // Strip <html> wrapper
    html: ({ children }: { children?: ReactNode }) => <>{children}</>,
    // Replace <p> with <div class="md-paragraph">
    p: ({ children }: { children?: ReactNode }) => (
      <div className="md-paragraph">{children}</div>
    ),

    // ── Code blocks ──
    code: ({ className, children, node, ...props }: any) => {
      const language = extractLanguage(className);
      const isBlock = Boolean(language) || isFencedBlock(node as HastNodeLike | undefined, children);
      if (isBlock) {
        const codeText = extractText(children).replace(/\n$/, '');
        if (language === 'mermaid') {
          return <MermaidBlock code={codeText} />;
        }
        return <CodeBlock code={codeText} language={language} fallbackChildren={children} />;
      }
      return (
        <code className="open-app-md-code-inline" {...props}>
          {children}
        </code>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => <>{children}</>,

    // ── Table with copy toolbar ──
    table: ({ children, node, ...props }: any) => (
      <div className="md-table-wrapper">
        <div className="md-table-toolbar">
          <button
            type="button"
            className="md-table-copy-btn"
            onClick={() => onTableCopy(children)}
            title="Copy as Markdown"
          >
            Copy
          </button>
        </div>
        <div className="md-table-scroll">
          <table {...props}>{children}</table>
        </div>
      </div>
    ),

    // ── Links ──
    a: ({ children, ...props }: any) => (
      <a target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    ),

    // ── Images ──
    img: ({ src, alt, title }: any) => {
      if (!src) return null;
      return <OptimizedImage src={String(src)} alt={alt ?? ''} title={title} />;
    },

    // ── Task result ──
    'task-result': ({ children: taskChildren, node }: any) => (
      <TaskResult node={node}>{taskChildren}</TaskResult>
    ),
  };
}
