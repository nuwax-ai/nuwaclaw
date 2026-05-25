import { type ReactNode } from 'react';
import { useMarkdownRendererContext } from './context';

/**
 * Renders `<task-result>` custom element — a clickable file card.
 * Port of nuwax `TaskResult`.
 */
export function TaskResult({
  children,
}: {
  children?: ReactNode;
  node?: unknown;
}): JSX.Element | null {
  const { onFilePreview, conversationId } = useMarkdownRendererContext();

  if (!children) return null;

  try {
    const childArr = Array.isArray(children) ? children : [children];

    const fileDescription = childArr
      .filter((item: unknown) => isElementType(item, 'description'))
      .map((item: unknown) => extractChildren(item))
      .join('');

    const fileName = childArr
      .filter((item: unknown) => isElementType(item, 'file'))
      .map((item: unknown) => extractChildren(item))
      .join('');

    if (!fileName) return null;

    const handleClick = () => {
      if (!onFilePreview) return;
      let fileId = fileName;
      if (conversationId) {
        const split = fileName.split(`${conversationId}/`);
        if (split.length > 1) fileId = split.pop()!;
      }
      if (fileId.endsWith('/')) fileId = fileId.slice(0, -1);
      onFilePreview(fileId, { conversationId });
    };

    const label = fileDescription || fileName;

    return (
      <div
        className={`md-task-result${onFilePreview ? ' md-task-result--clickable' : ''}`}
        onClick={onFilePreview ? handleClick : undefined}
        title={label}
      >
        <span className="md-task-result-icon" aria-hidden>📄</span>
        <span className="md-task-result-action">{label}</span>
        {onFilePreview && <span className="md-task-result-arrow" aria-hidden>›</span>}
      </div>
    );
  } catch {
    return null;
  }
}

function isElementType(node: unknown, type: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const props = (node as { type?: string }).type;
  return props === type;
}

function extractChildren(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractChildren).join('');
  const props = (node as { props?: { children?: unknown } }).props;
  if (props?.children) return extractChildren(props.children);
  return '';
}

export default TaskResult;
