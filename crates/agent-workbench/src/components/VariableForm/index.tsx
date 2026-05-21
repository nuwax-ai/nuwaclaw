import { useCallback, useMemo, useState } from 'react';
import type { WorkbenchVariable, WorkbenchVariableType } from '../../types';
import { CascaderField } from './CascaderField';
import { NumberField } from './NumberField';
import { ParagraphField } from './ParagraphField';
import { TextField } from './TextField';
import type { VariableFieldProps, VariableFormProps } from './types';

const DEFAULT_TYPE: WorkbenchVariableType = 'Text';

function isEmptyValue(
  value: unknown,
  type: WorkbenchVariableType | undefined,
): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  if (type === 'Select' || type === 'MultipleSelect') {
    return false;
  }
  return false;
}

function renderField(
  variable: WorkbenchVariable,
  fieldProps: VariableFieldProps,
  cascaderExtras: {
    resolvePluginOptions?: VariableFormProps['resolvePluginOptions'];
  },
): JSX.Element {
  const type = variable.type ?? DEFAULT_TYPE;
  switch (type) {
    case 'Paragraph':
    case 'AutoRecognition':
      return <ParagraphField {...fieldProps} />;
    case 'Number':
      return <NumberField {...fieldProps} />;
    case 'Select':
      return (
        <CascaderField
          {...fieldProps}
          multiple={false}
          resolvePluginOptions={cascaderExtras.resolvePluginOptions}
        />
      );
    case 'MultipleSelect':
      return (
        <CascaderField
          {...fieldProps}
          multiple={true}
          resolvePluginOptions={cascaderExtras.resolvePluginOptions}
        />
      );
    case 'Text':
    default:
      return <TextField {...fieldProps} />;
  }
}

/**
 * Render a controlled form derived from a `WorkbenchVariable[]` definition.
 *
 * Mirrors nuwax `NewConversationSet` semantics but lives in the workbench
 * package (no antd dependency). Callers wire the form to the chat
 * `sendMessage.variableParams` slot via `values` + `onChange`.
 */
export function VariableForm({
  variables,
  values,
  onChange,
  onSubmit,
  resolvePluginOptions,
  labels,
  className,
}: VariableFormProps): JSX.Element | null {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const requiredHint = labels?.required ?? 'Required';
  const submitLabel = labels?.submit ?? 'Start conversation';

  const errors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const v of variables) {
      if (!v.require) {
        out[v.name] = null;
        continue;
      }
      const current = values[v.name];
      if (isEmptyValue(current, v.type)) {
        out[v.name] = requiredHint;
      } else {
        out[v.name] = null;
      }
    }
    return out;
  }, [variables, values, requiredHint]);

  const hasAnyError = useMemo(
    () => Object.values(errors).some((e) => e !== null),
    [errors],
  );

  const handleFieldChange = useCallback(
    (name: string, next: unknown) => {
      onChange({ ...values, [name]: next });
    },
    [onChange, values],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Mark every required field as touched so errors surface on submit.
      const next: Record<string, boolean> = { ...touched };
      for (const v of variables) {
        if (v.require) next[v.name] = true;
      }
      setTouched(next);
      if (hasAnyError) return;
      onSubmit?.();
    },
    [hasAnyError, onSubmit, touched, variables],
  );

  if (!variables.length) {
    return null;
  }

  const rootClass = ['variable-form', className].filter(Boolean).join(' ');

  return (
    <form className={rootClass} onSubmit={handleSubmit} noValidate>
      {variables.map((variable) => {
        const id = `variable-form-field-${variable.name}`;
        const showError = touched[variable.name] && errors[variable.name];
        const fieldProps: VariableFieldProps = {
          variable,
          value: values[variable.name],
          onChange: (next) => handleFieldChange(variable.name, next),
          onBlur: () =>
            setTouched((prev) =>
              prev[variable.name]
                ? prev
                : { ...prev, [variable.name]: true },
            ),
          hasError: Boolean(showError),
          id,
        };
        return (
          <div className="variable-form-field" key={variable.name}>
            <label className="variable-form-label" htmlFor={id}>
              <span>{variable.label ?? variable.name}</span>
              {variable.require ? (
                <span className="variable-form-required" aria-label="required">
                  *
                </span>
              ) : null}
            </label>
            {renderField(variable, fieldProps, { resolvePluginOptions })}
            {showError ? (
              <div
                className="variable-form-error"
                data-testid={`variable-form-error-${variable.name}`}
              >
                {errors[variable.name]}
              </div>
            ) : null}
          </div>
        );
      })}
      {onSubmit ? (
        <div className="variable-form-actions">
          <button
            type="submit"
            className="variable-form-submit"
            disabled={hasAnyError}
            data-testid="variable-form-submit"
          >
            {submitLabel}
          </button>
        </div>
      ) : null}
    </form>
  );
}
