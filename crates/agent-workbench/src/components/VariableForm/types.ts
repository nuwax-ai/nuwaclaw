import type {
  WorkbenchCascaderOption,
  WorkbenchVariable,
} from '../../types';

/**
 * Props for the public `<VariableForm>` component.
 *
 * The form is controlled: callers own the `values` map and apply updates
 * via `onChange`. `onSubmit` is invoked only when all `require: true`
 * variables are present.
 */
export interface VariableFormProps {
  variables: WorkbenchVariable[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSubmit?: () => void;
  /**
   * Resolver for `selectConfig.mode === 'PLUGIN'`. Called with the
   * `pluginId` declared on the variable; the host must return the
   * cascader option tree. Result is cached per-instance until the
   * variable list changes.
   */
  resolvePluginOptions?: (
    pluginId: string,
  ) => Promise<WorkbenchCascaderOption[]>;
  /** Optional UI labels. Defaults match the en-US copy used by nuwax. */
  labels?: {
    submit?: string;
    required?: string;
  };
  /** Optional class hook for host styling. */
  className?: string;
}

/**
 * Shared props for the per-type field components. Internal to the
 * VariableForm package; not exported through the workbench public API.
 */
export interface VariableFieldProps {
  variable: import('../../types').WorkbenchVariable;
  value: unknown;
  onChange: (next: unknown) => void;
  onBlur?: () => void;
  hasError?: boolean;
  id: string;
}
