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

  const label = streaming ? 'Thinking' : 'Thought';

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
          {streaming ? renderDots() : '\u{1F4A1}' /* bulb */}
        </span>
        <span className="md-thinking-label">{label}</span>
        <span
          className={`md-thinking-chevron${open ? ' md-thinking-chevron--open' : ''}`}
          aria-hidden
        >
          {/* simple unicode chevron; CSS rotates it when open */}
          {'▾'}
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
