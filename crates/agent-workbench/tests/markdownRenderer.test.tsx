/*
 * Tests for MarkdownRenderer / CodeBlock highlight pipeline.
 *
 * Vitest runs in a 'node' environment (no jsdom available in this workspace),
 * so we exercise the renderer with `renderToStaticMarkup` from react-dom/server.
 * That covers the markup contract (language label, copy button, syntax-token
 * spans) without needing a browser environment.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MarkdownRenderer,
  ThinkingBlock,
  RunOver,
  OptimizedImage,
  extractThinking,
  parseSegments,
  type RunOverStep,
} from '../src/components/MarkdownRenderer';
import { normalizeLanguageId, isLanguageSupported } from '../src/components/MarkdownRenderer/highlighter';

function render(markdown: string): string {
  return renderToStaticMarkup(<MarkdownRenderer content={markdown} />);
}

function renderWithProps(props: Parameters<typeof MarkdownRenderer>[0]): string {
  return renderToStaticMarkup(<MarkdownRenderer {...props} />);
}

describe('MarkdownRenderer code blocks', () => {
  it('renders a fenced typescript block with language label and copy button', () => {
    const html = render('```ts\nconst x: number = 1;\n```');
    expect(html).toContain('md-code-block');
    expect(html).toContain('md-code-toolbar');
    expect(html).toContain('md-code-lang');
    expect(html).toContain('>ts<');
    expect(html).toContain('md-code-copy-btn');
    expect(html).toContain('>Copy<');
    // Prism should have produced at least one tokenized span.
    expect(html).toMatch(/class="token /);
  });

  it('falls back to plain text for unknown languages without crashing', () => {
    const html = render('```nonexistentlanguage\nfoo bar\n```');
    expect(html).toContain('md-code-block');
    expect(html).toContain('>nonexistentlanguage<');
    // The raw text must survive the fallback path.
    expect(html).toContain('foo bar');
    // Copy button is still present.
    expect(html).toContain('md-code-copy-btn');
  });

  it('renders inline code without the block toolbar', () => {
    const html = render('Use the `foo()` helper.');
    expect(html).toContain('open-app-md-code-inline');
    expect(html).toContain('>foo()<');
    // No block-level chrome leaks into inline code.
    expect(html).not.toContain('md-code-block');
    expect(html).not.toContain('md-code-toolbar');
    expect(html).not.toContain('md-code-copy-btn');
  });

  it('preserves the original language identifier on the inner <code> class', () => {
    // Verifies the language- class is kept on inner <code> for downstream consumers.
    const html = render('```python\nprint("hi")\n```');
    expect(html).toContain('language-python');
    expect(html).toContain('>python<');
  });

  it('renders a block with no language (bare ```) as plain text', () => {
    const html = render('```\nfoo\nbar\n```');
    expect(html).toContain('md-code-block');
    expect(html).toContain('foo');
    expect(html).toContain('bar');
  });
});

describe('highlighter helpers', () => {
  it('normalizes common aliases', () => {
    expect(normalizeLanguageId('ts')).toBe('typescript');
    expect(normalizeLanguageId('js')).toBe('javascript');
    expect(normalizeLanguageId('sh')).toBe('bash');
    expect(normalizeLanguageId('zsh')).toBe('bash');
    expect(normalizeLanguageId('py')).toBe('python');
    expect(normalizeLanguageId('rs')).toBe('rust');
    expect(normalizeLanguageId('md')).toBe('markdown');
    expect(normalizeLanguageId('yml')).toBe('yaml');
  });

  it('returns "text" for unknown or empty languages', () => {
    expect(normalizeLanguageId('')).toBe('text');
    expect(normalizeLanguageId(null)).toBe('text');
    expect(normalizeLanguageId(undefined)).toBe('text');
    expect(normalizeLanguageId('   ')).toBe('text');
    expect(normalizeLanguageId('totallyMadeUpLang')).toBe('text');
  });

  it('is case-insensitive', () => {
    expect(normalizeLanguageId('TypeScript')).toBe('typescript');
    expect(normalizeLanguageId('  Python  ')).toBe('python');
  });

  it('isLanguageSupported recognizes a known language', () => {
    expect(isLanguageSupported('typescript')).toBe(true);
    expect(isLanguageSupported('ts')).toBe(true);
    expect(isLanguageSupported('bogus')).toBe(false);
  });
});

describe('extractThinking helper', () => {
  it('returns empty thinking when no tag present', () => {
    const r = extractThinking('plain text only');
    expect(r.thinking).toBe('');
    expect(r.rest).toBe('plain text only');
  });

  it('extracts the first <thinking> block and removes it from rest', () => {
    const r = extractThinking('before<thinking>reasoning here</thinking>after');
    expect(r.thinking).toBe('reasoning here');
    expect(r.rest).toBe('beforeafter');
  });

  it('handles multi-line thinking content (non-greedy)', () => {
    const r = extractThinking(
      'Q: hi\n<thinking>\nLine 1\nLine 2\n</thinking>\nAnswer: hello',
    );
    expect(r.thinking).toContain('Line 1');
    expect(r.thinking).toContain('Line 2');
    expect(r.rest).not.toContain('<thinking>');
    expect(r.rest).toContain('Answer: hello');
  });

  it('is case-insensitive on the tag name', () => {
    const r = extractThinking('<Thinking>upper</Thinking> rest');
    expect(r.thinking).toBe('upper');
    expect(r.rest.trim()).toBe('rest');
  });
});

describe('MarkdownRenderer thinking integration', () => {
  it('renders inline <thinking> tag as a ThinkingBlock and strips it from body', () => {
    const html = render(
      '<thinking>step by step reasoning</thinking>Final answer here.',
    );
    expect(html).toContain('md-thinking-block');
    expect(html).toContain('md-thinking-toggle');
    expect(html).toContain('已思考'); // not streaming → "已思考" label
    expect(html).toContain('Final answer here');
    // The literal thinking tag must NOT leak into the markdown body.
    expect(html).not.toContain('<thinking>');
    expect(html).not.toContain('&lt;thinking&gt;');
  });

  it('accepts an explicit thinking prop that overrides inline tags', () => {
    const html = renderWithProps({
      content: '<thinking>inline</thinking>body',
      thinking: 'explicit',
      thinkingStreaming: true,
    });
    expect(html).toContain('md-thinking-block');
    expect(html).toContain('Thinking'); // streaming label
    // We pass defaultOpen=false → content not rendered; we just verify the
    // streaming label was used (proves thinking prop won, not inline tag).
    expect(html).toContain('data-streaming="true"');
  });

  it('renders no thinking block when neither prop nor tag is present', () => {
    const html = render('Just a plain response.');
    expect(html).not.toContain('md-thinking-block');
  });
});

describe('ThinkingBlock component', () => {
  it('returns null for empty content', () => {
    const html = renderToStaticMarkup(<ThinkingBlock content="" />);
    expect(html).toBe('');
  });

  it('renders closed by default and shows the chevron', () => {
    const html = renderToStaticMarkup(<ThinkingBlock content="hello" />);
    expect(html).toContain('md-thinking-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('md-thinking-chevron');
    // Content panel is NOT rendered when closed.
    expect(html).not.toContain('md-thinking-content');
  });

  it('renders content when defaultOpen is true', () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock content="visible content" defaultOpen />,
    );
    expect(html).toContain('md-thinking-content');
    expect(html).toContain('visible content');
    expect(html).toContain('aria-expanded="true"');
  });

  it('shows streaming dots in streaming mode', () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock content="x" streaming />,
    );
    expect(html).toContain('data-streaming="true"');
    expect(html).toContain('md-thinking-dots');
    expect(html).toContain('Thinking');
    expect(html).not.toContain('>Thought<');
  });
});

describe('RunOver component', () => {
  const sampleSteps: RunOverStep[] = [
    {
      id: 'exec-1',
      name: 'web.search',
      status: 'done',
      durationMs: 420,
      args: '{"q":"hello"}',
      output: '{"results":[]}',
    },
    {
      id: 'exec-2',
      name: 'web.fetch',
      status: 'done',
      durationMs: 1850,
    },
  ];

  it('renders a summary with the step count and "Run complete" label when done', () => {
    const html = renderToStaticMarkup(<RunOver steps={sampleSteps} status="done" />);
    expect(html).toContain('md-runover');
    expect(html).toContain('md-runover--done');
    expect(html).toContain('Run complete');
    expect(html).toContain('(2)');
    // Steps panel hidden by default (closed).
    expect(html).not.toContain('md-runover-steps');
  });

  it('returns null when no steps and status is done', () => {
    const html = renderToStaticMarkup(<RunOver steps={[]} status="done" />);
    expect(html).toBe('');
  });

  it('renders running label even with no steps', () => {
    const html = renderToStaticMarkup(<RunOver steps={[]} status="running" />);
    expect(html).toContain('md-runover--running');
    expect(html).toContain('Running');
  });

  it('shows the latest step name in the running label when steps exist', () => {
    const html = renderToStaticMarkup(
      <RunOver
        steps={[{ id: 'e1', name: 'analyze', status: 'executing' }]}
        status="running"
      />,
    );
    expect(html).toContain('Calling analyze');
  });

  it('renders error status with the failure label', () => {
    const html = renderToStaticMarkup(
      <RunOver
        steps={[{ id: 'e1', name: 'failed-tool', status: 'error' }]}
        status="error"
      />,
    );
    expect(html).toContain('md-runover--error');
    expect(html).toContain('Run failed');
  });
});

describe('OptimizedImage component', () => {
  it('renders an <img> with src and alt by default', () => {
    const html = renderToStaticMarkup(
      <OptimizedImage src="https://example.com/cat.png" alt="cat" />,
    );
    expect(html).toContain('md-image-wrapper');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="cat"');
    expect(html).toContain('class="md-image"');
    expect(html).toContain('loading="lazy"');
    // Lightbox NOT shown until clicked.
    expect(html).not.toContain('md-image-lightbox');
  });

  it('omits alt attribute behavior is safe for empty alt', () => {
    const html = renderToStaticMarkup(<OptimizedImage src="https://example.com/x" />);
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/x"');
  });

  it('passes title attribute through to the img tag', () => {
    const html = renderToStaticMarkup(
      <OptimizedImage src="https://example.com/x.png" alt="x" title="x title" />,
    );
    expect(html).toContain('title="x title"');
  });
});

describe('MarkdownRenderer image integration', () => {
  it('routes markdown ![](src) through OptimizedImage', () => {
    const html = render('Look: ![cat](https://example.com/cat.png "kitty")');
    expect(html).toContain('md-image-wrapper');
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="cat"');
    expect(html).toContain('title="kitty"');
    expect(html).toContain('class="md-image"');
  });
});

describe('MarkdownRenderer runOver integration', () => {
  it('prepends a RunOver summary above the markdown body when steps are supplied', () => {
    const steps: RunOverStep[] = [
      { id: 's1', name: 'search', status: 'done', durationMs: 100 },
    ];
    const html = renderWithProps({
      content: 'final answer text',
      runOverSteps: steps,
      runOverStatus: 'done',
    });
    expect(html).toContain('md-runover');
    expect(html).toContain('Run complete');
    expect(html).toContain('final answer text');
    // RunOver should appear before the answer paragraph in DOM order.
    const runOverIndex = html.indexOf('md-runover');
    const bodyIndex = html.indexOf('final answer text');
    expect(runOverIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeGreaterThan(runOverIndex);
  });

  it('does not render RunOver chrome when no steps and status is done', () => {
    const html = renderWithProps({
      content: 'just text',
      runOverStatus: 'done',
    });
    expect(html).not.toContain('md-runover');
  });
});

describe('parseSegments helper', () => {
  it('returns a single markdown segment for plain text', () => {
    const segs = parseSegments('hello world');
    expect(segs).toEqual([{ kind: 'markdown', text: 'hello world' }]);
  });

  it('splits a single thinking tag into thinking + markdown segments', () => {
    const segs = parseSegments('<thinking>reason</thinking>answer');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: 'thinking', text: 'reason', streaming: false });
    expect(segs[1]).toEqual({ kind: 'markdown', text: 'answer' });
  });

  it('emits one runover-step per markdown-custom-process tag (self-closing)', () => {
    const raw =
      'pre ' +
      '<markdown-custom-process type="bash" status="done" executeid="e1" name="run-cmd" result-startTime="1000" result-endTime="1400"/>' +
      '<markdown-custom-process status="executing" executeid="e2" name="next"/>' +
      ' post';
    const segs = parseSegments(raw);
    const steps = segs.filter((s) => s.kind === 'runover-step');
    expect(steps).toHaveLength(2);
    if (steps[0].kind !== 'runover-step') throw new Error('expected step');
    expect(steps[0].step).toMatchObject({
      id: 'e1',
      name: 'run-cmd',
      status: 'done',
      durationMs: 400,
    });
    if (steps[1].kind !== 'runover-step') throw new Error('expected step');
    expect(steps[1].step).toMatchObject({ id: 'e2', name: 'next', status: 'executing' });
  });

  it('parses the body form (open + close) and uses the body as args', () => {
    const raw =
      '<markdown-custom-process status="done" title="reading">' +
      '{"x":1}' +
      '</markdown-custom-process>after';
    const segs = parseSegments(raw);
    expect(segs).toHaveLength(2);
    if (segs[0].kind !== 'runover-step') throw new Error('expected step');
    expect(segs[0].step.name).toBe('reading');
    expect(segs[0].step.args).toBe('{"x":1}');
    expect(segs[1]).toEqual({ kind: 'markdown', text: 'after' });
  });

  it('treats an unclosed <thinking> as streaming when streaming=true', () => {
    const segs = parseSegments('<thinking>partial reasoning', { streaming: true });
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      kind: 'thinking',
      text: 'partial reasoning',
      streaming: true,
    });
  });

  it('keeps an unclosed <thinking> as literal text when streaming=false', () => {
    const segs = parseSegments('<thinking>oops');
    // No proper closing tag and no streaming hint → opener kept as text so the
    // body content isn't lost.
    expect(segs.some((s) => s.kind === 'thinking')).toBe(false);
    const joined = segs.map((s) => (s.kind === 'markdown' ? s.text : '')).join('');
    expect(joined).toContain('oops');
  });
});

describe('MarkdownRenderer inline runover integration', () => {
  it('renders a single RunOver merging consecutive markdown-custom-process tags', () => {
    const html = render(
      'before\n' +
        '<markdown-custom-process status="done" executeid="e1" name="step-a" result-startTime="0" result-endTime="100"/>' +
        '<markdown-custom-process status="done" executeid="e2" name="step-b" result-startTime="0" result-endTime="200"/>' +
        '\nafter',
    );
    // Exactly one RunOver block — not two — confirms steps were merged.
    // We count the outer wrapper class `md-runover ` (with trailing space so we
    // don't match `md-runover-summary` etc.).
    const occurrences = html.match(/class="md-runover /g) || [];
    expect(occurrences.length).toBe(1);
    expect(html).toContain('Run complete');
    expect(html).toContain('(2)');
    // Surrounding markdown is rendered around it.
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('renders an inline <markdown-custom-process> body tag as RunOver', () => {
    const html = render(
      '<markdown-custom-process status="running" title="reading">' +
        '{"step":"ls /tmp"}' +
        '</markdown-custom-process>\nFound 3 files.',
    );
    expect(html).toContain('md-runover');
    expect(html).toContain('md-runover--running');
    expect(html).toContain('Calling reading');
    expect(html).toContain('Found 3 files');
    // Raw tag must NOT leak into the body.
    expect(html).not.toContain('<markdown-custom-process');
    expect(html).not.toContain('&lt;markdown-custom-process');
  });

  it('inline runover-step is ignored when runOverSteps prop is provided', () => {
    const explicit: RunOverStep[] = [
      { id: 'host-1', name: 'host-supplied', status: 'done', durationMs: 50 },
    ];
    const html = renderWithProps({
      content:
        '<markdown-custom-process status="done" executeid="inline-1" name="inline-step"/>\nanswer',
      runOverSteps: explicit,
      runOverStatus: 'done',
    });
    // Exactly one RunOver block — the inline step was filtered because the
    // host supplied an explicit `runOverSteps` prop.
    const matches = html.match(/class="md-runover /g) || [];
    expect(matches.length).toBe(1);
    // The merged inline step name should not appear anywhere — only host name
    // is used. Default RunOver is collapsed so we can only check class/count.
    expect(html).toContain('Run complete');
    expect(html).toContain('(1)');
    expect(html).toContain('answer');
  });

  it('renders an unclosed inline <thinking> in streaming mode and shows the streaming label', () => {
    const html = renderWithProps({
      content: 'preamble <thinking>still reasoning',
      thinkingStreaming: true,
    });
    expect(html).toContain('preamble');
    expect(html).toContain('md-thinking-block');
    expect(html).toContain('data-streaming="true"');
    expect(html).toContain('Thinking'); // streaming label
    // The raw opener must not survive as literal text.
    expect(html).not.toContain('<thinking>');
    expect(html).not.toContain('&lt;thinking&gt;');
  });

  it('renders thinking and runover-step inline in DOM order (thinking before runover)', () => {
    const html = render(
      '<thinking>analysis</thinking>' +
        '<markdown-custom-process status="done" executeid="e1" name="step-1"/>' +
        'final',
    );
    const thinkingIdx = html.indexOf('md-thinking-block');
    const runoverIdx = html.indexOf('md-runover');
    const finalIdx = html.indexOf('final');
    expect(thinkingIdx).toBeGreaterThanOrEqual(0);
    expect(runoverIdx).toBeGreaterThan(thinkingIdx);
    expect(finalIdx).toBeGreaterThan(runoverIdx);
  });
});
