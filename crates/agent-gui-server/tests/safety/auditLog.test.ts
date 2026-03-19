/**
 * Unit tests for safety/auditLog.ts — ring buffer, record, getEntries, clear.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLog } from '../../src/safety/auditLog.js';

describe('AuditLog', () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog();
  });

  it('starts empty', () => {
    expect(log.length).toBe(0);
    expect(log.getEntries()).toHaveLength(0);
  });

  it('records entries with auto-generated timestamp', () => {
    log.record({ tool: 'gui_click', args: { x: 100, y: 200 }, success: true });
    expect(log.length).toBe(1);
    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('gui_click');
    expect(entries[0].args).toEqual({ x: 100, y: 200 });
    expect(entries[0].success).toBe(true);
    expect(entries[0].timestamp).toBeDefined();
  });

  it('returns entries most recent first', () => {
    log.record({ tool: 'tool_1', args: {}, success: true });
    log.record({ tool: 'tool_2', args: {}, success: true });
    log.record({ tool: 'tool_3', args: {}, success: true });
    const entries = log.getEntries();
    expect(entries[0].tool).toBe('tool_3');
    expect(entries[1].tool).toBe('tool_2');
    expect(entries[2].tool).toBe('tool_1');
  });

  it('limits entries by count parameter', () => {
    for (let i = 0; i < 10; i++) {
      log.record({ tool: `tool_${i}`, args: {}, success: true });
    }
    const entries = log.getEntries(3);
    expect(entries).toHaveLength(3);
    expect(entries[0].tool).toBe('tool_9');
    expect(entries[1].tool).toBe('tool_8');
    expect(entries[2].tool).toBe('tool_7');
  });

  it('wraps around at 1000 entries (ring buffer)', () => {
    for (let i = 0; i < 1050; i++) {
      log.record({ tool: `tool_${i}`, args: {}, success: true });
    }
    // Size should cap at 1000
    expect(log.length).toBe(1000);
    const entries = log.getEntries(1);
    expect(entries[0].tool).toBe('tool_1049');

    // Oldest entry should be tool_50 (0-49 were overwritten)
    const allEntries = log.getEntries();
    expect(allEntries).toHaveLength(1000);
    expect(allEntries[allEntries.length - 1].tool).toBe('tool_50');
  });

  it('clears all entries', () => {
    for (let i = 0; i < 5; i++) {
      log.record({ tool: `tool_${i}`, args: {}, success: true });
    }
    expect(log.length).toBe(5);
    log.clear();
    expect(log.length).toBe(0);
    expect(log.getEntries()).toHaveLength(0);
  });

  it('records durationMs when provided', () => {
    log.record({ tool: 'gui_screenshot', args: {}, success: true, durationMs: 150 });
    const entries = log.getEntries();
    expect(entries[0].durationMs).toBe(150);
  });

  it('works correctly after clear and re-record', () => {
    log.record({ tool: 'before_clear', args: {}, success: true });
    log.clear();
    log.record({ tool: 'after_clear', args: {}, success: true });
    expect(log.length).toBe(1);
    expect(log.getEntries()[0].tool).toBe('after_clear');
  });
});
