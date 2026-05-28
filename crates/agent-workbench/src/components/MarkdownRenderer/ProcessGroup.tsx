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
        <span className="md-process-group-title">工具调用</span>
        <span className="md-process-group-right">
          <span className="md-process-group-count">
            {visibleCount} 项
          </span>
          <span
            className={`md-process-group-chevron${expanded ? ' md-process-group-chevron--open' : ''}`}
            aria-hidden
          >
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
