/**
 * Schema parser for MCP Ask (nuwax_ask_question) form interactions.
 *
 * Port of nuwax feat-2026.6.18 AgentIntervention parseMcpAskSchema.ts,
 * adapted for the workbench's plain-CSS / no-antd environment.
 *
 * Converts a WorkbenchInteractionUiSchema into a list of renderable field
 * definitions (ParsedMcpAskField[]) that McpAskFormField can consume.
 */
import type {
  WorkbenchInteractionUiOptions,
  WorkbenchInteractionUiSchema,
  WorkbenchInteractionUiStep,
  WorkbenchJsonSchemaProperty,
  WorkbenchMcpAskFieldWidget,
  WorkbenchMcpAskToolInput,
  WorkbenchParsedMcpAskField,
} from '../../types';
import {
  INTERACTION_UI_SCHEMA_VERSION,
  INTERACTION_UI_SCHEMA_VERSION_ALIASES,
  MCP_ASK_SCHEMA_VERSION,
  MCP_ASK_SCHEMA_VERSION_ALIASES,
} from '../../types';

// ---------------------------------------------------------------------------
// Input parsing: validate raw tool-call input
// ---------------------------------------------------------------------------

const acceptedAskSchemaVersions = new Set([
  MCP_ASK_SCHEMA_VERSION,
  ...MCP_ASK_SCHEMA_VERSION_ALIASES,
]);

const acceptedUiSchemaVersions = new Set([
  INTERACTION_UI_SCHEMA_VERSION,
  ...INTERACTION_UI_SCHEMA_VERSION_ALIASES,
]);

export function parseMcpAskToolInput(raw: unknown): WorkbenchMcpAskToolInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.schemaVersion !== 'string' ||
    !acceptedAskSchemaVersions.has(record.schemaVersion)
  ) {
    return null;
  }
  if ((record.toolName ?? 'nuwax_ask_question') !== 'nuwax_ask_question') return null;
  if (typeof record.requestId !== 'string' || !record.ui) return null;
  const ui = record.ui as Record<string, unknown>;
  if (typeof ui.version !== 'string' || !acceptedUiSchemaVersions.has(ui.version)) {
    return null;
  }
  return { ...record, toolName: 'nuwax_ask_question' } as unknown as WorkbenchMcpAskToolInput;
}

// ---------------------------------------------------------------------------
// Schema field extraction
// ---------------------------------------------------------------------------

const SCHEMA_META_KEYS = new Set([
  'type', 'title', 'description', 'required',
  'properties', 'schema', 'uiSchema', 'steps',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isJsonSchemaProperty(value: unknown): value is WorkbenchJsonSchemaProperty {
  const record = asRecord(value);
  if (!record) return false;
  return (
    typeof record.type === 'string' ||
    Array.isArray(record.type) ||
    typeof record.title === 'string' ||
    typeof record.description === 'string' ||
    Array.isArray(record.enum) ||
    !!record.items
  );
}

function normalizeProperties(value: unknown): Record<string, WorkbenchJsonSchemaProperty> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, property]) =>
        !SCHEMA_META_KEYS.has(key) && isJsonSchemaProperty(property),
    ),
  ) as Record<string, WorkbenchJsonSchemaProperty>;
}

function findSchemaCandidates(ui: WorkbenchInteractionUiSchema): Record<string, unknown>[] {
  const schema = asRecord(ui.schema);
  if (!schema) return [];
  return [
    schema,
    asRecord(schema.schema),
    asRecord(schema.properties),
    asRecord(asRecord(schema.properties)?.schema),
  ].filter(Boolean) as Record<string, unknown>[];
}

function getEffectiveUiSchema(
  ui: WorkbenchInteractionUiSchema,
): Record<string, unknown> | undefined {
  if (ui.uiSchema) return ui.uiSchema;
  for (const candidate of findSchemaCandidates(ui)) {
    const nestedUiSchema =
      asRecord(candidate.uiSchema) ??
      asRecord(asRecord(candidate.properties)?.uiSchema);
    if (nestedUiSchema) return nestedUiSchema;
  }
  return undefined;
}

export function getUiOptions(
  uiSchema: Record<string, unknown> | undefined,
  fieldName?: string,
): WorkbenchInteractionUiOptions {
  const root = asRecord(uiSchema?.['ui:options']) ?? {};
  if (!fieldName) return root as WorkbenchInteractionUiOptions;
  const fieldUi = asRecord(uiSchema?.[fieldName]);
  const fieldOpts = asRecord(fieldUi?.['ui:options']) ?? {};
  return { ...root, ...fieldOpts } as WorkbenchInteractionUiOptions;
}

