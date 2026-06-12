/**
 * Single form field for the MCP Ask question card.
 *
 * Renders radio, checkboxes, select, text, textarea, radio-with-custom,
 * list, and file widgets, all without antd, using plain React + CSS classes.
 */
import type { ChangeEvent } from 'react';
import type { WorkbenchParsedMcpAskField } from '../../types';

const CUSTOM_OPTION_VALUE = '__custom__';

export interface McpAskFormFieldProps {
  field: WorkbenchParsedMcpAskField;
  value: unknown;
  onFieldChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

export function McpAskFormField({
  field,
  value,
  onFieldChange,
  disabled = false,
}: McpAskFormFieldProps): JSX.Element {
  const { name, property, widget, required, options, enumValues, enumLabels } = field;
  const label = property.title || name;

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFieldChange(name, e.target.value);
  };

  const handleTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onFieldChange(name, e.target.value);
  };

  const handleRadioChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFieldChange(name, e.target.value);
  };

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFieldChange(name, e.target.value);
  };

  // -- checkboxes --
  if (widget === 'checkboxes' && enumValues.length) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <div className="mcp-ask-option-group">
          {enumValues.map((val, idx) => (
            <label key={val} className="mcp-ask-checkbox">
              <input
                type="checkbox"
                value={val}
                checked={selected.includes(val)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, val]
                    : selected.filter((v) => v !== val);
                  onFieldChange(name, next);
                }}
                disabled={disabled}
              />
              <span>{enumLabels[idx] ?? val}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // -- radio-with-custom --
  if (widget === 'radio-with-custom' && enumValues.length) {
    const otherValue = options.otherValue ?? CUSTOM_OPTION_VALUE;
    const otherField = options.otherField ?? `${name}Custom`;
    const strValue = typeof value === 'string' ? value : '';
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <div className="mcp-ask-option-group">
          {enumValues.map((val, idx) => (
            <label key={val} className="mcp-ask-radio">
              <input
                type="radio"
                name={`mcp-ask-${name}`}
                value={val}
                checked={strValue === val}
                onChange={handleRadioChange}
                disabled={disabled}
              />
              <span>{enumLabels[idx] ?? val}</span>
            </label>
          ))}
          {options.allowCustom !== false && (
            <label className="mcp-ask-radio">
              <input
                type="radio"
                name={`mcp-ask-${name}`}
                value={otherValue}
                checked={strValue === otherValue}
                onChange={handleRadioChange}
                disabled={disabled}
              />
              <span>Other</span>
            </label>
          )}
        </div>
        {strValue === otherValue && (
          <input
            type="text"
            className="mcp-ask-text-input"
            data-mcp-ask-field={otherField}
            placeholder={options.placeholder ?? 'Enter custom value'}
            onChange={(e) => onFieldChange(otherField, e.target.value)}
            disabled={disabled}
          />
        )}
      </div>
    );
  }

  // -- radio --
  if (widget === 'radio' && enumValues.length) {
    const strValue = typeof value === 'string' ? value : '';
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <div className="mcp-ask-option-group">
          {enumValues.map((val, idx) => (
            <label key={val} className="mcp-ask-radio">
              <input
                type="radio"
                name={`mcp-ask-${name}`}
                value={val}
                checked={strValue === val}
                onChange={handleRadioChange}
                disabled={disabled}
              />
              <span>{enumLabels[idx] ?? val}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // -- select --
  if (widget === 'select' && enumValues.length) {
    const strValue = typeof value === 'string' ? value : '';
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <select
          className="mcp-ask-select"
          value={strValue}
          onChange={handleSelectChange}
          disabled={disabled}
        >
          <option value="">{options.placeholder ?? 'Select...'}</option>
          {enumValues.map((val, idx) => (
            <option key={val} value={val}>{enumLabels[idx] ?? val}</option>
          ))}
        </select>
      </div>
    );
  }

  // -- textarea --
  if (widget === 'textarea') {
    const strValue = typeof value === 'string' ? value : '';
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <textarea
          className="mcp-ask-textarea"
          rows={3}
          value={strValue}
          placeholder={options.placeholder ?? label}
          maxLength={property.maxLength}
          onChange={handleTextareaChange}
          disabled={disabled}
        />
        {property.maxLength && (
          <span className="mcp-ask-char-count">
            {strValue.length}/{property.maxLength}
          </span>
        )}
      </div>
    );
  }

  // -- list --
  if (widget === 'list' && enumValues.length) {
    const strValue = typeof value === 'string' ? value : '';
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <div className="mcp-ask-list">
          {enumValues.map((val, idx) => (
            <label key={val} className="mcp-ask-list-item">
              <input
                type="radio"
                name={`mcp-ask-${name}`}
                value={val}
                checked={strValue === val}
                onChange={handleRadioChange}
                disabled={disabled}
              />
              <span>{enumLabels[idx] ?? val}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // -- file --
  if (widget === 'file') {
    return (
      <div className="mcp-ask-field">
        <label className="mcp-ask-field-label">
          {label}{required && <span className="mcp-ask-required">*</span>}
        </label>
        <input
          type="file"
          className="mcp-ask-file-input"
          accept={options.accept}
          multiple={options.multiple}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            onFieldChange(name, files);
          }}
          disabled={disabled}
        />
      </div>
    );
  }

  // -- text (default) --
  const strValue = typeof value === 'string' ? value : '';
  return (
    <div className="mcp-ask-field">
      <label className="mcp-ask-field-label">
        {label}{required && <span className="mcp-ask-required">*</span>}
      </label>
      <input
        type="text"
        className="mcp-ask-text-input"
        value={strValue}
        placeholder={options.placeholder ?? label}
        maxLength={property.maxLength}
        onChange={handleTextChange}
        disabled={disabled}
      />
    </div>
  );
}
