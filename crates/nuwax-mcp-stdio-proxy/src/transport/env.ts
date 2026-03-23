/**
 * Environment utilities for child processes
 */

/**
 * Build a clean env for child processes (strips ELECTRON_RUN_AS_NODE)
 */
export function buildBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Child MCP servers should run normally, not as Electron Node.js instances
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
