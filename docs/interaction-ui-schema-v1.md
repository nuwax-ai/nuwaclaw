# Interaction UI Schema v1

| 项 | 内容 |
|---|---|
| 状态 | **v1 草案** |
| 版本 | v1(2026-05-13) |
| Schema version | `nuwaclaw.interaction.v1` |
| 使用方 | Nuwax Web、Nuwax Mobile |
| 引用方 | [`acp-permission-approval-cross-end-v1.md`](./acp-permission-approval-cross-end-v1.md)、[`mcp-ask-question-acp-toolcall-v1.md`](./mcp-ask-question-acp-toolcall-v1.md) |

---

## 1. 定位

`InteractionUISchema` 是 Nuwax Web/Mobile 渲染会话交互组件的内部数据驱动 UI schema。它不是 ACP 官方 schema,也不是 MCP 协议 schema。

使用场景:

- ACP permission approval:Web/Mobile 把官方 `RequestPermissionRequest` 适配成 `InteractionUISchema`。
- MCP ask/question:MCP ask 工具把 `InteractionUISchema` 放在 `ToolCall.rawInput.ui` 中。

边界:

- nuwaclaw/rcoder Host 不生成、不转换、不解释该 schema。
- Web/Mobile 是唯一渲染责任方。
- 未知 `version` 必须 fallback,不要提交猜测数据。
- schema 不得携带 secret、token、完整 env 或未经脱敏的敏感文件内容。

---

## 2. TypeScript 定义

```ts
interface InteractionUISchema {
  version: "nuwaclaw.interaction.v1";
  presentation: "modal" | "inline" | "wizard" | "table";
  title: string;
  description?: string;
  schema: JsonSchemaObject;
  uiSchema?: UISchema;
  table?: InteractiveTableSchema;
  initialValue?: Record<string, unknown>;
  steps?: Array<{ id: string; title: string; description?: string; fields: string[] }>;
  submitLabel?: string;
  cancelLabel?: string;
  fallback?: {
    text: string;
    webUrl?: string;
    mobileUrl?: string;
  };
}

interface InteractiveTableSchema {
  rowKey?: string;
  selection?: "none" | "single" | "multiple";
  columns: Array<{
    key: string;
    title: string;
    type: "string" | "number" | "boolean" | "enum" | "date" | "json";
    editable?: boolean;
    required?: boolean;
    width?: number;
    enumOptions?: Array<{ value: string; label: string }>;
  }>;
  rows?: Array<Record<string, unknown>>;
  maxRows?: number;
  allowAddRow?: boolean;
  allowDeleteRow?: boolean;
}

interface UISchema {
  allowSkip?: boolean;
  [fieldName: string]:
    | {
        "ui:widget"?: string;
        "ui:visibleWhen"?: unknown;
        [key: string]: unknown;
      }
    | boolean
    | undefined;
}
```

---

## 3. 字段语义

| 字段 | 语义 |
|---|---|
| `version` | 固定为 `nuwaclaw.interaction.v1` |
| `presentation` | 渲染形态:inline/modal/wizard/table |
| `title` | 卡片、弹窗或表单标题 |
| `description` | 补充说明,可折叠展示 |
| `schema` | 表单数据的 JSON Schema,也用于提交前校验 |
| `uiSchema` | 渲染 widget、条件显示、跳过能力等 UI hint |
| `table` | `presentation="table"` 时的表格列、行、编辑能力 |
| `initialValue` | 表单或表格初始值 |
| `steps` | `presentation="wizard"` 时的分步配置 |
| `submitLabel` / `cancelLabel` | 按钮文案覆盖 |
| `fallback` | 未知版本、端能力不足或复杂 schema 时的兜底展示 |

---

## 4. 渲染规则

- `presentation="inline"`:会话内卡片。
- `presentation="modal"`:端上可弹窗时弹窗,否则降级 inline。
- `presentation="wizard"`:按 `steps` 分步。
- `presentation="table"`:按 `table.columns` / `table.rows` 渲染交互式表格。
- 未知 `ui.version`:显示 fallback,不要提交猜测数据。
- `schema` 校验失败时,前端阻止提交并显示字段级错误。
- `fallback.webUrl` / `fallback.mobileUrl` 可用于端能力不足时跳转到完整 Web 表单。

---

## 5. Mobile 能力分级

| 等级 | 能力 |
|---|---|
| M0 | fallback message + webUrl,未知 schema 安全忽略 |
| M1 | approval options、单选、短文本 |
| M2 | 单选、多选、短文本、基础 wizard |
| M3 | 基础 table 查看与选择 |
| M4 | table 编辑、新增、删除 |

当前方案只承诺 Mobile M2。复杂 schema 或表格编辑默认 fallback 到 Web。

---

## 6. 提交数据

提交数据统一放在业务响应的 `formData`:

```ts
type InteractionFormData = Record<string, unknown>;
```

约束:

- `formData` 必须通过 `InteractionUISchema.schema` 校验。
- `presentation="table"` 时,表格选择、编辑、新增、删除后的结果也归入 `formData`。
- Approval 场景中,`formData.decision` 必须映射回 ACP `PermissionOption.optionId`。
- MCP ask 场景中,`formData` 原样作为 MCP tool result 的业务结果。

---

## 7. 安全与兼容

- schema 中不得包含 secret、token、完整 env 或未脱敏敏感内容。
- Web/Mobile 展示 `rawInput`、`content`、`locations` 时负责脱敏和折叠。
- 新字段必须向后兼容;旧端看到未知字段应忽略。
- 破坏性变更必须升级 `version`,不能在 `nuwaclaw.interaction.v1` 内静默改变语义。
