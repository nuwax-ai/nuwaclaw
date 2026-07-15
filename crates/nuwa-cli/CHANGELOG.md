# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-07

Initial release.

### Added

- `nuwa-cli doctor` — environment check: Node version, `claude`/`codex` install & login state, `uv`, gui-agent MCP install state, macOS TCC risk, Nuwax login state, local session counts.
- `nuwa-cli chat` — interactive REPL and `-p` one-shot mode against the `claude` or `codex` engine, inheriting the user's own environment (no isolated `HOME`, no injected credentials by default).
  - `--mode` / `--yolo` session-mode control, with a per-engine mode-name fallback list.
  - `--resume [sessionId]` to continue a session from local `claude`/`codex` history (interactive picker when no id is given).
  - `--gui-mcp` / `--gui-mcp-path` to additively inject the `agent-gui-server` desktop-automation MCP into a session.
- `nuwa-cli sessions` — lists local `claude`/`codex` session history.
  - `sessions summary --engine <claude|codex> --session-id <id> [--limit N]` — compact JSON digest of one session's full transcript, meant to be read by an agent's own shell tool rather than a human.
- `nuwa-cli chat --ref-session <engine>:<sessionId>` — points a **new** session at another engine's local history as background context. Not a true resume (ACP `session/load` is engine-native); instead it prepends a one-line reminder to the first prompt telling the model to run `sessions summary` on demand via its own Bash tool. Local-only, read-only; unrelated to the Nuwax cloud login. Mutually exclusive with `--resume` (see Fixed). Covered by `tests/resolveRefSessionReminder.test.ts` and `tests/sessionsSummary.test.ts`.
- `nuwa-cli login` / `logout` / `status` / `config` — headless Nuwax account login (`domain` + `savedKey` model), no UI required.
  - CLI credentials, savedKey, device id, tools/cache, logs, and serve lock live under `~/.nuwa-cli/` and are isolated from the NuwaClaw Electron client. `login` does not read the Electron client's SQLite DB; when no CLI savedKey exists, pass `--saved-key` or `-u`.
  - `credentials.json` now supports multiple accounts without SQLite. Each `domain + username` keeps its own savedKey, repeated username/password login for the same account reuses that savedKey to avoid creating another computer, and omitting domain/account uses the current default account.
- `nuwa-cli account list` / `account switch <account>` — list saved CLI accounts and switch the current default account. Switching re-registers with the selected account and refuses to run while `serve` is active, because serve/file-server/lanproxy/backend registration must be restarted together.
  - `status` also reports whether a local `serve` is running and on which port, via a pid/port lockfile `serve` writes on listen (the `X-Nuwax-Internal-Secret` itself is still never persisted); a stale lock whose PID is dead is auto-cleaned. Covered by `tests/serveLock.test.ts`.
- `nuwa-cli up` — one command to detect a usable local engine, log in/register with Nuwax, and start `serve --tunnel`. It supports `--saved-key`, `-u/--username` with interactive password, `NUWACLI_PASSWORD` for non-interactive username/password registration, explicit `--engine`, and automatic engine selection when omitted.
- `nuwa-cli update [version]` — upgrades the npm/pnpm-installed CLI package, with `--check`, `--dry-run`, `--package-manager npm|pnpm`, and `--registry`. It does not touch CLI credentials or service state.
- `nuwa-cli serve` — local HTTP API (`/computer/chat`, SSE `/computer/progress/:id`, `/computer/agent/status|stop|session/cancel`, `/computer/notify-resolved`, `/health`) for scripting/remote integration; `--tunnel` starts `nuwax-file-server` and a preintegrated lanproxy binary after login.

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

- The `claude` engine spawns the npm package dependency `claude-code-acp-ts` with `CLAUDE_CODE_EXECUTABLE` pointed at the user's own `claude` binary.
- The `codex` engine spawns the npm package dependency `nuwax-codex-acp`; the package pulls its platform binary through npm optional dependencies.
- `serve --tunnel` now starts the npm package dependency `nuwax-file-server` instead of installing it lazily at runtime.
- `serve --tunnel` now starts lanproxy with Electron-compatible `-s/-p/-k/--ssl` arguments, reports the serve secret as `sandboxConfigValue.apiKey`, and supports `--lanproxy-path`, `--lanproxy-host`, `--lanproxy-port`, `--lanproxy-ssl`, and `--daemon`.
- `serve` now prefers CLI-owned ports 60016/60015 but automatically advances to the next available ports when they are occupied; the final agent/file-server ports are the ones used for HTTP listen, local file-server startup, and `sandboxConfigValue` registration.
- CLI child processes strip Electron/client runtime variables (`NUWAX_*` login/port values, `NUWACLI_SERVE_*`, ACP binary overrides, npm lifecycle noise) so a terminal-launched CLI does not accidentally inherit desktop-client state.
- `NUWACLI_PASSWORD` is stripped from engine, lanproxy, file-server, and daemon child environments after being used for non-interactive login/up registration.
- `login --help`, `up --help`, and `account switch --help` document default-account reuse, multi-account JSON storage, `NUWACLI_PASSWORD`, and the service-restart requirement for account switching.
- `--version` and update/version-related output now use a build-injected package version instead of a manually duplicated constant in `src/cli.ts`.
- `nuwax-file-server` now runs with `TMPDIR`/`TMP`/`TEMP` scoped per port under `~/.nuwa-cli/tmp/file-server-<port>`, isolating its package-level PID/lock files from any Electron-client, standalone file-server, or other CLI tunnel instance using a different port.
- CLI command wiring is split into `src/cli/createProgram.ts`, grouped `register*.ts` modules, and shared option helpers, leaving `src/cli.ts` as a thin executable entry. Empty placeholder source directories were removed.
- Both engines run with the caller's real environment inherited — no `HOME`/`XDG`/`CLAUDE_CONFIG_DIR` redirection, no default credential injection.
- Cross-engine context (`--ref-session`) deliberately avoids eagerly expanding the referenced transcript into the prompt (prompt bloat, stale snapshots) in favor of an on-demand pull via the model's own shell tool — the same pattern the [tutti](https://tutti.sh) multi-agent workspace uses for cross-provider session references.
- nuwa-cli deliberately does not import Electron-client login data. Keeping CLI savedKey/device id/local state under `~/.nuwa-cli/` and preferring ports 60016/60015 keeps it separated from the Electron client's `~/.nuwaclaw/` data and 60005-60009 port range.
