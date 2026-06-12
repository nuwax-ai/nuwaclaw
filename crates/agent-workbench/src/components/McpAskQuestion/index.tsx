/**
 * McpAskQuestionCard - schema-driven form card for MCP Ask interactions.
 *
 * Port of nuwax feat-2026.6.18 AgentIntervention McpAskQuestionCard,
 * adapted for the workbench's plain-CSS / no-antd environment.
 *
 * Supports wizard (multi-step), inline, and modal presentations.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  WorkbenchMcpAskInteraction,
  WorkbenchMcpAskRespondPayload,
} from '../../types';
import { McpAskFormField } from './McpAskFormField';
import {
  getInteractionSteps,
  getSkipLabel,
  isSkipAllowed,
  isWizardPresentation,
  parseInteractionFields,
} from './parseMcpAskSchema';

export interface McpAskQuestionCardProps {
  interaction: WorkbenchMcpAskInteraction;
  onRespond?: (payload: WorkbenchMcpAskRespondPayload) => void;
  /** Localized labels. */
  labels?: McpAskQuestionLabels;
}

export interface McpAskQuestionLabels {
  eyebrow?: string;
  submit?: string;
  cancel?: string;
  skip?: string;
  prevStep?: string;
  nextStep?: string;
  stepOf?: string;
  submitted?: string;
  cancelled?: string;
  skipped?: string;
}

const DEFAULT_LABELS: Required<McpAskQuestionLabels> = {
  eyebrow: 'Agent question',
  submit: 'Submit',
  cancel: 'Cancel',
  skip: 'Skip',
  prevStep: 'Previous',
  nextStep: 'Next',
  stepOf: 'Step {0} of {1}',
  submitted: 'Submitted',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

export function McpAskQuestionCard({
  interaction,
  onRespond,
  labels: labelsProp,
}: McpAskQuestionCardProps): JSX.Element {
  const labels = { ...DEFAULT_LABELS, ...(labelsProp ?? {}) };
  const { input, toolCallId } = interaction;
  const ui = input.ui;

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [currentStep, setCurrentStep] = useState(0);

  const isSubmitting = interaction.responseStatus === 'submitting';
  const isSubmitted = interaction.responseStatus === 'submitted';
  const isCancelled = interaction.responseStatus === 'cancelled';
  const isSkipped = interaction.responseStatus === 'skipped';
  const disabled = isSubmitting || isSubmitted || isCancelled || isSkipped || !onRespond;

  const steps = useMemo(() => getInteractionSteps(ui), [ui]);
  const isWizard = isWizardPresentation(ui);
  const allowSkip = isSkipAllowed(ui);
  const skipLabel = getSkipLabel(ui) ?? labels.skip;

  const activeStep = steps[currentStep];
  const visibleFields = useMemo(() => {
    if (isWizard && steps.length > 1 && activeStep) {
      return parseInteractionFields(ui, activeStep.fields);
    }
    return parseInteractionFields(ui);
  }, [ui, isWizard, steps.length, activeStep]);

  const isLastStep = currentStep >= steps.length - 1;
  const title = input.title || ui.title;
  const description = input.description || ui.description;

  useEffect(() => {
    setCurrentStep(0);
  }, [input.requestId]);

  useEffect(() => {
    const initial = ui.initialValue ?? interaction.formData;
    if (initial) setFormData((prev) => ({ ...initial, ...prev }));
  }, [ui.initialValue, interaction.formData, input.requestId]);

  const buildPayload = useCallback(
    (
      action: WorkbenchMcpAskRespondPayload['action'],
      data?: Record<string, unknown>,
    ): WorkbenchMcpAskRespondPayload => ({
      interventionId: input.requestId,
      toolCallId,
      revision: input.revision,
      source: 'mcp_ask',
      protocol: 'mcp',
      action,
      formData: data,
    }),
    [input.requestId, input.revision, toolCallId],
  );

  const handleFieldChange = useCallback((name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    onRespond?.(buildPayload('submit', formData));
  }, [onRespond, buildPayload, formData]);

  const handleCancel = useCallback(() => {
    onRespond?.(buildPayload('cancel'));
  }, [onRespond, buildPayload]);

  const handleSkip = useCallback(() => {
    onRespond?.(buildPayload('skip'));
  }, [onRespond, buildPayload]);

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  const handlePrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const renderStatusTag = (): JSX.Element | null => {
    if (isSubmitted)
      return <span className="mcp-ask-tag mcp-ask-tag--success">{labels.submitted}</span>;
    if (isSkipped)
      return <span className="mcp-ask-tag">{labels.skipped}</span>;
    if (isCancelled)
      return <span className="mcp-ask-tag">{labels.cancelled}</span>;
    return null;
  };

  return (
    <div className="mcp-ask-card" role="region" aria-label={title}>
      <header className="mcp-ask-header">
        <div className="mcp-ask-header-main">
          <span className="mcp-ask-eyebrow">{labels.eyebrow}</span>
          <span className="mcp-ask-title">{title}</span>
          {description ? <span className="mcp-ask-desc">{description}</span> : null}
        </div>
        {renderStatusTag()}
      </header>

      {isWizard && steps.length > 1 && (
        <div className="mcp-ask-steps">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={
                'mcp-ask-step' + (idx === currentStep ? ' mcp-ask-step--active' : '')
              }
            >
              {step.title}
            </div>
          ))}
        </div>
      )}

      <div className="mcp-ask-form">
        {visibleFields.map((field) => (
          <McpAskFormField
            key={field.name}
            field={field}
            value={formData[field.name]}
            onFieldChange={handleFieldChange}
            disabled={disabled}
          />
        ))}
      </div>

      {!isSubmitted && !isCancelled && !isSkipped && (
        <footer className="mcp-ask-footer">
          {isWizard && steps.length > 1 ? (
            <span className="mcp-ask-step-meta">
              {labels.stepOf
                .replace('{0}', String(currentStep + 1))
                .replace('{1}', String(steps.length))}
            </span>
          ) : (
            <span />
          )}
          <div className="mcp-ask-footer-actions">
            {isWizard && currentStep > 0 && (
              <button
                type="button"
                className="open-app-btn"
                disabled={disabled}
                onClick={handlePrev}
              >
                {labels.prevStep}
              </button>
            )}
            {isWizard && !isLastStep ? (
              <button
                type="button"
                className="open-app-btn primary"
                disabled={disabled}
                onClick={handleNext}
              >
                {labels.nextStep}
              </button>
            ) : (
              <button
                type="button"
                className="open-app-btn primary"
                disabled={disabled}
                onClick={handleSubmit}
              >
                {ui.submitLabel ?? labels.submit}
              </button>
            )}
            {allowSkip && (
              <button
                type="button"
                className="open-app-btn"
                disabled={disabled}
                onClick={handleSkip}
              >
                {skipLabel}
              </button>
            )}
            <button
              type="button"
              className="open-app-btn"
              disabled={disabled}
              onClick={handleCancel}
            >
              {ui.cancelLabel ?? labels.cancel}
            </button>
          </div>
        </footer>
      )}

      {interaction.responseStatus === 'failed' && interaction.errorMessage && (
        <div className="mcp-ask-error">{interaction.errorMessage}</div>
      )}
    </div>
  );
}
