/**
 * Port of nuwax `src/components/MarkdownRenderer/utils.ts` groupMarkdownProcesses.
 *
 * Merges consecutive `<markdown-custom-process>` tags into
 * `<markdown-custom-process-group>` wrappers (2+ consecutive) or wraps
 * singles in a `<div>`. Plan-type tags act as separators.
 */
export function groupMarkdownProcesses(text: string): string {
  if (!text) return '';

  const blockRegex =
    /(?:\s*<(?:div|p)>\s*)?(<markdown-custom-process\b[^>]*?>(?:<\/markdown-custom-process>)?)(?:\s*<\/(?:div|p)>\s*)?/g;

  let result = '';
  let lastIndex = 0;
  const currentGroup: string[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    if (currentGroup.length >= 2) {
      result += `\n\n<markdown-custom-process-group>\n${currentGroup.join(
        '\n',
      )}\n</markdown-custom-process-group>\n\n`;
    } else {
      result += `\n\n<div>${currentGroup[0]}</div>\n\n`;
    }
    currentGroup.length = 0;
  };

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    let tagMatch = match[1];

    if (
      !tagMatch.endsWith('/>') &&
      !tagMatch.includes('</markdown-custom-process>')
    ) {
      tagMatch += '</markdown-custom-process>';
    }

    const isPlan = /type=["']Plan["']/.test(tagMatch);

    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore.trim() !== '') {
      flushGroup();
      result += textBefore;
    }

    if (isPlan) {
      flushGroup();
      result += `\n\n<div>${tagMatch}</div>\n\n`;
    } else {
      currentGroup.push(tagMatch);
    }

    lastIndex = blockRegex.lastIndex;
  }

  flushGroup();
  result += text.slice(lastIndex);

  return result;
}

/**
 * Port of nuwax replaceMathBracket — converts `\[...\]` and `\(...\)` to
 * `$$...$$` and `$...$` for remark-math compatibility.
 */
export function replaceMathBracket(text: string): string {
  const delimiters = [
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
  ];

  let result = '';
  let pos = 0;

  while (pos < text.length) {
    let matched = false;
    for (const { left, right, display } of delimiters) {
      if (text.slice(pos).startsWith(left)) {
        const closeIdx = text.indexOf(right, pos + left.length);
        if (closeIdx !== -1) {
          const content = text.slice(pos + left.length, closeIdx);
          const delim = display ? '$$' : '$';
          result += `${delim}${content}${delim}`;
          pos = closeIdx + right.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      result += text[pos];
      pos++;
    }
  }

  return result;
}
