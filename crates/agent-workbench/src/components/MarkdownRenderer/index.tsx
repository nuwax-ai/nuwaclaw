import { Fragment, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { OptimizedImage } from './OptimizedImage';
import { RunOver, type RunOverStep } from './RunOver';

/**
 * Markdown renderer used in the agent transcript. Mirrors the responsibilities
 * of nuwax's MarkdownRenderer (GFM + fenced code highlight + copy button) but
 * keeps the dependency surface intentionally small.
 *
 * Implementation note: react-markdown v10 calls our `code` component for both
 * inline (`` `foo` ``) and fenced (```` ```ts ```` ) variants. We distinguish
 * them by looking at the `className` prop - fenced code blocks always carry a
 * `language-xxx` token (or are wrapped in `<pre>` per the hast tree, which we
 * don't get to override directly because react-markdown v10 inlines that).
 *
 * Custom-tag support (nuwax parity):
 *   - `<thinking>...</thinking>` is extracted out of the body before markdown
 *     parsing and rendered as a collapsible ThinkingBlock. We accept either an
 *     explicit `thinking` prop OR inline tags so both transport shapes work.
 *     During streaming an unclosed `<thinking>` is honoured: everything from
 *     the opener to EOS is treated as in-progress reasoning.
 *   - `<markdown-custom-process .../>` (nuwax tool-execution tag) is parsed
 *     inline and rendered as a RunOver block. Consecutive tags are *merged*
 *     into a single RunOver with all steps so the UI doesn't churn one
 *     RunOver per row. Both self-closing (`.../>`) and body forms
 *     (`<markdown-custom-process ...>body</markdown-custom-process>`) are
 *     accepted because nuwax has shipped both shapes in the wild.
 *   - Markdown `![](src)` images are routed through OptimizedImage.
 *
 * Rather than relying on rehype-raw (extra dep + larger bundle), we pre-split
 * the raw content into an ordered list of segments (markdown / thinking /
 * runover-step) before invoking react-markdown. This keeps the parser surface
 * tiny and lets us merge sibling tool-call steps into one component.
 */

export type { RunOverStep } from './RunOver';

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
  // react-markdown passes the hast node via `node` (when passNode is on, which
  // is the default in v10). For fenced blocks the position spans multiple
  // lines OR the rendered children include a newline. Inline code is single
  // line by definition. We accept either signal.
  if (node?.position) {
    const startLine = node.position.start.line;
    const endLine = node.position.end.line;
    if (endLine !== startLine) return true;
  }
  const text = extractText(children);
  return text.includes('\n');
}

/**
 * Strip the first `<thinking>...</thinking>` block out of `content` and return
 * both the inner text and the remaining markdown.
 *
 * This is kept exported for backwards compatibility — `parseSegments` is the
 * preferred entry point because it also handles unclosed thinking blocks and
 * `<markdown-custom-process>` tags. `extractThinking` simply walks segments
 * and collects the first thinking payload, dropping it from the rest.
 *
 * The regex is intentionally non-greedy and case-insensitive so that the tag
 * matches whether the model emits `<Thinking>` or `<thinking>`. Only the first
 * thinking block is extracted — nuwax's data model has one thinking trace per
 * message, so this keeps the contract simple.
 */
export function extractThinking(content: string): { thinking: string; rest: string } {
  if (!content) return { thinking: '', rest: '' };
  const match = /<thinking>([\s\S]*?)<\/thinking>/i.exec(content);
  if (!match) return { thinking: '', rest: content };
  const thinking = match[1].trim();
  const rest = `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`;
  return { thinking, rest };
}

/**
 * One contiguous chunk of message content. The renderer emits a `markdown`
 * segment for plain prose and a `thinking` / `runover-step` segment for each
 * recognized custom tag. Consecutive `runover-step` segments are merged at
 * render time into a single RunOver component.
 */
export type ContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'thinking'; text: string; streaming?: boolean }
  | { kind: 'runover-step'; step: RunOverStep };

/**
 * Parse all attribute key/value pairs from a tag start (`<tagname attrs...>`).
 * We accept both quoted and unquoted values and case-insensitive keys.
 *
 * This is a deliberately small parser — we only need to handle attributes
 * emitted by the nuwax stream, which never embeds `>` inside an attribute
 * value, so a regex is enough.
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

/**
 * Coerce a nuwax `status` attribute (`running`/`executing`/`done`/`success`/
 * `error`/`failed`) into the canonical RunOverStep status. Anything we don't
 * recognise becomes `done` so the row still renders.
 */
function coerceStepStatus(raw: string | undefined): RunOverStep['status'] {
  const v = (raw || '').toLowerCase();
  if (v === 'running' || v === 'executing' || v === 'pending') return 'executing';
  if (v === 'error' || v === 'fail' || v === 'failed') return 'error';
  return 'done';
}

/**
 * Convert a `<markdown-custom-process>` tag (attributes + optional body) into
 * a RunOverStep. Both naming conventions are accepted:
 *   - nuwax wire shape (per task spec): `executeid`, `name`,
 *     `result-startTime`, `result-endTime`, `type`.
 *   - mock/dev shape: `title` (in lieu of `name`), body JSON as args.
 */
