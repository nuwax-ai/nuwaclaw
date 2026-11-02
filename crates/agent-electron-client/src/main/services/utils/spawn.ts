/**
 * Spawn utility functions
 *
 * Provides cross-platform spawn wrappers that handle Windows-specific requirements.
 */

import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import { isWindows } from '../system/shellEnv';

/**
 * Cross-platform spawn wrapper that automatically adds shell: true on Windows.
 *
 * On Windows, spawning .cmd files (like npm.cmd) requires shell: true.
 * This wrapper ensures consistent behavior across platforms.
 *
 * @param command - The command to spawn
 * @param args - Arguments to pass to the command
 * @param options - Spawn options (shell option will be overridden on Windows)
 * @returns ChildProcess instance
 */
export function spawnCrossPlatform(
  command: string,
  args: string[],
  options?: SpawnOptions,
): ChildProcess {
  return spawn(command, args, {
    ...options,
    shell: isWindows(),
  });
}

/**
 * Get the platform-specific npm command name
 *
 * @returns 'npm.cmd' on Windows, 'npm' on other platforms
 */
export function getNpmCommand(): string {
  return isWindows() ? 'npm.cmd' : 'npm';
}

/**
 * Get the platform-specific node command name
 *
 * @returns 'node.cmd' on Windows, 'node' on other platforms
 */
export function getNodeCommand(): string {
  return isWindows() ? 'node.cmd' : 'node';
}

/**
 * Get the platform-specific command checker
 *
 * @returns 'where' on Windows, 'which' on other platforms
 */
export function getCommandChecker(): string {
  return isWindows() ? 'where' : 'which';
}