function getRootSchema(ui: WorkbenchInteractionUiSchema): {
  properties: Record<string, WorkbenchJsonSchemaProperty>;
  required: string[];
} {
  for (const candidate of findSchemaCandidates(ui)) {
    const nestedProperties = normalizeProperties(candidate.properties);
    const properties = Object.keys(nestedProperties).length
      ? nestedProperties
      : normalizeProperties(candidate);
    const directRequired = asStringArray(candidate.required);
    const required = directRequired.length
      ? directRequired
      : asStringArray(asRecord(candidate.properties)?.required);
    if (Object.keys(properties).length) {
      return { properties, required };
    }
  }
  return { properties: {}, required: [] };
}

function resolveEnumLabels(
  enumValues: string[],
  property: WorkbenchJsonSchemaProperty,
  options: WorkbenchInteractionUiOptions,
): string[] {
  if (options.enumNames?.length === enumValues.length) return options.enumNames;
  const propertyEnumNames = (property as WorkbenchJsonSchemaProperty & {
    enumNames?: string[];
  }).enumNames;
  if (propertyEnumNames?.length === enumValues.length) return propertyEnumNames;
  return enumValues;
}

const VALID_WIDGETS: WorkbenchMcpAskFieldWidget[] = [
  'radio', 'checkboxes', 'select', 'text', 'textarea',
  'radio-with-custom', 'list', 'file',
];

export function resolveFieldWidget(
  name: string,
  prop: WorkbenchJsonSchemaProperty,
  uiSchema?: Record<string, unknown>,
): WorkbenchMcpAskFieldWidget {
  const fieldUi = asRecord(uiSchema?.[name]);
  const widget = fieldUi?.['ui:widget'];
  if (typeof widget === 'string' && (VALID_WIDGETS as string[]).includes(widget)) {
    return widget as WorkbenchMcpAskFieldWidget;
  }
  const options = getUiOptions(uiSchema, name);
  const propType = Array.isArray(prop.type)
    ? prop.type.find((t) => t !== 'null') || 'string'
    : prop.type;

  if (propType === 'array' && prop.items?.enum?.length) return 'checkboxes';
  if (prop.enum?.length) {
    return options.allowCustom || options.otherField ? 'radio-with-custom' : 'radio';
  }
  if (propType === 'string') {
    return fieldUi?.['ui:widget'] === 'textarea' ? 'textarea' : 'text';
  }
  return 'text';
}

export function parseInteractionFields(
  ui: WorkbenchInteractionUiSchema,
  fieldNames?: string[],
): WorkbenchParsedMcpAskField[] {
  const { properties, required } = getRootSchema(ui);
  const uiSchema = getEffectiveUiSchema(ui);
  const names = fieldNames ?? Object.keys(properties);
  return names
    .filter((name) => properties[name])
    .map((name) => {
      const property = properties[name];
      const options = getUiOptions(uiSchema, name);
      const widget = resolveFieldWidget(name, property, uiSchema);
      const enumValues =
        property.enum ??
        (property.items?.enum && widget === 'checkboxes' ? property.items.enum : []) ??
        [];
      return {
        name,
        property,
        widget,
        required: required.includes(name),
        options,
        enumValues,
        enumLabels: resolveEnumLabels(enumValues, property, options),
      };
    });
}

export function isWizardPresentation(ui: WorkbenchInteractionUiSchema): boolean {
  return ui.presentation === 'wizard' || (Array.isArray(ui.steps) && ui.steps.length > 1);
}

export function getInteractionSteps(ui: WorkbenchInteractionUiSchema): WorkbenchInteractionUiStep[] {
  if (ui.steps?.length) return ui.steps;
  const { properties } = getRootSchema(ui);
  const allFields = Object.keys(properties);
  if (!allFields.length) return [];
  return [
    { id: 'default', title: ui.title, description: ui.description, fields: allFields },
  ];
}

export function isSkipAllowed(ui: WorkbenchInteractionUiSchema): boolean {
  const rootOpts = getUiOptions(ui.uiSchema);
  return rootOpts.allowSkip === true;
}

export function getSkipLabel(ui: WorkbenchInteractionUiSchema): string | undefined {
  const rootOpts = getUiOptions(ui.uiSchema);
  return ui.skipLabel || rootOpts.skipLabel;
}
