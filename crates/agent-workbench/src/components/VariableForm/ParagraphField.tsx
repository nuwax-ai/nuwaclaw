import type { VariableFieldProps } from './types';

/**
 * Multi-line text input. Used for both `Paragraph` and `AutoRecognition`
 * variable types — nuwax renders them with the same `Input.TextArea`.
 */
export function ParagraphField({
  variable,
  value,
  onChange,
  onBlur,
  hasError,
  id,
}: VariableFieldProps): JSX.Element {
  return (
    <textarea
      id={id}
      className={
        hasError ? 'variable-form-textarea variable-form-input--error' : 'variable-form-textarea'
      }
      placeholder={variable.placeholder}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      rows={4}
      data-testid={`variable-field-paragraph-${variable.name}`}
    />
  );
}
