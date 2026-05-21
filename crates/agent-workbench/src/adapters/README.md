# Adapters

This directory holds API adapters and ID-coercion utilities.

## Layout

- `webApiAdapter.ts` — production adapter targeting nuwax PC Web API
- `mockApiAdapter.ts` — mock adapter for offline / Storybook
- `idCoercion.ts` — string ↔ number ID boundary (see types.ts)

## Method ↔ nuwax service mapping

The `WorkbenchApiAdapter` interface (in `types.ts`) intentionally mirrors
the function signatures of `workspace/nuwax/src/services/agentConfig.ts`
to make sync diffs minimal. When porting from nuwax:

| nuwax service function | adapter method | notes |
|------------------------|---------------|-------|
| `getAgentInfo(agentId)` | `getAgentDetail(agentId)` | path + response shape unchanged |
| `getConversationList(params)` | `listConversations(params)` | |
| `createConversation(params)` | `createConversation(params)` | |
| `getConversationInfo(id)` | `getConversation(id)` | |
| `getConversationMessageList(params)` | `getConversationMessages(params)` | pagination via `index` cursor |
| `sendConversationChat(params)` | `sendMessage(params)` | streams via SSE |
| `stopConversationChat(id)` | `stopMessage(id)` | |
| `getSuggestQuestion(params)` | `getSuggestQuestions(params)` | |
| `getModelOptions(agentId)` | `getModelOptions(agentId)` | |
| `getSkillListForAt(params)` | `listSkillsForAt(params)` | |

Keep this table updated when adding new methods.
