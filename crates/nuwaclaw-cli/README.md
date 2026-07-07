# nuwaclaw

[English](README.md) | [简体中文](README.zh-CN.md)

Headless multi-engine agent CLI. `nuwaclaw` attaches to the `claude` and `codex` CLIs you've already installed and logged into — no separate login, no bundled Claude/Codex runtime, no isolated config directory. It reads the exact same `~/.claude` / `~/.codex` state your terminal already uses.

```bash
npm install -g nuwaclaw
nuwaclaw doctor
nuwaclaw chat -p "list the files in this directory"
```

## Developer Quick Start

For local package development inside `crates/nuwaclaw-cli`:

```bash
pnpm install
pnpm run build
pnpm run dev:doctor
pnpm run dev:chat -- -p "hello"
```

More local debugging scripts and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

## Why

Most agent wrappers either bundle their own copy of the model runtime (heavy, and it can't see your existing login) or ask you to configure API keys again. `nuwaclaw` does neither:

- **Inherits your environment.** `HOME`, `~/.claude`, `~/.codex`, MCP servers, skills, model preferences — all untouched. The engine sees exactly what your own `claude`/`codex` CLI would see.
- **Installs almost nothing up front.** The npm package is a few hundred KB. Engine adapters and the codex binary are fetched into `~/.nuwaclaw` only the first time you actually use them.
- **Talks ACP.** Both engines are driven over the [Agent Client Protocol](https://agentclientprotocol.com), the same protocol editors like Zed use — not a scraped CLI wrapper.

## Commands

### `nuwaclaw doctor`

Checks Node version, whether `claude`/`codex` are installed and logged in, `uv`, gui-agent MCP install state, macOS TCC risk for the current directory, Nuwax cloud login state, and counts your local session history.

Exit code only reflects checks that actually block core functionality: Node version, and having *at least one* of claude/codex usable. Everything else (`uv`, gui-agent, TCC risk, Nuwax login) is opt-in and shown as `○` rather than `✖` when unmet — `doctor` still exits `0` in that case, so it's safe to use in scripts/CI without false positives from features you haven't opted into.

### `nuwaclaw chat`

```bash
nuwaclaw chat                                  # interactive REPL, claude engine
nuwaclaw chat --engine codex -p "explain this diff"
nuwaclaw chat --resume                         # pick a past session to continue
nuwaclaw chat --resume <sessionId>              # continue a specific one
nuwaclaw chat --yolo                           # auto-approve tool calls
nuwaclaw chat --mode acceptEdits               # engine-specific session mode
nuwaclaw chat --gui-mcp                        # let the engine take screenshots / click / type
```

Flags:

| Flag | Meaning |
|---|---|
| `--engine <claude\|codex>` | Which engine to attach to (default `claude`) |
| `--cwd <dir>` | Working directory for the session |
| `-p, --print <prompt>` | Send one prompt and exit (non-interactive) |
| `--yolo` | Auto-approve every tool call the engine asks about |
| `--mode <modeId>` | Set an engine session mode (`acceptEdits`, `bypassPermissions`, `read-only`, `full-access`, ... — varies by engine) |
| `--resume [sessionId]` | Resume a session from your local `claude`/`codex` history; omit the id to pick interactively |
| `--ref-session <engine>:<sessionId>` | Point the model at a session from the *other* engine as background context (not a true resume — see below). Mutually exclusive with `--resume` |
| `--gui-mcp` / `--gui-mcp-path <dir>` | Give the engine desktop-automation tools (screenshot, click, type) via the `agent-gui-server` MCP |
| `--api-key` / `--base-url` / `--model` | Override model connection — only needed if you don't want the engine's own configured provider |

By default nuwaclaw injects **no** credentials and overrides **no** model/skill/MCP configuration — the engine runs with whatever you already have configured.

### `nuwaclaw sessions`

Lists local `claude`/`codex` session history (read directly from `~/.claude/projects` and `~/.codex/sessions`), so you can find a session id to resume.

`nuwaclaw sessions summary --engine <claude|codex> --session-id <id> [--limit N]` prints a compact, engine-agnostic JSON digest of one session's full transcript (`{engine, sessionId, cwd, title, messages, hasMore}`). It's meant to be run by an *agent's own shell tool*, not a human — see `chat --ref-session` below.

#### Cross-engine context with `chat --ref-session`

ACP's `session/load` is engine-native — a `claude-code-acp-ts` session can't be resumed by `nuwax-codex-acp` and vice versa, since each only understands its own on-disk transcript format and tool-calling conventions. There's no true cross-engine resume, and `nuwaclaw` doesn't pretend otherwise.

Instead, `chat --ref-session <engine>:<sessionId>` prepends a one-line reminder to the *first* prompt of a **new** session, pointing the model at `nuwaclaw sessions summary` so it can pull the other engine's history on demand — via its own already-available Bash tool, with no new MCP server or protocol needed:

```bash
nuwaclaw chat --engine codex --ref-session claude:c6e84245-a81c-4563-b0c8-2f0e2cf4682a \
  -p "what did we decide about the API shape in that session?"
```

This mirrors how [tutti](https://tutti.sh) bridges context between claude-code/codex/cursor/etc: a short routing hint rather than eagerly dumping the whole transcript into the prompt, so the model reads only as much as it actually needs.

`--ref-session` cannot be combined with `--resume` — the reminder only makes sense on a brand-new session's first turn, and a resumed session already has its own real history to continue, so `nuwaclaw` rejects the combination with an error rather than guessing which one you meant.

This is local-only, read-only context sharing between two engines' history on the same machine — it's unrelated to (and doesn't require) the Nuwax cloud login below. There's no unified local+cloud session list yet; `sessions`/`sessions summary` only ever see local `~/.claude`/`~/.codex` history.

### `nuwaclaw login` / `logout` / `status` / `config`

Headless login to a Nuwax account, so cloud/remote features can be enabled without any UI:

```bash
nuwaclaw login --domain https://agent.nuwax.com --saved-key <key>   # already have a key
nuwaclaw login --domain https://agent.nuwax.com -u <username>       # first time (prompts for password)
nuwaclaw status --remote     # re-validate the stored key against the server
nuwaclaw logout              # clears the session but keeps the saved key
nuwaclaw config get
nuwaclaw config set domain <host>
```

Credentials live in `~/.nuwaclaw/cli/credentials.json` (mode `0600`). Passwords are never persisted.

If you already use the Electron NuwaClaw client on the same machine, `nuwaclaw login` (with no `--saved-key`/`-u`, and no prior nuwaclaw-cli login of its own) detects its saved login(s) — read-only, from its local SQLite settings file — and offers to reuse one instead of asking you to type/paste a key by hand. This only imports the *value*: nuwaclaw-cli still registers with its own device id, so it's an independent device from the Electron client's session, not a shared one.

### `nuwaclaw serve`

Starts a local-only HTTP API (`127.0.0.1` by default) for scripting or remote/IM integration:

```bash
nuwaclaw serve --port 60016
# -> POST /computer/chat            { prompt, session_id?, cwd? } -> { session_id }
# -> GET  /computer/progress/:id    SSE stream of session updates
# -> GET  /computer/agent/status
# -> POST /computer/agent/stop      { session_id }
# -> GET  /health                   (no auth required)
```

Every route except `/health` requires an `X-Nuwax-Internal-Secret` header — the server prints a fresh random secret on startup; it's never written to disk.

`--approve` controls tool-call approval: `auto` (default) auto-approves every tool call (`yolo`), and `deny` refuses them (useful when the engine should run without side effects). Any other value is rejected rather than silently treated as `auto`. In `auto`/`yolo` mode the server prints a startup warning that **all** tool calls — including destructive writes, shell, and network — are auto-approved with no path confinement; pass `--approve deny` if that's not acceptable.

Lifecycle:

- `POST /computer/agent/stop` interrupts the session — it aborts the engine connection (SIGTERM to the engine child) and waits up to ~3s for it to exit, rather than blocking until an in-flight tool call finishes on its own.
- A session whose engine dies is evicted and emits a terminal `session_ended` event (SSE `subType` `error` or `ended`) to `/computer/progress` clients, so subscribers learn the session is gone instead of waiting forever.
- On `SIGINT`/`SIGTERM` the server stops every active session (tearing down their engine children), stops the `--tunnel` `nuwax-file-server`, then closes the HTTP listener — engine children and the file server are no longer orphaned.

`--tunnel` is **experimental**. It requires `nuwaclaw login` first and starts a local `nuwax-file-server` instance, but exposing it over an actual cloud tunnel (lanproxy) is not wired up yet — see [Known limitations](#known-limitations).

## Known limitations

- **codex on Windows/Linux ARM**: only tested on macOS arm64 so far.
- **Windows first-use install**: the `claude` engine, `--gui-mcp`, and `serve --tunnel` install their npm packages via `spawnSync("npm", …)` without `shell:true`; on Windows Node refuses to launch the `npm.cmd` shim that way, so first use of those features fails. macOS/Linux are unaffected.
- **Process-tree teardown on exit**: only the direct engine child receives `SIGTERM`; grandchildren (the `claude` binary the `claude-code-acp-ts` adapter spawns, and `agent-gui-server` under `--gui-mcp`) aren't signalled and may be orphaned. `serve` shutdown still stops its own HTTP sessions, but stray grandchildren can linger.
- **No path-confinement in `yolo`**: `--approve auto` auto-approves every tool call regardless of target path; there is no writable-root guard yet (the Electron client's strict-permission gate hasn't been ported).
- **Custom/third-party ACP engines** (pi-acp, hermes, kilo, openclaw, ...) aren't supported yet — only `claude` and `codex`.
- **`serve --tunnel`** starts the local file server but does not yet establish a cloud tunnel (lanproxy has no independent distribution channel to fetch it from yet).
- **Cloud session sync/listing**: `sessions`/`status` are local-only for now: there's no confirmed backend API yet for cross-device session history.

## How it works

- ACP connection: `@agentclientprotocol/sdk`'s `client().connectWith(...)` builder, spawning the engine over stdio NDJSON.
- `claude` engine: spawns the [`claude-code-acp-ts`](https://www.npmjs.com/package/claude-code-acp-ts) adapter (installed on first use, without its ~200MB optional platform binary — because `CLAUDE_CODE_EXECUTABLE` always points at *your* `claude`, the adapter's own bundled-binary fallback path is never reached).
- `codex` engine: downloads the `nuwax-codex-acp` binary (a Rust codex-acp fork) from GitHub Releases on first use, cached in `~/.nuwaclaw/engines/`.
- Nothing is installed into your shell's global `node_modules`, and nuwaclaw's own data lives under `~/.nuwaclaw/cli/` — it doesn't touch or conflict with the NuwaClaw Electron app's data if you also have that installed.

## Requirements

- Node.js >= 22
- `claude` and/or `codex` CLI, already installed and logged in

## Development

Local debugging commands and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

Design docs (rationale, alternatives, deferred items) live in [`docs/`](docs/) — start with [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) for the `serve` lifecycle and permission-model design.
