/**
 * Unit tests for utils/errors.ts — 5 structured error classes.
 */

import { describe, it, expect } from 'vitest';
import {
  ConfigError,
  DesktopError,
  CoordinateError,
  SafetyError,
  TaskExecutionError,
} from '../../src/utils/errors.js';

describe('ConfigError', () => {
  it('sets name and message', () => {
    const err = new ConfigError('API_KEY is required');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConfigError');
    expect(err.message).toBe('API_KEY is required');
  });
});

describe('DesktopError', () => {
  it('sets name, operation, cause, and formatted message', () => {
    const cause = new Error('permission denied');
    const err = new DesktopError('mouse.click', cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DesktopError');
    expect(err.operation).toBe('mouse.click');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('mouse.click');
    expect(err.message).toContain('permission denied');
  });

  it('operation is readonly', () => {
    const err = new DesktopError('screenshot', new Error('fail'));
    expect(err.operation).toBe('screenshot');
  });
});

describe('CoordinateError', () => {
  it('sets name, coordinateMode, rawX, rawY, and formatted message', () => {
    const err = new CoordinateError('normalized-1000', 500, 300);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CoordinateError');
    expect(err.coordinateMode).toBe('normalized-1000');
    expect(err.rawX).toBe(500);
    expect(err.rawY).toBe(300);
    expect(err.message).toContain('normalized-1000');
    expect(err.message).toContain('500');
    expect(err.message).toContain('300');
  });
});

describe('SafetyError', () => {
  it('sets name, keys, reason, and formatted message', () => {
    const err = new SafetyError(['Meta', 'Q'], 'Quit application');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SafetyError');
    expect(err.keys).toEqual(['Meta', 'Q']);
    expect(err.reason).toBe('Quit application');
    expect(err.message).toContain('Meta+Q');
    expect(err.message).toContain('Quit application');
  });
});

describe('TaskExecutionError', () => {
  it('sets name, taskText, step, cause, and formatted message', () => {
    const cause = new Error('element not found');
    const err = new TaskExecutionError('Open Finder', 3, cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TaskExecutionError');
    expect(err.taskText).toBe('Open Finder');
    expect(err.step).toBe(3);
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('step 3');
    expect(err.message).toContain('element not found');
  });
});
