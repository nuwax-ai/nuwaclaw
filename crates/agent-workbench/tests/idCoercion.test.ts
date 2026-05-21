import { describe, expect, it } from 'vitest';

import { coerceNumericId, fromApiId, toApiId } from '../src/adapters/idCoercion';

describe('toApiId (outbound: workbench string → nuwax API)', () => {
  it('coerces a pure numeric string to a number', () => {
    expect(toApiId('123')).toBe(123);
    expect(typeof toApiId('123')).toBe('number');
  });

  it('keeps a non-numeric string as a string fallback', () => {
    expect(toApiId('abc')).toBe('abc');
    expect(typeof toApiId('abc')).toBe('string');
  });

  it('keeps a decimal string as a string (only integer IDs get coerced)', () => {
    expect(toApiId('12.5')).toBe('12.5');
  });

  it('returns empty string unchanged when input is empty', () => {
    // Empty string is preserved as-is; nuwax API would itself reject this.
    expect(toApiId('')).toBe('');
  });

  it('does not throw on undefined input', () => {
    expect(() => toApiId(undefined as unknown as string)).not.toThrow();
    expect(toApiId(undefined as unknown as string)).toBe('');
  });

  it('does not throw on null input', () => {
    expect(() => toApiId(null as unknown as string)).not.toThrow();
    expect(toApiId(null as unknown as string)).toBe('');
  });

  it('preserves precision on unsafe-integer strings (keeps as string)', () => {
    // 9999999999999999999 > Number.MAX_SAFE_INTEGER (2^53 - 1 = 9007199254740991).
    // Converting to number would drop precision; we must keep the string.
    const big = '9999999999999999999';
    expect(toApiId(big)).toBe(big);
    expect(typeof toApiId(big)).toBe('string');
  });

  it('coerces a numeric input back to number when safe', () => {
    expect(toApiId(42 as unknown as string)).toBe(42);
    expect(toApiId(Number.MAX_SAFE_INTEGER as unknown as string)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('falls back to string for unsafe-integer number input', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 2; // becomes imprecise as number.
    expect(toApiId(unsafe as unknown as string)).toBe(String(unsafe));
  });

  it('rejects numeric strings with leading zeros that lose information', () => {
    // "0123" would parse to 123, losing the leading zero. Keep as string.
    expect(toApiId('0123')).toBe('0123');
  });
});

describe('fromApiId (inbound: nuwax API → workbench string)', () => {
  it('coerces a number to a string', () => {
    expect(fromApiId(123)).toBe('123');
    expect(typeof fromApiId(123)).toBe('string');
  });

  it('passes a string through untouched', () => {
    expect(fromApiId('abc')).toBe('abc');
  });

  it('returns "" for null (callers should branch on input if they need to distinguish)', () => {
    // Documented behavior: null and undefined collapse to "" to keep the
    // return type a non-optional string. Callers needing "missing vs empty"
    // semantics should test the input before calling.
    expect(fromApiId(null)).toBe('');
  });

  it('returns "" for undefined', () => {
    expect(fromApiId(undefined)).toBe('');
  });

  it('returns "0" for the number zero (no falsy-bug)', () => {
    // Regression: `String(value ?? '')` works, but `value || String(value)` does not;
    // ensure 0 survives the round-trip as "0".
    expect(fromApiId(0)).toBe('0');
  });

  it('returns "" for NaN / non-finite numbers (treat as missing)', () => {
    expect(fromApiId(Number.NaN)).toBe('');
    expect(fromApiId(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('passes the empty string through', () => {
    expect(fromApiId('')).toBe('');
  });
});

describe('coerceNumericId (legacy alias)', () => {
  it('behaves identically to toApiId for backward compatibility', () => {
    expect(coerceNumericId('456')).toBe(456);
    expect(coerceNumericId('hello')).toBe('hello');
    expect(coerceNumericId(789)).toBe(789);
  });
});