function buildRunOverStep(
  attrs: Record<string, string>,
  body: string,
  fallbackId: number,
): RunOverStep {
  const id = attrs['executeid'] || attrs['execute-id'] || attrs['id'] || `step-${fallbackId}`;
  const name = attrs['name'] || attrs['title'] || attrs['type'] || 'tool';
  const status = coerceStepStatus(attrs['status']);
  const start = Number(attrs['result-starttime']);
  const end = Number(attrs['result-endtime']);
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
  const args = body && body.trim() ? body.trim() : undefined;
  return { id, name, status, durationMs, args };
}

/**
 * Pre-split raw message content into an ordered segment list, extracting
 * `<thinking>` and `<markdown-custom-process>` tags.
 *
 * Streaming behaviour: when `streaming` is true and a `<thinking>` opener has
 * no matching close tag (token-by-token arrival), the trailing text is treated
 * as in-progress reasoning (`streaming: true`). Outside streaming mode an
 * unclosed tag is left in place as plain text — that's the safer default for
 * the final-message render path.
 */
export function parseSegments(
  raw: string,
  options?: { streaming?: boolean },
): ContentSegment[] {
  if (!raw) return [];
  const segments: ContentSegment[] = [];
  // Matches the next interesting tag: thinking open, thinking close, or any
  // markdown-custom-process tag (self-closing or open). The /i flag normalises
  // case; tagName lookups below are also lowercased.
  const tagRe =
    /<\/?(thinking|markdown-custom-process)(\s[^>]*?)?(\/)?>/gi;
  let cursor = 0;
  let stepCounter = 0;

  // Mini state machine: when we hit a `<thinking>` opener we capture text up
  // to the matching `</thinking>` (greedy across other tags — thinking blocks
  // should not realistically contain custom-process tags, but if they do the
  // close tag still wins).
  while (true) {
    tagRe.lastIndex = cursor;
    const match = tagRe.exec(raw);
    if (!match) break;
    const tagName = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');
    const isSelfClosing = !!match[3];
    const tagStart = match.index;
    const tagEnd = tagRe.lastIndex;
    // Flush any plain text accumulated before the tag.
    if (tagStart > cursor) {
      const text = raw.slice(cursor, tagStart);
      if (text.length > 0) segments.push({ kind: 'markdown', text });
    }

    if (tagName === 'thinking' && !isClosing) {
      // Find the matching </thinking>. If none, treat the rest as streaming
      // reasoning (only when caller is in streaming mode); otherwise leave
      // the opener as literal markdown so users can see the malformed input.
      const closeRe = /<\/thinking>/i;
      const remainder = raw.slice(tagEnd);
      const closeMatch = closeRe.exec(remainder);
      if (closeMatch) {
        const inner = remainder.slice(0, closeMatch.index);
        segments.push({ kind: 'thinking', text: inner.trim(), streaming: false });
        cursor = tagEnd + closeMatch.index + closeMatch[0].length;
        continue;
      }
      // Unclosed thinking tag.
      if (options?.streaming) {
        const inner = remainder;
        if (inner.trim().length > 0) {
          segments.push({ kind: 'thinking', text: inner.trim(), streaming: true });
        }
        cursor = raw.length;
        break;
      }
      // Non-streaming and unclosed — drop the literal tag and keep parsing.
      // Treat the opener as text so we don't lose information.
      segments.push({ kind: 'markdown', text: match[0] });
      cursor = tagEnd;
      continue;
    }

    if (tagName === 'thinking' && isClosing) {
      // Stray closing tag with no opener — skip it silently. (Including it as
      // text would just show `</thinking>` in the body, which is uglier than
      // dropping it.)
      cursor = tagEnd;
      continue;
    }

    if (tagName === 'markdown-custom-process') {
      const attrString = match[2] ?? '';
      const attrs = parseAttributes(attrString);
      let body = '';
      let endIndex = tagEnd;
      if (!isSelfClosing && !isClosing) {
        // Look for matching </markdown-custom-process>. If absent, treat the
        // tag as self-closing — covers both the final-render edge case
        // (well-formed stream) and the streaming partial-tag case.
        const closeRe = /<\/markdown-custom-process>/i;
        const remainder = raw.slice(tagEnd);
        const closeMatch = closeRe.exec(remainder);
        if (closeMatch) {
          body = remainder.slice(0, closeMatch.index);
          endIndex = tagEnd + closeMatch.index + closeMatch[0].length;
        }
      }
      if (isClosing) {
        // Stray closing tag — skip.
        cursor = tagEnd;
        continue;
      }
      const step = buildRunOverStep(attrs, body, stepCounter++);
      segments.push({ kind: 'runover-step', step });
      cursor = endIndex;
      continue;
    }

    // Unknown tag (shouldn't happen given the regex) — keep it as text.
    segments.push({ kind: 'markdown', text: match[0] });
    cursor = tagEnd;
  }

  if (cursor < raw.length) {
    const tail = raw.slice(cursor);
    if (tail.length > 0) segments.push({ kind: 'markdown', text: tail });
  }

  return segments;
}

