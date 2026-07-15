# nuwa-cli

[English](README.md) | [简体中文](README.zh-CN.md)

Headless multi-engine agent CLI. `nuwa-cli` attaches to the `claude` and `codex` CLIs you've already installed and logged into — no separate login, no bundled Claude/Codex runtime, no isolated config directory. It reads the exact same `~/.claude` / `~/.codex` state your terminal already uses.

```bash
npm install -g @nuwax-ai/nuwa-cli
nuwa-cli doctor
nuwa-cli chat -p "list the files in this directory"
```

## Developer Quick Start

For local package development inside `crates/nuwa-cli`:

```bash
pnpm install
pnpm run build
pnpm run dev:cli --version
pnpm run dev:doctor
pnpm run dev:chat -p "hello"
```

More local debugging scripts and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

## Why

Most agent wrappers either bundle their own copy of the model runtime (heavy, and it can't see your existing login) or ask you to configure API keys again. `nuwa-cli` does neither:

- **Inherits your environment.** `HOME`, `~/.claude`, `~/.codex`, MCP servers, skills, model preferences — all untouched. The engine sees exactly what your own `claude`/`codex` CLI would see.
- **Uses normal package dependencies.** ACP adapters (`claude-code-acp-ts`, `nuwax-codex-acp`) and `nuwax-file-server` are installed by npm/pnpm with `nuwa-cli`; runtime code only resolves those installed package entries. `agent-gui-server` remains an optional GUI MCP add-on, and lanproxy is the only preintegrated-resource exception.
- **Talks ACP.** Both engines are driven over the [Agent Client Protocol](https://agentclientprotocol.com), the same protocol editors like Zed use — not a scraped CLI wrapper.

## Commands

### `nuwa-cli doctor`

Checks Node version, whether `claude`/`codex` are installed and logged in, `uv`, gui-agent MCP install state, macOS TCC risk for the current directory, Nuwax cloud login state, and counts your local session history.

Exit code only reflects checks that actually block core functionality: Node version, and having *at least one* of claude/codex usable. Everything else (`uv`, gui-agent, TCC risk, Nuwax login) is opt-in and shown as `○` rather than `✖` when unmet — `doctor` still exits `0` in that case, so it's safe to use in scripts/CI without false positives from features you haven't opted into.

### `nuwa-cli chat`

```bash
nuwa-cli chat                                  # interactive REPL, claude engine
nuwa-cli chat --engine codex -p "explain this diff"
nuwa-cli chat --resume                         # pick a past session to continue
nuwa-cli chat --resume <sessionId>              # continue a specific one
nuwa-cli chat --yolo                           # auto-approve tool calls
nuwa-cli chat --mode acceptEdits               # engine-specific session mode
nuwa-cli chat --gui-mcp                        # let the engine take screenshots / click / type
nuwa-cli chat --handoff claude:<sessionId> -p "keep going"
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
| `--handoff <engine>:<sessionId>` | Generate a structured handoff package from another local session and inject it into the first turn of a new ACP session. Mutually exclusive with `--resume` / `--ref-session` |
| `--gui-mcp` / `--gui-mcp-path <dir>` | Give the engine desktop-automation tools (screenshot, click, type) via the `agent-gui-server` MCP |
| `--api-key` / `--base-url` / `--model` | Override model connection — only needed if you don't want the engine's own configured provider |

By default nuwa-cli injects **no** credentials and overrides **no** model/skill/MCP configuration — the engine runs with whatever you already have configured.

### `nuwa-cli sessions`

Lists local `claude`/`codex` session history (read directly from `~/.claude/projects` and `~/.codex/sessions`), so you can find a session id to resume.

`nuwa-cli sessions summary --engine <claude|codex> --session-id <id> [--limit N]` prints a compact, engine-agnostic JSON digest of one session's full transcript (`{engine, sessionId, cwd, title, messages, hasMore}`). This is kept as a low-level compatibility command; the newer cross-agent context surface is `nuwa-cli context`.

### `nuwa-cli context`

An ACP-adjacent context reference layer. It does not replace ACP session lifecycle and does not perform cross-engine native resume; it only turns local session history into JSON a target agent can read on demand:

```bash
nuwa-cli context list --json
nuwa-cli context read --ref claude:<sessionId> --limit 40 --json
nuwa-cli context digest --ref claude:<sessionId> --json
nuwa-cli context handoff --ref claude:<sessionId> --json
```

- `read`: normalized message stream, close to `sessions summary`.
- `digest`: rule-based compact summary with recent goal, tool calls, file paths, decisions, open tasks, and risks.
- `handoff`: structured package for another agent to take over the work.

#### Cross-engine context with `chat --ref-session`

ACP's `session/load` is engine-native — a `claude-code-acp-ts` session can't be resumed by `nuwax-codex-acp` and vice versa, since each only understands its own on-disk transcript format and tool-calling conventions. There's no true cross-engine resume, and `nuwa-cli` doesn't pretend otherwise.

Instead, `chat --ref-session <engine>:<sessionId>` prepends a one-line reminder to the *first* prompt of a **new** session, pointing the model at `nuwa-cli context digest/read` so it can pull the other engine's history on demand — via its own already-available Bash tool, with no new MCP server or protocol needed:

```bash
nuwa-cli chat --engine codex --ref-session claude:c6e84245-a81c-4563-b0c8-2f0e2cf4682a \
  -p "what did we decide about the API shape in that session?"
```

This mirrors how [tutti](https://tutti.sh) bridges context between claude-code/codex/cursor/etc: a short routing hint rather than eagerly dumping the whole transcript into the prompt, so the model reads only as much as it actually needs.

`--handoff <engine>:<sessionId>` first generates a structured handoff package (goal, decisions, open tasks, files, risks, recent messages) and injects it into the first turn of a new ACP session. It is for "let another agent take over", but it is still not native resume.

`--ref-session` / `--handoff` cannot be combined with `--resume`, and they are mutually exclusive with each other — they represent native resume, read-only reference, and handoff start respectively.

This is local-only, read-only context sharing between two engines' history on the same machine — it's unrelated to (and doesn't require) the Nuwax cloud login below. There's no unified local+cloud session list yet; `sessions`/`sessions summary` only ever see local `~/.claude`/`~/.codex` history.

### `nuwa-cli login` / `logout` / `status` / `config`

Headless login to a Nuwax account, so cloud/remote features can be enabled without any UI:

```bash
nuwa-cli login --help
nuwa-cli login --domain https://agent.nuwax.com --saved-key <key>   # already have a key
nuwa-cli login --domain https://agent.nuwax.com -u <username>       # first time (prompts for password)
nuwa-cli status --remote     # re-validate the stored key against the server
nuwa-cli logout              # clears the session but keeps the saved key
nuwa-cli config get
nuwa-cli config set domain <host>
```

Credentials live in `~/.nuwa-cli/credentials.json` (mode `0600`). Passwords are never persisted. The CLI does not use SQLite; to match the Electron client's behavior, `credentials.json` keeps a lightweight JSON account map keyed by `domain + username`. Logging in again with the same domain/account reuses that savedKey so the backend renews the same computer instead of creating a new one; omitting domain/account uses the current default account.

`nuwa-cli status` also reports whether a local `serve` is running and on which port — read from a lockfile `serve` writes on listen. The `X-Nuwax-Internal-Secret` itself is still never persisted, so to actually call `/computer/chat` you must grab the secret from the serve process's startup output.

CLI login state is intentionally isolated from the NuwaClaw Electron client. `nuwa-cli login` never reads the Electron client's SQLite database and never reuses its savedKey; run it with `--saved-key` or `-u` to create CLI-owned credentials and a CLI-owned device id.

### `nuwa-cli account`

Manage multiple accounts stored in `~/.nuwa-cli/credentials.json`:

```bash
nuwa-cli account --help
nuwa-cli account list
nuwa-cli account switch --help
nuwa-cli account switch <account-key>
```

`account list` prints switchable account keys such as `testagent.xspaceagi.com_18011447397` and marks the current default with `*`. `account switch` re-registers with that account's savedKey and makes it the current default.

Account switching affects `serve`, file-server, lanproxy, and backend registration, so it is **not hot-swapped**. If `serve` is running, `account switch` refuses to proceed; press `Ctrl-C` in the running `up/serve` terminal first, then switch accounts and start services again.

### `nuwa-cli up`

One command to detect an available engine, log in/register, and start `serve --tunnel`:

```bash
nuwa-cli up --help
nuwa-cli up --domain https://agent.nuwax.com --saved-key <key>
nuwa-cli up --domain https://agent.nuwax.com -u <username>
NUWACLAW_PASSWORD='<password>' nuwa-cli up --domain https://agent.nuwax.com -u <username>
```

When `--engine` is omitted, nuwa-cli checks local `claude` / `codex` availability: it uses the only available engine, randomly selects one when multiple are available, and fails with `claude login` / `codex login` hints when neither is available. `NUWACLAW_PASSWORD` is only read for the current username/password registration, is never written to credentials, and is stripped from engine/lanproxy/file-server child environments.

After npm publish, clean machines can use the zero-install entry:

```bash
npx -y @nuwax-ai/nuwa-cli@latest up --domain https://agent.nuwax.com --saved-key <key>
```

For local debugging before npm publish, see [`docs/local-debugging.md`](docs/local-debugging.md). Full design notes live in [`docs/one-click-up.md`](docs/one-click-up.md).

Persistent run modes:

```bash
nuwa-cli up --engine claude --daemon          # detach from this terminal
nuwa-cli service install --engine claude --now # install current-user autostart and start now
nuwa-cli service status
nuwa-cli service stop
nuwa-cli service uninstall
```

`--daemon` is the lightweight "keep running after this terminal closes" mode. It still exits on reboot/logoff. `nuwa-cli service` installs an OS-managed current-user service: macOS LaunchAgent, Linux systemd user service, or Windows Scheduled Task. The service config stores only runtime flags such as engine/port/cwd/lanproxy overrides; it does **not** store passwords, savedKey/configKey, or model API keys. Login state remains in `~/.nuwa-cli/credentials.json`.

### `nuwa-cli service`

Manage background persistence and login/startup autostart:

```bash
nuwa-cli service install --help
nuwa-cli service install --engine claude --now
nuwa-cli service start
nuwa-cli service stop
nuwa-cli service status
nuwa-cli service uninstall
```

Install requires an existing CLI default account. Run `nuwa-cli login` or `nuwa-cli up` successfully once first. On macOS and Windows the service starts when the current user logs in. On Linux it uses `systemd --user`; starting before login requires enabling linger on the machine, for example `loginctl enable-linger $USER` where allowed.

### `nuwa-cli update`

Upgrade the npm/pnpm-installed CLI package:

```bash
nuwa-cli update --help
nuwa-cli update                 # upgrade to latest
nuwa-cli update 0.2.0           # upgrade to a specific version
nuwa-cli update --check         # only query the target version
nuwa-cli update --package-manager pnpm
```

`update` only upgrades the package. It does not modify `~/.nuwa-cli/credentials.json`, savedKeys, accounts, or service locks. For temporary `npx` / `pnpm dlx` runs, prefer `npx -y @nuwax-ai/nuwa-cli@latest ...` or `pnpm dlx @nuwax-ai/nuwa-cli@latest ...` directly.

### `nuwa-cli serve`

Starts a local-only HTTP API (`127.0.0.1` by default) for scripting or remote/IM integration:

```bash
nuwa-cli serve --port 60016
# -> POST /computer/chat            { prompt, session_id?, agent_work_dir?, project_id?, cwd? } -> { session_id }
# -> GET  /computer/progress/:id    SSE stream of session updates
# -> GET/POST /computer/agent/status
# -> POST /computer/agent/stop      { session_id }
# -> POST /computer/agent/session/cancel
# -> POST /computer/notify-resolved (accepted as a no-op in headless mode)
# -> GET  /health                   (no auth required)
```

`serve` prefers the CLI-owned `agentPort=60016` by default; if that port is already occupied it automatically advances to the next available port and prints the actual address. Under `--tunnel`, `nuwax-file-server` similarly prefers `fileServerPort=60015`, advances when occupied, and reports the final port in `sandboxConfigValue`.

If `--cwd` is not provided, the default workspace root is `~/.nuwa-cli/workspaces`, and Cloud/Electron-style requests create project workspaces as `~/.nuwa-cli/workspaces/<project_id>`. `agent_work_dir` / `session_id` are only compatibility fallbacks when `project_id` is missing. `user_id` is kept as request metadata but is not used in the local path. If `--cwd <dir>` is provided, that directory is treated as the project directory itself; nuwa-cli does not append `project_id` under it. `nuwax-file-server` is pointed at the same active directory/root.

For plain local `serve`, every route except `/health` and the read-only SSE `/computer/progress/:session_id` requires authentication. The preferred form is `X-Nuwax-Internal-Secret`, with `Authorization: Bearer <secret>` and `?apiKey=<secret>` accepted for clients that cannot set custom headers. In `--tunnel` mode, `/computer/*` and `/devcomputer/*` follow the Electron client's contract: the lanproxy connection is authenticated with the savedKey/configKey client key, and the forwarded local HTTP calls do not carry another per-request savedKey. The server still prints a fresh local debug secret on startup; it is never written to disk.

`--approve` controls tool-call approval: `auto` (default) auto-approves every tool call (`yolo`), and `deny` refuses them (useful when the engine should run without side effects). Any other value is rejected rather than silently treated as `auto`. In `auto`/`yolo` mode the server prints a startup warning that **all** tool calls — including destructive writes, shell, and network — are auto-approved with no path confinement; pass `--approve deny` if that's not acceptable.

Lifecycle:

- `POST /computer/agent/stop` interrupts the session — it aborts the engine connection (SIGTERM to the engine child) and waits up to ~3s for it to exit, rather than blocking until an in-flight tool call finishes on its own.
- A session whose engine dies is evicted and emits a terminal `session_ended` event (SSE `subType` `error` or `ended`) to `/computer/progress` clients, so subscribers learn the session is gone instead of waiting forever.
- On `SIGINT`/`SIGTERM` the server stops every active session (tearing down their engine children), stops the `--tunnel` `nuwax-file-server` and lanproxy child, then closes the HTTP listener — engine children and helper services are no longer orphaned.

`--tunnel` requires `nuwa-cli login` first. It re-registers the CLI with the backend, starts local `nuwax-file-server`, then starts the preintegrated lanproxy binary:

```bash
nuwa-cli config set lanproxy-path /path/to/resources/lanproxy
nuwa-cli serve --tunnel --lanproxy-host agent.nuwax.com --lanproxy-port 443
```

If the register response includes `serverHost`/`serverPort`, the explicit host/port flags can be omitted. CLI runtime logs follow the Electron client's shape: structured JSONL entries go to `~/.nuwa-cli/logs/main.YYYY-MM-DD.log`, and `latest.log` points at today's active log. `up-debug.log` is kept as a compatibility alias. `--daemon` still appends raw stdout/stderr to `serve.log` for startup-output capture.

## Known limitations

- **codex on Windows/Linux ARM**: only tested on macOS arm64 so far.
- **Windows first-use install**: `--gui-mcp` still installs `agent-gui-server` via `spawnSync("npm", …)` without `shell:true`; on Windows Node refuses to launch the `npm.cmd` shim that way, so first use of that optional feature fails. The `claude`/`codex` ACP adapters and `nuwax-file-server` are normal package dependencies instead.
- **Process-tree teardown on exit**: only the direct engine child receives `SIGTERM`; grandchildren (the `claude` binary the `claude-code-acp-ts` adapter spawns, and `agent-gui-server` under `--gui-mcp`) aren't signalled and may be orphaned. `serve` shutdown still stops its own HTTP sessions, but stray grandchildren can linger.
- **No path-confinement in `yolo`**: `--approve auto` auto-approves every tool call regardless of target path; there is no writable-root guard yet (the Electron client's strict-permission gate hasn't been ported).
- **Autostart is current-user scoped**: `service install` uses LaunchAgent / systemd user service / Scheduled Task. It is not a privileged system-wide daemon. On Linux, true boot-before-login requires systemd linger configured outside the CLI.
- **Custom/third-party ACP engines** (pi-acp, hermes, kilo, openclaw, ...) aren't supported yet — only `claude` and `codex`.
- **lanproxy distribution**: lanproxy is still the only preintegrated client resource; point `--lanproxy-path` (or `NUWACLAW_LANPROXY_PATH`) at an existing binary or `resources/lanproxy` directory.
- **Cloud session sync/listing**: `sessions`/`status` are local-only for now: there's no confirmed backend API yet for cross-device session history.

## How it works

- ACP connection: `@agentclientprotocol/sdk`'s `client().connectWith(...)` builder, spawning the engine over stdio NDJSON.
- `claude` engine: spawns the package dependency [`claude-code-acp-ts`](https://www.npmjs.com/package/claude-code-acp-ts) with `CLAUDE_CODE_EXECUTABLE` pointed at *your* `claude` binary.
- `codex` engine: spawns the package dependency [`nuwax-codex-acp`](https://www.npmjs.com/package/nuwax-codex-acp); that package pulls the matching platform binary through npm optional dependencies.
- `serve --tunnel`: starts the package dependency [`nuwax-file-server`](https://www.npmjs.com/package/nuwax-file-server), then launches the preintegrated `nuwax-lanproxy` binary with the registered savedKey. file-server PID/lock temp files are scoped per port under `~/.nuwa-cli/tmp/file-server-<port>`, so CLI shutdown does not target the Electron client's instance or another CLI tunnel instance.
- `service install`: writes a current-user OS service that runs `nuwa-cli up` on login/startup. It reuses CLI-owned credentials at runtime instead of embedding secrets into the OS service definition.
- Nothing is installed into your shell's global `node_modules`, and nuwa-cli stores its own credentials, device id, cache, logs, and serve lock under `~/.nuwa-cli/`. If you also run the NuwaClaw Electron app, the two coexist on the same machine without sharing savedKey or local state; `serve` prefers CLI-only ports 60016/60015 and automatically moves forward on conflicts, separate from Electron's 60005–60009 range.

## Requirements

- Node.js >= 22
- `claude` and/or `codex` CLI, already installed and logged in

## Development

Local debugging commands and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

Design docs (rationale, alternatives, deferred items) live in [`docs/`](docs/) — start with [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) for the `serve` lifecycle and permission-model design.
