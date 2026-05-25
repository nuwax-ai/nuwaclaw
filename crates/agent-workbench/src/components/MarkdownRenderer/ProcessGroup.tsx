import { memo, useState, type ReactNode } from 'react';

/**
 * Collapsible group for consecutive `<markdown-custom-process>` elements.
 * Port of nuwax `MarkdownCustomProcessGroup`.
 */
export function ProcessGroup({ children }: { children: ReactNode }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  const visibleCount = countVisible(children);
  if (visibleCount === 0) return null;

  return (
    <div className="md-process-group">
      <button
        type="button"
        className="md-process-group-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="md-process-group-title">Executed processes</span>
        <span className="md-process-group-right">
          <span className="md-process-group-count">
            {visibleCount} items
          </span>
          <span
            className={`md-process-group-chevron${expanded ? ' md-process-group-chevron--open' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </span>
      </button>
      {expanded && <div className="md-process-group-content">{children}</div>}
    </div>
  );
}

function countVisible(children: ReactNode): number {
  let count = 0;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    if (!child || typeof child !== 'object') continue;
    // Skip Event-type children (nuwax parity)
    const props = (child as { props?: { type?: string } }).props;
    if (props?.type === 'Event') continue;
    count++;
  }
  return count;
}

export default memo(ProcessGroup);
