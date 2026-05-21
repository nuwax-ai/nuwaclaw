import type { VariableFieldProps } from './types';

export function NumberField({
  variable,
  value,
  onChange,
  onBlur,
  hasError,
  id,
}: VariableFieldProps): JSX.Element {
  // Allow string-typed display while editing (empty string is a valid
  // "cleared" state). We only coerce to number when the input parses cleanly.
  const display =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? String(value)
        : ''
      : typeof value === 'string'
        ? value
        : '';

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      className={
        hasError ? 'variable-form-input variable-form-input--error' : 'variable-form-input'
      }
      placeholder={variable.placeholder}
      value={display}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === '') {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        onChange(Number.isFinite(parsed) ? parsed : raw);
      }}
      onBlur={onBlur}
      data-testid={`variable-field-number-${variable.name}`}
    />
  );
}
