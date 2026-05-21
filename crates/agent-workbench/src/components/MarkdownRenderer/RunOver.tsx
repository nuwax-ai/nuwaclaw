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
          {'▾'}
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
          {'▸'}
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
