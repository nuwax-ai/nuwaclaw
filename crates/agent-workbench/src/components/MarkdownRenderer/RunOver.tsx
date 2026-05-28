import { useState, type ReactNode } from 'react';

/**
 * Tool-execution visualization, mirrors nuwax's `RunOver` component
 * (see nuwax `src/components/ChatView/RunOver/index.tsx`).
 *
 * In nuwax the data comes from a message's `processingList` field — each
 * entry has `{ executeId, name, status, result?: { startTime, endTime } }`.
 * The component shows a one-line "called X" summary with the last step and
 * exposes an Antd Popover with the full step list on hover.
 *
 * At the workbench boundary we accept a normalized `RunOverStep[]` from the
 * adapter layer so this component stays decoupled from the wire format.
 * Inline parsing of nuwax's `<markdown-custom-process>` custom tag is not
 * yet wired in — see the TODO in `index.tsx`. For now this component is a
 * pure render of pre-normalized props, testable in isolation.
 */
export interface RunOverStep {
  /** Stable identifier (nuwax: `executeId`). */
  id: string;
  /** Tool name displayed in the row (nuwax: `name`). */
  name: string;
  /** Step state. Mirrors nuwax's ProcessingEnum values. */
  status: 'executing' | 'done' | 'error';
  /** Optional duration in milliseconds (nuwax: result.endTime - result.startTime). */
  durationMs?: number;
  /** Optional argument blob for the expanded view. */
  args?: string;
  /** Optional output blob for the expanded view. */
  output?: string;
}

export interface RunOverProps {
  steps: RunOverStep[];
  /** Overall status of the tool-run sequence. */
  status?: 'running' | 'done' | 'error';
}

export function RunOver({ steps, status = 'done' }: RunOverProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);

  if (!steps.length && status === 'done') return null;

  const last = steps.length > 0 ? steps[steps.length - 1] : null;
  const summaryLabel =
    status === 'running'
      ? last
        ? `Calling ${last.name}`
        : 'Running'
      : status === 'error'
        ? 'Run failed'
        : 'Run complete';

  return (
    <div className={`md-runover md-runover--${status}`} data-status={status}>
      <button
        type="button"
        className="md-runover-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`md-runover-status md-runover-status--${status}`} aria-hidden />
        <span className="md-runover-summary-label">{summaryLabel}</span>
        {steps.length > 0 && (
          <span className="md-runover-summary-count">({steps.length})</span>
        )}
        <span
          className={`md-runover-chevron${expanded ? ' md-runover-chevron--open' : ''}`}
          aria-hidden
        >
          <svg
            viewBox="64 64 896 896"
            focusable="false"
            width="1em"
            height="1em"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z" />
          </svg>
        </span>
      </button>
      {expanded && (
        <ul className="md-runover-steps" data-testid="md-runover-steps">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`md-runover-step md-runover-step--${step.status}`}
              data-step-id={step.id}
            >
              {renderStepRow(step, openStep === step.id, () =>
                setOpenStep(openStep === step.id ? null : step.id),
              )}
              {openStep === step.id && renderStepDetails(step)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function renderStepRow(
  step: RunOverStep,
  isOpen: boolean,
  onToggle: () => void,
): ReactNode {
  const hasDetails = !!(step.args || step.output);
  return (
    <button
      type="button"
      className="md-runover-step-row"
      onClick={hasDetails ? onToggle : undefined}
      aria-expanded={hasDetails ? isOpen : undefined}
      disabled={!hasDetails}
    >
      <span
        className={`md-runover-step-dot md-runover-step-dot--${step.status}`}
        aria-hidden
      />
      <span className="md-runover-step-name">{step.name}</span>
      {typeof step.durationMs === 'number' && (
        <span className="md-runover-step-duration">{formatDuration(step.durationMs)}</span>
      )}
      {hasDetails && (
        <span
          className={`md-runover-step-chevron${isOpen ? ' md-runover-step-chevron--open' : ''}`}
          aria-hidden
        >
          <svg
            viewBox="64 64 896 896"
            focusable="false"
            width="1em"
            height="1em"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M765.7 486.8L314.9 134.7A7.97 7.97 0 00302 141v77.3c0 4.9 2.3 9.6 6.1 12.6l360 281.1-360 281.1c-3.9 3-6.1 7.7-6.1 12.6V883c0 6.7 7.7 10.4 12.9 6.3l450.8-352.1a8 8 0 000-12.6z" />
          </svg>
        </span>
      )}
    </button>
  );
}

function renderStepDetails(step: RunOverStep): ReactNode {
  return (
    <div className="md-runover-step-details" data-testid="md-runover-step-details">
      {step.args && (
        <div className="md-runover-step-section">
          <div className="md-runover-step-section-title">Arguments</div>
          <pre className="md-runover-step-pre">{step.args}</pre>
        </div>
      )}
      {step.output && (
        <div className="md-runover-step-section">
          <div className="md-runover-step-section-title">Output</div>
          <pre className="md-runover-step-pre">{step.output}</pre>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${remainder}s`;
}
