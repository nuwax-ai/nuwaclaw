/**
 * Structured error types for agent-gui-server
 */

/** Configuration validation error */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Desktop automation operation error */
export class DesktopError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: Error,
  ) {
    super(`Desktop operation "${operation}" failed: ${cause.message}`);
    this.name = 'DesktopError';
  }
}

/** Coordinate resolution error */
export class CoordinateError extends Error {
  constructor(
    public readonly coordinateMode: string,
    public readonly rawX: number,
    public readonly rawY: number,
  ) {
    super(`Coordinate resolution failed (mode: ${coordinateMode}, x: ${rawX}, y: ${rawY})`);
    this.name = 'CoordinateError';
  }
}

/** Safety layer blocked operation */
export class SafetyError extends Error {
  constructor(
    public readonly keys: string[],
    public readonly reason: string,
  ) {
    super(`Blocked: ${reason} (keys: ${keys.join('+')})`);
    this.name = 'SafetyError';
  }
}

/** Task execution error */
export class TaskExecutionError extends Error {
  constructor(
    public readonly taskText: string,
    public readonly step: number,
    public readonly cause: Error,
  ) {
    super(`Task execution failed at step ${step}: ${cause.message}`);
    this.name = 'TaskExecutionError';
  }
}
