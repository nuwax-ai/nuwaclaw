import { useState, type ReactNode } from 'react';

/**
 * Execution plan visualization, mirrors nuwax's Plan type in MarkdownCustomProcess
 * (see nuwax `src/components/MarkdownCustomProcess/index.tsx`).
 *
 * Renders a list of tasks with status icons, similar to a todo list with
 * completion tracking.
 */
export interface PlanTask {
  /** Unique identifier for the task. */
  id: string;
  /** Task description. */
  content: string;
  /** Task status. */
  status: 'completed' | 'pending' | 'failed' | 'in_progress';
}

export interface ExecutionPlanProps {
  /** List of plan tasks. */
  tasks: PlanTask[];
  /** Plan title (optional). */
  title?: string;
}

export function ExecutionPlan({ tasks, title = '执行计划' }: ExecutionPlanProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(true);

  if (!tasks.length) return null;

  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="md-plan" data-testid="md-plan">
      <div className="md-plan-header">
        <span className="md-plan-title">{title}</span>
        <div className="md-plan-controls">
          <span className="md-plan-progress">
            {completedCount}/{tasks.length} 已完成
          </span>
          <button
            type="button"
            className="md-plan-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '收起' : '展开'}
          >
            {expanded ? (
              <svg
                viewBox="64 64 896 896"
                focusable="false"
                width="1em"
                height="1em"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M168 504.2c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 8h688c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8H168z" />
              </svg>
            ) : (
              <svg
                viewBox="64 64 896 896"
                focusable="false"
                width="1em"
                height="1em"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z" />
                <path d="M176 474h672q8 0 8 8v60q0 8-8 8H176q-8 0-8-8v-60q0-8 8-8z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="md-plan-content">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`md-plan-task md-plan-task--${task.status}`}
              data-task-id={task.id}
            >
              <span className="md-plan-task-icon" aria-hidden>
                {renderStatusIcon(task.status)}
              </span>
              <span className="md-plan-task-text">{task.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderStatusIcon(status: PlanTask['status']): ReactNode {
  switch (status) {
    case 'completed':
      // CheckSquareOutlined equivalent
      return (
        <svg
          viewBox="64 64 896 896"
          focusable="false"
          width="1em"
          height="1em"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zM439.3 715.8L195.2 471.7l50.9-50.9 193.2 193.2 351.3-351.3 50.9 50.9L439.3 715.8z" />
        </svg>
      );
    case 'in_progress':
      // HourglassOutlined equivalent (spinning)
      return (
        <svg
          viewBox="64 64 896 896"
          focusable="false"
          width="1em"
          height="1em"
          fill="currentColor"
          aria-hidden="true"
          className="md-plan-task-icon--spinning"
        >
          <path d="M888 792H200V568c0-12.8 10.4-23.2 23.2-23.2h25.5c13.7 0 24.8-11.1 24.8-24.8 0-6.8-2.7-12.9-7.2-17.4L168 404.3V232h712v172.3L781.7 502.6c-4.5 4.5-7.2 10.6-7.2 17.4 0 13.7 11.1 24.8 24.8 24.8h25.5c12.8 0 23.2 10.4 23.2 23.2v224zM880 912H144c-17.7 0-32-14.3-32-32s14.3-32 32-32h736c17.7 0 32 14.3 32 32s-14.3 32-32 32zM144 112h736c17.7 0 32 14.3 32 32s-14.3 32-32 32H144c-17.7 0-32-14.3-32-32s14.3-32 32-32z" />
        </svg>
      );
    case 'failed':
      // CloseSquareOutlined equivalent
      return (
        <svg
          viewBox="64 64 896 896"
          focusable="false"
          width="1em"
          height="1em"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zM663.7 589.3l-50.9 50.9L512 539.3 411.2 640.2l-50.9-50.9L461.1 488 360.3 387.2l50.9-50.9L512 437.1l100.8-100.8 50.9 50.9L562.9 488l100.8 101.3z" />
        </svg>
      );
    case 'pending':
    default:
      // BorderOutlined equivalent
      return (
        <svg
          viewBox="64 64 896 896"
          focusable="false"
          width="1em"
          height="1em"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656z" />
        </svg>
      );
  }
}

export default ExecutionPlan;
