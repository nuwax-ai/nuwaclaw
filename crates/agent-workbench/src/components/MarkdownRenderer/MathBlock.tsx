import { useEffect, useRef, useState } from 'react';

/**
 * Renders LaTeX math via KaTeX. Falls back to a code block on error.
 */
export function MathBlock({
  math,
  displayMode,
}: {
  math: string;
  displayMode: boolean;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current || !math) return;
    let cancelled = false;
    import('katex').then(({ default: katex }) => {
      if (cancelled) return;
      try {
        katex.render(math, ref.current!, {
          displayMode,
          throwOnError: true,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Math render error');
      }
    }).catch(() => {
      setError('KaTeX not available');
    });
    return () => { cancelled = true; };
  }, [math, displayMode]);

  if (error) {
    return (
      <div className="md-math-error">
        <code>{math}</code>
      </div>
    );
  }

  return <span ref={ref} className={displayMode ? 'md-math-block' : 'md-math-inline'} />;
}
