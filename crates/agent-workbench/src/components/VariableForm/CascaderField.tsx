import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  WorkbenchCascaderOption,
  WorkbenchVariable,
} from '../../types';
import type { VariableFieldProps } from './types';

type CascaderValue = Array<string | number>;

interface CascaderFieldProps extends VariableFieldProps {
  multiple: boolean;
  resolvePluginOptions?: (
    pluginId: string,
  ) => Promise<WorkbenchCascaderOption[]>;
}

/** Result row for a cascader selection: full path of values. */
type SelectionPath = CascaderValue;

function readSelectedPaths(
  value: unknown,
  multiple: boolean,
): SelectionPath[] {
  if (multiple) {
    if (!Array.isArray(value)) return [];
    // value is SelectionPath[]
    return value.filter(
      (path): path is SelectionPath =>
        Array.isArray(path) &&
        path.every((v) => typeof v === 'string' || typeof v === 'number'),
    );
  }
  if (!Array.isArray(value)) return [];
  if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return [value as SelectionPath];
  }
  return [];
}

function pathEq(a: SelectionPath, b: SelectionPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function labelForPath(
  options: WorkbenchCascaderOption[],
  path: SelectionPath,
): string {
  const labels: string[] = [];
  let current = options;
  for (const value of path) {
    const match = current.find((opt) => opt.value === value);
    if (!match) {
      labels.push(String(value));
      break;
    }
    labels.push(match.label);
    current = match.children ?? [];
  }
  return labels.join(' / ');
}

/**
 * Light cascader: renders a column-based dropdown. Hover/click on a row
 * with children opens the next column. Leaf rows commit the path.
 *
 * Does NOT support search or virtual scroll — keep options under ~50 per
 * column. For PLUGIN mode, options are resolved lazily and the component
 * shows a loading row until the promise settles.
 */
export function CascaderField(props: CascaderFieldProps): JSX.Element {
  const {
    variable,
    value,
    onChange,
    onBlur,
    hasError,
    id,
    multiple,
    resolvePluginOptions,
  } = props;

  const [open, setOpen] = useState(false);
  const [columnPath, setColumnPath] = useState<SelectionPath>([]);
  const [pluginOptions, setPluginOptions] = useState<
    WorkbenchCascaderOption[] | null
  >(null);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const selectConfig = variable.selectConfig;
  const mode = selectConfig?.mode ?? 'MANUAL';

  const options: WorkbenchCascaderOption[] = useMemo(() => {
    if (mode === 'PLUGIN') {
      return pluginOptions ?? [];
    }
    return selectConfig?.options ?? [];
  }, [mode, pluginOptions, selectConfig?.options]);

  useEffect(() => {
    if (mode !== 'PLUGIN') return;
    if (pluginOptions !== null) return;
    if (!selectConfig?.pluginId) return;
    if (!resolvePluginOptions) return;

    let cancelled = false;
    resolvePluginOptions(selectConfig.pluginId)
      .then((opts) => {
        if (cancelled) return;
        setPluginOptions(opts);
        setPluginError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPluginError(err instanceof Error ? err.message : String(err));
        setPluginOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, pluginOptions, selectConfig?.pluginId, resolvePluginOptions]);

  // Reset cached plugin options when the variable name or pluginId changes.
  // (Tracked via `pluginCacheKey` to avoid forgetting on incidental rerenders.)
  const pluginCacheKey = `${variable.name}:${selectConfig?.pluginId ?? ''}`;
  const lastKey = useRef(pluginCacheKey);
  if (lastKey.current !== pluginCacheKey) {
    lastKey.current = pluginCacheKey;
    if (pluginOptions !== null) setPluginOptions(null);
  }

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent) => {
      const node = wrapperRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onBlur]);

  const selectedPaths = readSelectedPaths(value, multiple);

  // Build the per-column option arrays based on `columnPath`.
  const columns: WorkbenchCascaderOption[][] = useMemo(() => {
    const cols: WorkbenchCascaderOption[][] = [options];
    let current = options;
    for (const v of columnPath) {
      const match = current.find((opt) => opt.value === v);
      if (!match?.children?.length) break;
      cols.push(match.children);
      current = match.children;
    }
    return cols;
  }, [options, columnPath]);

  const commitPath = (path: SelectionPath) => {
    if (multiple) {
      const exists = selectedPaths.some((p) => pathEq(p, path));
      const next = exists
        ? selectedPaths.filter((p) => !pathEq(p, path))
        : [...selectedPaths, path];
      onChange(next);
    } else {
      onChange(path);
      setOpen(false);
      onBlur?.();
    }
  };

  const handleRowClick = (
    colIndex: number,
    option: WorkbenchCascaderOption,
  ) => {
    const nextColumnPath: SelectionPath = [
      ...columnPath.slice(0, colIndex),
      option.value,
    ];
    setColumnPath(nextColumnPath);
    if (!option.children?.length) {
      commitPath(nextColumnPath);
    }
  };

  const displayLabel = (() => {
    if (selectedPaths.length === 0) {
      return variable.placeholder || labelForRequiredHint(variable);
    }
    return selectedPaths.map((p) => labelForPath(options, p)).join(', ');
  })();

  const triggerClass = [
    'variable-cascader-trigger',
    hasError ? 'variable-form-input--error' : '',
    selectedPaths.length === 0 ? 'variable-cascader-trigger--placeholder' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="variable-cascader"
      ref={wrapperRef}
      data-testid={`variable-field-cascader-${variable.name}`}
    >
      <button
        type="button"
        id={id}
        className={triggerClass}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{displayLabel}</span>
        <span aria-hidden="true" className="variable-cascader-arrow">
          ▾
        </span>
      </button>
      {open ? (
        <div className="variable-cascader-popover" role="listbox">
          {mode === 'PLUGIN' && pluginOptions === null ? (
            <div className="variable-cascader-status">Loading…</div>
          ) : null}
          {pluginError ? (
            <div className="variable-cascader-status variable-cascader-status--error">
              {pluginError}
            </div>
          ) : null}
          {columns.map((column, colIndex) => (
            <div
              key={colIndex}
              className="variable-cascader-column"
              data-testid={`variable-cascader-column-${colIndex}`}
            >
              {column.map((option) => {
                const isOpen = columnPath[colIndex] === option.value;
                const fullPath: SelectionPath = [
                  ...columnPath.slice(0, colIndex),
                  option.value,
                ];
                const isSelected = selectedPaths.some((p) => pathEq(p, fullPath));
                const className = [
                  'variable-cascader-option',
                  isOpen ? 'variable-cascader-option--active' : '',
                  isSelected ? 'variable-cascader-option--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    type="button"
                    key={String(option.value)}
                    className={className}
                    onClick={() => handleRowClick(colIndex, option)}
                  >
                    {multiple && !option.children?.length ? (
                      <input
                        type="checkbox"
                        readOnly
                        checked={isSelected}
                        tabIndex={-1}
                      />
                    ) : null}
                    <span>{option.label}</span>
                    {option.children?.length ? (
                      <span
                        aria-hidden="true"
                        className="variable-cascader-chevron"
                      >
                        ›
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {column.length === 0 ? (
                <div className="variable-cascader-status">No options</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function labelForRequiredHint(variable: WorkbenchVariable): string {
  return variable.placeholder ?? `Select ${variable.label ?? variable.name}`;
}
