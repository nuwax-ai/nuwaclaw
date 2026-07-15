/**
 * Inherit-mode environment builder.
 *
 * The whole point of nuwa-cli is to NOT do what the Electron client does
 * (redirect HOME/XDG/CLAUDE_CONFIG_DIR/NUWAXCODE_CONFIG_DIR into an isolated
 * temp dir and inject its own model credentials). Here the base is the
 * user's real process.env, untouched — so claude/codex read the exact same
 * config, skills, MCP servers, and login state they use from their own
 * terminal. We only strip a short list of variables that would otherwise
 * leak from *this* process into the spawned engine.
 */

/** Overlay values only ever come from an explicit user flag/config entry — never a default. */
export interface ModelOverlay {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** Vars that belong to nuwa-cli's own process, not the user's shell — never pass these through. */
const STRIP_VARS = [
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_ACP_PATH",
  "CODEX_ACP_BIN",
  "NUWACLI_CODEX_ACP_BIN",
  "NUWACLI_FORCE_ENGINE",
  "NUWACLI_LANPROXY_PATH",
  "NUWACLI_PASSWORD",
  "NUWACLI_SERVE_DAEMONIZED",
  "NUWACLI_SERVE_LOCK_PATH",
  "NUWAX_AGENT_PORT",
  "NUWAX_CONFIG_KEY",
  "NUWAX_FILE_SERVER_PORT",
  "NUWAX_SAVED_KEY",
  "NUWAX_SERVER_HOST",
  "NUWAX_WORKSPACE_DIR",
  "npm_config_registry",
  "npm_config_prefix",
  "npm_lifecycle_event",
  "npm_lifecycle_script",
];

function stripNoise(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIP_VARS) delete result[key];
  for (const key of Object.keys(result)) {
    if (
      key.startsWith("npm_config_") ||
      key.startsWith("npm_package_") ||
      key.startsWith("NUWACLI_SERVE_")
    ) {
      delete result[key];
    }
  }
  return result;
}

export function buildCliChildEnv(
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return { ...stripNoise(process.env), ...extra };
}

export type EngineKind = "claude" | "codex";

/**
 * Builds the environment for a spawned engine process.
 *
 * `overlay` is only applied when the user explicitly opted in (`--api-key`,
 * `--base-url`, `--model`, or the equivalent config keys) — by default this
 * function injects nothing beyond the user's own shell environment.
 */
export function buildEngineEnv(
  engine: EngineKind,
  overlay?: ModelOverlay,
): NodeJS.ProcessEnv {
  const env = buildCliChildEnv();
  if (!overlay) return env;

  if (engine === "claude") {
    if (overlay.apiKey) env.ANTHROPIC_API_KEY = overlay.apiKey;
    if (overlay.baseUrl) env.ANTHROPIC_BASE_URL = overlay.baseUrl;
    if (overlay.model) env.ANTHROPIC_MODEL = overlay.model;
  } else {
    if (overlay.apiKey) env.CODEX_API_KEY = overlay.apiKey;
    if (overlay.baseUrl) env.CODEX_BASE_URL = overlay.baseUrl;
    if (overlay.model) env.CODEX_MODEL = overlay.model;
  }
  return env;
}
