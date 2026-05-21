/**
 * Backwards-compatible wrapper around the typed `<VariableForm>` package at
 * `../../VariableForm`.
 *
 * The new component is controlled and supports the full set of
 * `WorkbenchVariableType`s (Text / Paragraph / Number / Select /
 * MultipleSelect / AutoRecognition) — falling back to a plain text input when
 * `variable.type` is absent, which mirrors the legacy inline form's
 * behaviour for the existing mock/web payloads.
 *
 * The exported props shape matches what ChatArea already passes:
 *   { variables, labels, onSubmit(params), onCancel }
 * so this swap is transparent at the call site.
 *
 * Extracted from `NuwaxOpenApp.tsx` in Phase B's final round.
 */

import { useCallback, useState } from 'react';
import type { WorkbenchVariable } from '../../../types';
import { VariableForm as VariableFormComponent } from '../../VariableForm';
import type { Labels } from '../labels';

export function VariableForm({
  variables,
  labels,
  onSubmit,
  onCancel,
}: {
  variables: WorkbenchVariable[];
  labels: Labels;
  onSubmit: (params: Record<string, unknown>) => void;
  onCancel: () => void;
}): JSX.Element {
  // Seed values from `defaultValue` so required-field validation matches the
  // old behaviour (defaults satisfy `require: true`). Values are kept as
  // `unknown` because Select / MultipleSelect / Number now flow through this
  // map too.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const v of variables) {
      if (v.defaultValue != null) init[v.name] = v.defaultValue;
    }
    return init;
  });

  const handleSubmit = useCallback(() => {
    // Mirror the legacy contract: trim string values, drop empty entries, and
    // forward the rest verbatim. Non-string values (Number / Select payloads)
    // pass through unchanged.
    const params: Record<string, unknown> = {};
    for (const v of variables) {
      const raw = values[v.name];
      if (raw == null) continue;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed) params[v.name] = trimmed;
        continue;
      }
      if (Array.isArray(raw) && raw.length === 0) continue;
      params[v.name] = raw;
    }
    onSubmit(params);
  }, [onSubmit, values, variables]);

  return (
    <div className="open-app-variable-form">
      <div className="open-app-variable-title">{labels.variableFormTitle}</div>
      <VariableFormComponent
        variables={variables}
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        labels={{ submit: labels.variableSubmit, required: '*' }}
      />
      <div className="open-app-variable-actions">
        <button type="button" className="open-app-btn" onClick={onCancel}>
          {labels.close}
        </button>
      </div>
    </div>
  );
}
