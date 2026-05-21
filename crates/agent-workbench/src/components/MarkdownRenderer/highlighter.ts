/*
 * Code highlighter helper for MarkdownRenderer.
 *
 * Originally drafted against shiki, but shiki + a useful set of grammars adds
 * ~1.3 MB to the library bundle even with hand-picked language imports. We
 * therefore use prism-react-renderer which ships a tree-shakable Prism core
 * plus a handful of bundled languages and themes (~30 KB gzipped).
 *
 * The Highlight component is consumed in CodeBlock.tsx directly; this module
 * centralizes language ID normalization and lists the supported set so we
 * have a single place to update when grammars change.
 */

const SUPPORTED_LANGUAGE_IDS = new Set<string>([
  'typescript',
  'ts',
  'tsx',
  'javascript',
  'js',
  'jsx',
  'json',
  'markdown',
  'md',
  'html',
  'css',
  'yaml',
  'yml',
  'bash',
  'shell',
  'sh',
  'zsh',
  'python',
  'py',
  'go',
  'rust',
  'rs',
  'java',
  'sql',
  'diff',
  'text',
  'plaintext',
  'txt',
]);

const ALIAS_MAP: Record<string, string> = {
  // Map editor-style language names to prism-react-renderer ids.
  // The bundled Prism core ships: markup, css, clike, javascript, jsx,
  // typescript, tsx, json, bash, plus a handful more. Anything else
  // falls back to plain text via Highlight's safety net.
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  py: 'python',
  rs: 'rust',
  md: 'markdown',
  yml: 'yaml',
  ts: 'typescript',
  js: 'javascript',
  plaintext: 'text',
  txt: 'text',
};

/**
 * Normalize a language string from a markdown fence to a Prism language ID.
 *
 * Returns `'text'` for empty/unknown languages so the caller can render the
 * block in plain monospace without crashing.
 */
export function normalizeLanguageId(lang: string | undefined | null): string {
  if (!lang) return 'text';
  const lowered = lang.toLowerCase().trim();
  if (!lowered) return 'text';
  const mapped = ALIAS_MAP[lowered] ?? lowered;
  if (!SUPPORTED_LANGUAGE_IDS.has(mapped)) return 'text';
  return mapped;
}

export function isLanguageSupported(lang: string | undefined | null): boolean {
  return normalizeLanguageId(lang) !== 'text' || lang === 'text';
}

export const SUPPORTED_LANGUAGES: readonly string[] = Array.from(SUPPORTED_LANGUAGE_IDS);
