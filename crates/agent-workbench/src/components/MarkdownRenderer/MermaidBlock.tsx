import { useEffect, useRef, useState } from 'react';

let mermaidIdCounter = 0;

/**
 * Renders a mermaid code block as an SVG diagram.
 */
export function MermaidBlock({ code }: { code: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code.trim()) return;
    let cancelled = false;
    const id = `mermaid-${++mermaidIdCounter}`;

    import('mermaid').then(async ({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });
      try {
        const { svg: rendered } = await mermaid.render(id, code.trim());
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Mermaid render error');
      }
    }).catch(() => {
      if (!cancelled) setError('Mermaid not available');
    });

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="md-mermaid md-mermaid-error">
        <pre><code>{code}</code></pre>
        <div className="md-mermaid-error-msg">Diagram render failed: {error}</div>
      </div>
    );
  }

  if (svg) {
    return (
      <div className="md-mermaid" ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} />
    );
  }

  return <div className="md-mermaid md-mermaid-loading">Rendering diagram...</div>;
}
