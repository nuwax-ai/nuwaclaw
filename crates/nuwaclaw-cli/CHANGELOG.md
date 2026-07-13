# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-07

Initial release.

### Added

- `nuwaclaw doctor` — environment check: Node version, `claude`/`codex` install & login state, `uv`, gui-agent MCP install state, macOS TCC risk, Nuwax login state, local session counts.
- `nuwaclaw chat` — interactive REPL and `-p` one-shot mode against the `claude` or `codex` engine, inheriting the user's own environment (no isolated `HOME`, no injected credentials by default).
  - `--mode` / `--yolo` session-mode control, with a per-engine mode-name fallback list.
  - `--resume [sessionId]` to continue a session from local `claude`/`codex` history (interactive picker when no id is given).
  - `--gui-mcp` / `--gui-mcp-path` to additively inject the `agent-gui-server` desktop-automation MCP into a session.
- `nuwaclaw sessions` — lists local `claude`/`codex` session history.
  - `sessions summary --engine <claude|codex> --session-id <id> [--limit N]` — compact JSON digest of one session's full transcript, meant to be read by an agent's own shell tool rather than a human.
- `nuwaclaw chat --ref-session <engine>:<sessionId>` — points a **new** session at another engine's local history as background context. Not a true resume (ACP `session/load` is engine-native); instead it prepends a one-line reminder to the first prompt telling the model to run `sessions summary` on demand via its own Bash tool. Local-only, read-only; unrelated to the Nuwax cloud login. Mutually exclusive with `--resume` (see Fixed). Covered by `tests/resolveRefSessionReminder.test.ts` and `tests/sessionsSummary.test.ts`.
- `nuwaclaw login` / `logout` / `status` / `config` — headless Nuwax account login (`domain` + `savedKey` model), no UI required.
  - CLI credentials, savedKey, device id, tools/cache, logs, and serve lock live under `~/.nuwaclaw-cli/` and are isolated from the NuwaClaw Electron client. `login` does not read the Electron client's SQLite DB; when no CLI savedKey exists, pass `--saved-key` or `-u`.
  - `status` also reports whether a local `serve` is running and on which port, via a pid/port lockfile `serve` writes on listen (the `X-Nuwax-Internal-Secret` itself is still never persisted); a stale lock whose PID is dead is auto-cleaned. Covered by `tests/serveLock.test.ts`.
- `nuwaclaw serve` — local-only HTTP API (`/computer/chat`, SSE `/computer/progress/:id`, `/computer/agent/status|stop`, `/health`) for scripting/remote integration; experimental `--tunnel` starts a local `nuwax-file-server` after login (cloud tunnel via lanproxy not yet wired up — see README's Known limitations).

### Fixed

Pre-release review of the `serve` lifecycle and permission model. Design rationale, alternatives, and deferred items: [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md).

- `serve` shutdown now tears down the whole session tree: `SIGINT`/`SIGTERM` stops every active engine session (`SessionHub.stopAll()`) and the `--tunnel` `nuwax-file-server`, then closes the HTTP listener with `closeAllConnections()` so open SSE/keepalive sockets no longer hang shutdown. Previously only the HTTP listener was closed, orphaning engine child processes and the file server. Covered by `tests/server.test.ts`.
- `POST /computer/agent/stop` now actually interrupts: it aborts the session's engine connection (SIGTERM to the engine child) and waits up to ~3s for the runner to exit, instead of blocking until the in-flight tool call finished on its own. Covered by `tests/connection.test.ts` ("interrupts a hung prompt when the abort signal fires").
- A session whose engine dies after it became ready is now evicted from the registry and emits a terminal `session_ended` SSE event (`subType` `error`/`ended`) to `/computer/progress` clients; previously it stayed in the registry forever, `/computer/agent/status` reported it alive, and later `POST /computer/chat?session_id=…` returned `202` for a session that never ran.
- `serve --approve` is validated against `{auto, deny}`; an unrecognized value (e.g. a typo) errors out instead of silently falling through to `yolo` (full auto-approve). When `yolo` is active (the default) the server prints a startup warning that all tool calls — including destructive writes/shell/network — are auto-approved with no path confinement (confinement itself is still pending — see README's Known limitations).
- `withEngineConnection` accepts an optional `AbortSignal` (4th arg); aborting kills the engine child so a parked `op` (e.g. an in-flight `session/prompt`) stops promptly. `chat` does not use it; `serve` uses it for `/computer/agent/stop` and shutdown.
- `chat --resume` combined with `--ref-session` is now rejected up front instead of silently prepending the ref-session reminder into a resumed conversation's next turn: the reminder is only meaningful on a brand-new session's first turn, and a resumed session already has real history to continue, so mixing in a reminder about an unrelated third session would pollute it. Covered by `tests/chatRefSessionResumeConflict.test.ts`.
- `doctor`'s exit code no longer fails on unmet checks that are opt-in by design (`uv`, gui-agent, TCC risk, Nuwax login) — previously *any* unmet check set exit code `1`, so a perfectly working setup that simply hadn't opted into gui-agent or Nuwax cloud login reported failure (and broke non-interactive use, e.g. `pnpm run dev:doctor` exiting nonzero and tripping package-manager lifecycle errors). Only Node version and "at least one of claude/codex usable" now count as blocking; unmet optional checks print `○` instead of `✖` and the summary line distinguishes "blocking problem" from "core passed, some optional items unconfigured." Covered by `tests/doctor.test.ts`.
- `doctor`'s Nuwax-login fix hint now always points at manual CLI login (`--domain`/`--saved-key`) and no longer checks Electron client data.

### Design notes

- The `claude` engine spawns the npm-published `claude-code-acp-ts` adapter with `CLAUDE_CODE_EXECUTABLE` pointed at the user's own `claude` binary, installed with `--omit=optional` to skip the ~200MB platform-specific binary that adapter would otherwise pull in as a fallback.
- The `codex` engine downloads the `nuwax-codex-acp` binary from GitHub Releases on first use and caches it under `~/.nuwaclaw-cli/engines/`.
- Both engines run with the caller's real environment inherited — no `HOME`/`XDG`/`CLAUDE_CONFIG_DIR` redirection, no default credential injection.
- Cross-engine context (`--ref-session`) deliberately avoids eagerly expanding the referenced transcript into the prompt (prompt bloat, stale snapshots) in favor of an on-demand pull via the model's own shell tool — the same pattern the [tutti](https://tutti.sh) multi-agent workspace uses for cross-provider session references.
- nuwaclaw-cli deliberately does not import Electron-client login data. Keeping CLI savedKey/device id/local state under `~/.nuwaclaw-cli/` and using ports 60016/60015 keeps it separated from the Electron client's `~/.nuwaclaw/` data and 60005-60009 port range.
