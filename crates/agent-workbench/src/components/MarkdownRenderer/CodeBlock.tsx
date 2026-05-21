import { useCallback, useState, type ReactNode } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { normalizeLanguageId } from './highlighter';

export interface CodeBlockProps {
  /** Raw source code (trailing newline already stripped). */
  code: string;
  /** Language identifier from the markdown fence info string. */
  language: string;
  /** Original children from react-markdown, used as fallback if rendering fails. */
  fallbackChildren?: ReactNode;
}

const COPY_RESET_MS = 2000;

/**
 * Fenced code block with Prism highlight, language label, and copy button.
 *
 * The original markdown class name is preserved on the inner <code> element so
 * external integrations that target `language-xxx` keep working.
 */
export function CodeBlock({ code, language, fallbackChildren }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const displayLanguage = language || 'text';
  const prismLanguage = normalizeLanguageId(language);

  const handleCopy = useCallback(() => {
    const writeText =
      typeof navigator !== 'undefined' && navigator.clipboard
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
    if (!writeText) return;
    writeText(code).then(
      () => {
        setCopied(true);
        if (typeof window !== 'undefined') {
          window.setTimeout(() => setCopied(false), COPY_RESET_MS);
        }
      },
      () => {
        // Clipboard rejected (no permission, secure context, etc.) - swallow.
      },
    );
  }, [code]);

  return (
    <div className="md-code-block" data-language={displayLanguage}>
      <div className="md-code-toolbar">
        <span className="md-code-lang">{displayLanguage}</span>
        <button
          type="button"
          className={`md-code-copy-btn${copied ? ' md-code-copy-btn--copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="md-code-content">
        <Highlight code={code} language={prismLanguage} theme={themes.github}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`${className} md-code-pre`} style={style}>
              <code className={`language-${displayLanguage}`}>
                {tokens.length === 0 && fallbackChildren !== undefined ? (
                  fallbackChildren
                ) : (
                  tokens.map((line, lineIndex) => {
                    const lineProps = getLineProps({ line });
                    const { key: _lineKey, ...restLineProps } = lineProps;
                    return (
                      <span key={lineIndex} {...restLineProps}>
                        {line.map((token, tokenIndex) => {
                          const tokenProps = getTokenProps({ token });
                          const { key: _tokenKey, ...restTokenProps } = tokenProps;
                          return <span key={tokenIndex} {...restTokenProps} />;
                        })}
                        {lineIndex < tokens.length - 1 ? '\n' : ''}
                      </span>
                    );
                  })
                )}
              </code>
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
