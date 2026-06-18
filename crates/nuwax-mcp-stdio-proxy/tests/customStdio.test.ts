import { describe, expect, it } from 'vitest';
import {
  buildWindowsBatchSpawn,
  quoteWindowsCmdArg,
} from '../src/customStdio.js';

describe('quoteWindowsCmdArg', () => {
  it('leaves simple tokens unchanged', () => {
    expect(quoteWindowsCmdArg('npx.cmd')).toBe('npx.cmd');
    expect(quoteWindowsCmdArg('--version')).toBe('--version');
  });

  it('quotes tokens with spaces and escapes embedded quotes', () => {
    expect(quoteWindowsCmdArg('C:\\Program Files\\npx.cmd')).toBe(
      '"C:\\Program Files\\npx.cmd"',
    );
    expect(quoteWindowsCmdArg('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('buildWindowsBatchSpawn', () => {
  it('wraps .cmd invocations with cmd.exe /d /s /c', () => {
    const result = buildWindowsBatchSpawn('C:\\tools\\npx.cmd', ['-y', 'pkg@1']);
    expect(result.command).toMatch(/cmd(\.exe)?$/i);
    expect(result.args).toEqual([
      '/d',
      '/s',
      '/c',
      'C:\\tools\\npx.cmd -y pkg@1',
    ]);
  });

  it('quotes paths with spaces in the cmdline', () => {
    const result = buildWindowsBatchSpawn('C:\\Program Files\\npx.cmd', [
      '--version',
    ]);
    expect(result.args[3]).toBe('"C:\\Program Files\\npx.cmd" --version');
  });
});
