import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children, ...props }) => (
          <pre className="open-app-md-pre" {...props}>
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <code className={`open-app-md-code-block ${className ?? ''}`} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className="open-app-md-code-inline" {...props}>
              {children}
            </code>
          );
        },
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
