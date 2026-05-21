# Nuwax Sync Log

This package mirrors nuwax `/app` (PC Web). Track sync state here.

## Current baseline
- Source repo: `/Users/louis/workspace/nuwax`
- Last synced commit: `55b457be`
- Last sync date: 2026-05-21

## Mirrored paths

| nuwax path | workbench path |
|------------|----------------|
| `src/pages/OpenApp/BaseTemplate/` | `src/components/OpenApp/BaseTemplate/` |
| `src/pages/OpenApp/AppDetails/` | `src/components/OpenApp/AppDetails/` |
| `src/pages/OpenApp/HistoryConversation/` | `src/components/OpenApp/HistoryConversation/` |
| `src/components/ChatInputHome/` | `src/components/ChatInputHome/` |
| `src/components/MarkdownRenderer/` | `src/components/MarkdownRenderer/` |
| `src/services/agentConfig.ts` | `src/adapters/webApiAdapter.ts` (函数签名应保持等价) |

## Sync workflow
1. Update `NUWAX_PATH` in `scripts/diff-from-nuwax.sh` if needed
2. Run `bash scripts/diff-from-nuwax.sh > /tmp/nuwax-diff.txt`
3. Review diff, port relevant changes
4. Update baseline commit and date in this file
5. Run typecheck + tests

## Known intentional divergences
- workbench uses plain CSS (`styles.css`), not Less/Tailwind
- workbench has its own Umi compat layer in `src/compat/umi.ts`
- workbench API adapter returns string IDs (see idCoercion.ts boundary)
- workbench does not depend on antd / ahooks at runtime
