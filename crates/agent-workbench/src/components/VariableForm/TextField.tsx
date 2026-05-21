import type { VariableFieldProps } from './types';

export function TextField({
  variable,
  value,
  onChange,
  onBlur,
  hasError,
  id,
}: VariableFieldProps): JSX.Element {
  return (
    <input
      id={id}
      type="text"
      className={
        hasError ? 'variable-form-input variable-form-input--error' : 'variable-form-input'
      }
      placeholder={variable.placeholder}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      data-testid={`variable-field-text-${variable.name}`}
    />
  );
}
