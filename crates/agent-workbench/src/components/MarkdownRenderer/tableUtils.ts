import type { ReactNode } from 'react';

/**
 * Port of nuwax `extractTableToMarkdown`.
 * Converts a React table children tree back to markdown pipe syntax.
 */
export function extractTableToMarkdown(tableChildren: ReactNode): string {
  try {
    if (typeof tableChildren === 'string') return tableChildren;

    if (Array.isArray(tableChildren)) {
      const rows: string[] = [];
      let hasHeader = false;

      for (const child of tableChildren) {
        const c = child as Record<string, unknown> | null;
        if (!c) continue;

        const type = c.type;
        if (type === 'thead') {
          rows.push(...extractTableSection(c));
          hasHeader = true;
        } else if (type === 'tbody') {
          rows.push(...extractTableSection(c));
        } else if (type === 'tr') {
          const row = extractTableRow(c);
          if (row) rows.push(row);
        } else {
          const nested = (c as { props?: { children?: ReactNode } }).props?.children;
          if (nested) {
            const nestedMd = extractTableToMarkdown(nested);
            if (nestedMd) rows.push(nestedMd);
          }
        }
      }

      if (rows.length > 0) {
        if (hasHeader && rows.length > 1) {
          const headerRow = rows[0];
          const colCount = (headerRow.match(/\|/g) || []).length - 1;
          const separator = '|' + '---|'.repeat(colCount);
          return [rows[0], separator, ...rows.slice(1)].join('\n');
        }
        return rows.join('\n');
      }
    }

    if (typeof tableChildren === 'object' && tableChildren !== null) {
      const props = (tableChildren as { props?: { children?: ReactNode } }).props;
      if (props?.children) return extractTableToMarkdown(props.children);
    }

    return '';
  } catch {
    return '';
  }
}

function extractTableSection(section: Record<string, unknown>): string[] {
  const rows: string[] = [];
  const children = section.props
    ? (section.props as { children?: unknown }).children
    : undefined;
  if (!children) return rows;

  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const c = child as Record<string, unknown> | null;
    if (c?.type === 'tr') {
      const row = extractTableRow(c);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function extractTableRow(row: Record<string, unknown>): string {
  const cells: string[] = [];
  const children = row.props
    ? (row.props as { children?: unknown }).children
    : undefined;
  if (!children) return '';

  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const c = child as Record<string, unknown> | null;
    if (!c) continue;
    if (c.type === 'td' || c.type === 'th') {
      cells.push(extractCellText(c).replace(/\s+/g, ' ').trim());
    }
  }

  if (cells.length > 0) {
    return '|' + cells.map((cell) => ` ${cell} `).join('|') + '|';
  }
  return '';
}

function extractCellText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractCellText).join('');
  const props = (node as { props?: { children?: unknown } }).props;
  if (props?.children) return extractCellText(props.children);
  return '';
}
