import { useState, type ReactNode } from 'react';

/**
 * Collapsible "thinking" section, mirrors nuwax's MarkdownRenderer thinking
 * header (see nuwax `src/components/MarkdownRenderer/index.tsx` lines 73-90).
 *
 * Data shape in nuwax: a separate `thinking` prop on the renderer (the message
 * model exposes `think` + `text` side-by-side). At the workbench boundary we
 * accept it either way:
 *   - as a separate prop on this component, OR
 *   - inline in markdown text wrapped in `<thinking>...</thinking>` tags
 *     (see `extractThinking` in ./index.tsx).
 *
 * To avoid a recursive markdown renderer dependency (and to keep cost cheap
 * for thinking blocks that arrive token-by-token), we render the content as
 * plain text with `white-space: pre-wrap` rather than re-running markdown.
 * That matches nuwax's behavior — its thinking stream is also displayed as a
 * reasoning trace, not as rich markdown.
 */
export interface ThinkingBlockProps {
  content: string;
  /** Whether to render the block expanded by default. Default: false. */
  defaultOpen?: boolean;
  /**
   * When true, show a "thinking" (animated) label instead of the finished
   * "thought" label. Mirrors nuwax's `isThinkingFinished` check (false until
   * the answer arrives).
   */
  streaming?: boolean;
}

export function ThinkingBlock({
  content,
  defaultOpen = false,
  streaming = false,
}: ThinkingBlockProps): JSX.Element | null {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  if (!content || content.trim() === '') return null;

  const label = streaming ? 'Thinking' : '已思考';

  return (
    <div
      className={`md-thinking-block${open ? ' md-thinking-block--open' : ''}`}
      data-streaming={streaming ? 'true' : 'false'}
    >
      <button
        type="button"
        className="md-thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="md-thinking-icon" aria-hidden>
          {streaming ? renderDots() : <BulbIcon />}
        </span>
        <span className="md-thinking-label">{label}</span>
        <span
          className={`md-thinking-chevron${open ? ' md-thinking-chevron--open' : ''}`}
          aria-hidden
        >
          <DownIcon />
        </span>
      </button>
      {open && (
        <div className="md-thinking-content" data-testid="md-thinking-content">
          {renderContent(content)}
        </div>
      )}
    </div>
  );
}

/**
 * Animated dots ("...") for the streaming state. Implemented purely with CSS
 * animation defined in styles.css so we avoid any runtime cost.
 */
function renderDots(): ReactNode {
  return (
    <span className="md-thinking-dots" aria-label="thinking">
      <span className="md-thinking-dot" />
      <span className="md-thinking-dot" />
      <span className="md-thinking-dot" />
    </span>
  );
}

/**
 * Render thinking content as plain pre-wrapped text. We split on newlines so
 * paragraph breaks are visible without invoking a nested markdown parser.
 */
function renderContent(content: string): ReactNode {
  return content;
}

/**
 * Ant Design BulbOutlined SVG — inline to avoid @ant-design/icons dependency.
 * Matches nuwax's `<BulbOutlined />` icon in the thinking header.
 */
function BulbIcon(): JSX.Element {
  return (
    <svg
      viewBox="64 64 896 896"
      focusable="false"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M632 888H392c-4.4 0-8 3.6-8 8v32c0 17.7 14.3 32 32 32h192c17.7 0 32-14.3 32-32v-32c0-4.4-3.6-8-8-8M512 64c-181.1 0-328 146.9-328 328 0 121.4 66 227.4 164 284.1V792c0 17.7 14.3 32 32 32h264c17.7 0 32-14.3 32-32V676.1c98-56.7 164-162.7 164-284.1 0-181.1-146.9-328-328-328m127.3 541.6l-15.7 10.4V760H392.4V616l-15.7-10.4C298.1 552.8 248 464.3 248 370c0-145.6 118.4-264 264-264s264 118.4 264 264c0 94.3-50.1 182.8-136.7 235.6z" />
    </svg>
  );
}

/**
 * Ant Design DownOutlined SVG — inline to avoid @ant-design/icons dependency.
 * Matches nuwax's `<DownOutlined />` chevron in the thinking header.
 */
function DownIcon(): JSX.Element {
  return (
    <svg
      viewBox="64 64 896 896"
      focusable="false"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z" />
    </svg>
  );
}
