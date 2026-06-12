import { describe, expect, it } from 'vitest';
import { isFieldValueEmpty } from '../src/components/McpAskQuestion';

describe('isFieldValueEmpty', () => {
  it('treats undefined and null as empty', () => {
    expect(isFieldValueEmpty(undefined)).toBe(true);
    expect(isFieldValueEmpty(null)).toBe(true);
  });

  it('treats blank strings as empty', () => {
    expect(isFieldValueEmpty('')).toBe(true);
    expect(isFieldValueEmpty('   ')).toBe(true);
  });

  it('treats non-blank strings as non-empty', () => {
    expect(isFieldValueEmpty('hello')).toBe(false);
    expect(isFieldValueEmpty('  x  ')).toBe(false);
  });

  it('treats empty arrays as empty but non-empty arrays as filled', () => {
    expect(isFieldValueEmpty([])).toBe(true);
    expect(isFieldValueEmpty(['a'])).toBe(false);
  });

  it('treats numbers and booleans as non-empty', () => {
    expect(isFieldValueEmpty(0)).toBe(false);
    expect(isFieldValueEmpty(false)).toBe(false);
  });
});