export interface MarkdownRendererProps {
  content: string;
  /**
   * Optional separate thinking trace (nuwax-style, where `think` and `text`
   * are sibling message fields). If provided, this overrides any inline
   * `<thinking>` tag found in `content` — props win because the host already
   * normalised the message and the inline tags are just a fallback channel.
   */
  thinking?: string;
  /**
   * When true, the thinking section renders the streaming indicator. Mirrors
   * nuwax's `isThinkingFinished === false` state (no answer text yet). When
   * the streaming label is on we also let `parseSegments` honour unclosed
   * `<thinking>` openers in the body.
   */
  thinkingStreaming?: boolean;
  /**
   * Optional pre-normalized RunOver steps. When provided the renderer prepends
   * a tool-execution summary above the markdown body — and inline
   * `<markdown-custom-process>` tags in `content` are *ignored* so the host's
   * canonical step list wins.
   */
  runOverSteps?: RunOverStep[];
  /**
   * Optional overall RunOver status. Forwarded to the RunOver component.
   */
  runOverStatus?: 'running' | 'done' | 'error';
}

interface RenderItem {
  key: string;
  node: ReactNode;
}

/**
 * Collapse the segment list into a renderable item list. Consecutive
 * runover-step segments are merged into a single RunOver so the user sees a
 * unified tool-execution summary even when nuwax emits one tag per step.
 */
function buildRenderItems(
  segments: ContentSegment[],
  codeComponents: Parameters<typeof ReactMarkdown>[0]['components'],
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

  segments.forEach((seg, i) => {
    if (seg.kind === 'runover-step') {
      stepBuffer.push(seg.step);
      return;
    }
    flushSteps();
    if (seg.kind === 'thinking') {
      items.push({
        key: `thinking-${i}`,
        node: <ThinkingBlock content={seg.text} streaming={!!seg.streaming} />,
      });
      return;
    }
    // markdown
    if (seg.text.length === 0) return;
    items.push({
      key: `md-${i}`,
      node: (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeComponents}>
          {seg.text}
        </ReactMarkdown>
      ),
    });
  });
  flushSteps();
  return items;
}

export function MarkdownRenderer({
  content,
  thinking,
  thinkingStreaming,
  runOverSteps,
  runOverStatus,
}: MarkdownRendererProps): JSX.Element {
  // Parse inline tags first. When the host has supplied canonical props
  // (`thinking` / `runOverSteps`) those take precedence and we filter the
  // matching segments out so we don't render the same thing twice.
  const allSegments = parseSegments(content, { streaming: !!thinkingStreaming });
  const propThinkingProvided = typeof thinking === 'string' && thinking.length > 0;
  const propRunOverProvided = !!runOverSteps && runOverSteps.length > 0;

  const segments = allSegments.filter((seg) => {
    if (seg.kind === 'thinking' && propThinkingProvided) return false;
    if (seg.kind === 'runover-step' && propRunOverProvided) return false;
    return true;
  });

  const codeComponents: Parameters<typeof ReactMarkdown>[0]['components'] = {
    // react-markdown v10 routes block code through this component too.
    // When the language- class is present (or the code contains newlines)
    // we render our toolbar/Highlight layout; otherwise we keep inline
    // code styling.
    code: ({ className, children, node, ...props }) => {
      const language = extractLanguage(className);
      const isBlock = Boolean(language) || isFencedBlock(node as HastNodeLike | undefined, children);
      if (isBlock) {
        const codeText = extractText(children).replace(/\n$/, '');
        return (
          <CodeBlock code={codeText} language={language} fallbackChildren={children} />
        );
      }
      return (
        <code className="open-app-md-code-inline" {...props}>
          {children}
        </code>
      );
    },
    // Suppress the default <pre> wrapper - our CodeBlock supplies its own.
    pre: ({ children }) => <>{children}</>,
    table: ({ children, ...props }) => (
      <div className="open-app-md-table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
    a: ({ children, ...props }) => (
      <a target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    ),
    img: ({ src, alt, title }) => {
      if (!src) return null;
      return <OptimizedImage src={String(src)} alt={alt ?? ''} title={title} />;
    },
  };

  const items = buildRenderItems(segments, codeComponents);

  const showRunOverFromProps = propRunOverProvided || runOverStatus === 'running';

  return (
    <>
      {propThinkingProvided && (
        <ThinkingBlock content={thinking as string} streaming={!!thinkingStreaming} />
      )}
      {showRunOverFromProps && (
        <RunOver steps={runOverSteps ?? []} status={runOverStatus ?? 'done'} />
      )}
      {items.map((it) => (
        <Fragment key={it.key}>{it.node}</Fragment>
      ))}
    </>
  );
}

export { ThinkingBlock } from './ThinkingBlock';
export { RunOver } from './RunOver';
export { OptimizedImage } from './OptimizedImage';
