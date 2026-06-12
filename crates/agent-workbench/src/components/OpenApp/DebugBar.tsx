import type { WorkbenchMessage } from '../../types';

export interface DebugBarProps {
  /** The last completed assistant message. */
  message: WorkbenchMessage;
  /** Elapsed time in ms for the full conversation turn (optional). */
  elapsedMs?: number;
  labels: {
    debugTokens: string;
    debugTime: string;
  };
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * DebugBar — a compact row shown beneath the last assistant message,
 * mirroring nuwax `ChatBottomDebug`. Displays token usage and elapsed time.
 */
export function DebugBar({ message, elapsedMs, labels }: DebugBarProps): JSX.Element | null {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const usage = meta.tokenUsage as
    | { input?: number; output?: number; total?: number }
    | undefined;

  if (!usage && elapsedMs === undefined) return null;

  return (
    <div className="open-app-debug-bar">
      {usage && (
        <span className="open-app-debug-item" title={labels.debugTokens}>
          {usage.total
            ? `${formatTokens(usage.total)} ${labels.debugTokens}`
            : [
                usage.input ? `↑${formatTokens(usage.input)}` : null,
                usage.output ? `↓${formatTokens(usage.output)}` : null,
              ]
                .filter(Boolean)
                .join(' ')}
        </span>
      )}
      {elapsedMs !== undefined && elapsedMs > 0 && (
        <span className="open-app-debug-item" title={labels.debugTime}>
          {formatTime(elapsedMs)}
        </span>
      )}
    </div>
  );
}

export default DebugBar;
