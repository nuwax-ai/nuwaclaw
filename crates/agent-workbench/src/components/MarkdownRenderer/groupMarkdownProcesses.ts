/**
 * Port of nuwax `src/components/MarkdownRenderer/utils.ts` groupMarkdownProcesses.
 *
 * Synchronised with nuwax main aa297a78 (commits 4f34ca37 + 05df07d3):
 * - executeId-based deduplication for SSE streaming append scenarios
 * - name attribute URL encoding to prevent newline/quote breakage
 * - group wrapper wrapped in `<div>` to prevent inline `<p>` parsing
 *
 * Merges consecutive `<markdown-custom-process>` tags into
 * `<markdown-custom-process-group>` wrappers (2+ consecutive) or wraps
 * singles in a `<div>`. Plan-type tags act as separators.
 */

interface ProcessMatch {
  index: number;
  endIndex: number;
  executeId: string;
  tagMatch: string;
}

export function groupMarkdownProcesses(text: string): string {
  if (!text) return '';

  const blockRegex =
    /(?:\s*<(?:div|p)>\s*)?(<markdown-custom-process\b[^>]*?>(?:<\/markdown-custom-process>)?)(?:\s*<\/(?:div|p)>\s*)?/g;

  // 1. Scan all matches, extract executeId, record positions for dedup.
  const matches: ProcessMatch[] = [];
  let match: RegExpExecArray | null;
  const lastIndexMap = new Map<string, number>();

  while ((match = blockRegex.exec(text)) !== null) {
    const tagMatch = match[1];
    const executeIdMatch = tagMatch.match(
      /executeId=(?:\\"|"|\\')([^"\\]+)(?:\\"|"|\\')/i,
    );
    const executeId = executeIdMatch ? executeIdMatch[1] : null;

    if (executeId) {
      matches.push({
        index: match.index,
        endIndex: blockRegex.lastIndex,
        executeId,
        tagMatch,
      });
      lastIndexMap.set(executeId, match.index);
    }
  }

  // 2. Filter: keep only the last occurrence of each executeId.
  let dedupedText = '';
  let lastPos = 0;
  for (const m of matches) {
    if (lastIndexMap.get(m.executeId) !== m.index) {
      dedupedText += text.slice(lastPos, m.index);
      lastPos = m.endIndex;
    }
  }
  dedupedText += text.slice(lastPos);

  // 3. Process dedupedText: URL-encode name attr, normalize, group.
  let result = '';
  let lastIndex = 0;
  const currentGroup: string[] = [];
  let groupMatch: RegExpExecArray | null;

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    if (currentGroup.length >= 2) {
      result += `\n\n<div><markdown-custom-process-group>\n${currentGroup.join(
        '\n',
      )}\n</markdown-custom-process-group></div>\n\n`;
    } else {
      result += `\n\n<div>${currentGroup[0]}</div>\n\n`;
    }
    currentGroup.length = 0;
  };

  blockRegex.lastIndex = 0;
  while ((groupMatch = blockRegex.exec(dedupedText)) !== null) {
    const tagMatch = groupMatch[1];

    // URL-encode name attribute to prevent markdown HTML breakage.
    let processedTag = tagMatch;
    const nameStartIdx = tagMatch.search(/name=(?:\\"|"|\\')/);
    if (nameStartIdx !== -1) {
      const markerMatch = tagMatch
        .slice(nameStartIdx)
        .match(/name=(?:\\"|"|\\')/);
      const marker = markerMatch ? markerMatch[0] : '';
      const valueStart = nameStartIdx + marker.length;

      const tagEndIdx = tagMatch.indexOf('></markdown-custom-process>');
      const tagContentEnd =
        tagEndIdx !== -1
          ? tagEndIdx
          : tagMatch.endsWith('/>')
            ? tagMatch.length - 2
            : tagMatch.length - 1;

      const quoteLen = marker.includes('\\') ? 2 : 1;
      const valueEnd = tagContentEnd - quoteLen;

      const rawNameVal = tagMatch.slice(valueStart, valueEnd);

      // Decode HTML entities then try decodeURIComponent to avoid double-encoding.
      let decodedNameVal = rawNameVal
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
      try {
        decodedNameVal = decodeURIComponent(decodedNameVal);
      } catch {
        // leave as-is if not a valid URI component
      }
      const encodedNameVal = encodeURIComponent(decodedNameVal);

      const beforeName = tagMatch.slice(0, nameStartIdx);
      const closingTag =
        tagEndIdx !== -1
          ? '></markdown-custom-process>'
          : tagMatch.endsWith('/>')
            ? ' />'
            : '>';

      // Normalize escaped quotes in other attributes.
      const normalizedBeforeName = beforeName
        .replace(/executeId=\\"/g, 'executeId="')
        .replace(/executeId=\\'/g, 'executeId="')
        .replace(/type=\\"/g, 'type="')
        .replace(/status=\\"/g, 'status="')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");

      processedTag = `${normalizedBeforeName}name="${encodedNameVal}"${closingTag}`;
    }

    // Ensure closing tag.
    let normalizedTag = processedTag;
    if (
      !normalizedTag.endsWith('/>') &&
      !normalizedTag.includes('</markdown-custom-process>')
    ) {
      normalizedTag += '</markdown-custom-process>';
    }

    const isPlan = /type=["']Plan["']/.test(normalizedTag);

    const textBefore = dedupedText.slice(lastIndex, groupMatch.index);
    if (textBefore.trim() !== '') {
      flushGroup();
      result += textBefore;
    }

    if (isPlan) {
      flushGroup();
      result += `\n\n<div>${normalizedTag}</div>\n\n`;
    } else {
      currentGroup.push(normalizedTag);
    }

    lastIndex = blockRegex.lastIndex;
  }

  flushGroup();
  result += dedupedText.slice(lastIndex);

  return result;
}

/**
 * Convert LaTeX-style bracket delimiters to dollar-sign delimiters
 * so remark-math can parse them.
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
