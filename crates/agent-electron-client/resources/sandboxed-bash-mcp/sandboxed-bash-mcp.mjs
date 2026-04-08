#!/usr/bin/env node
/**
 * Sandboxed Bash MCP Server
 *
 * Replaces Claude Code's built-in Bash tool with a sandboxed version
 * that routes all commands through nuwax-sandbox-helper.exe run.
 *
 * Environment variables:
 *   NUWAX_SANDBOX_HELPER_PATH     — Path to nuwax-sandbox-helper.exe
 *   NUWAX_SANDBOX_MODE            — "read-only" | "workspace-write"
 *   NUWAX_SANDBOX_NETWORK_ENABLED — "1" | "0"
 *   NUWAX_SANDBOX_WRITABLE_ROOTS  — JSON array of writable paths
 *   NUWAX_SANDBOX_PATH            — Pre-built PATH with bundled node/git/uv
 *   NUWAX_SANDBOX_GIT_BASH_PATH   — Path to bundled bash.exe (Git for Windows)
 *
 * The built-in Bash is disabled via _meta.claudeCode.options.disallowedTools,
 * so this MCP tool becomes the only way to execute commands.
 *
 * Tool name: "Bash" (appears as mcp__sandboxed-bash__Bash to the model)
 */

import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---- Configuration from environment ----

const HELPER_PATH = process.env.NUWAX_SANDBOX_HELPER_PATH;
const SANDBOX_MODE = process.env.NUWAX_SANDBOX_MODE || "read-only";
const NETWORK_ENABLED = process.env.NUWAX_SANDBOX_NETWORK_ENABLED !== "0";
const WRITABLE_ROOTS = JSON.parse(
  process.env.NUWAX_SANDBOX_WRITABLE_ROOTS || "[]",
);
const SANDBOX_PATH = process.env.NUWAX_SANDBOX_PATH || "";
const GIT_BASH_PATH = process.env.NUWAX_SANDBOX_GIT_BASH_PATH || "";

if (!HELPER_PATH) {
  process.stderr.write(
    "[sandboxed-bash] FATAL: NUWAX_SANDBOX_HELPER_PATH not set\n",
  );
  process.exit(1);
}

// Resolve shell executable:
// 1. Git Bash (supports &&, ||, 2>/dev/null, pipes, etc.) — preferred
// 2. Fallback: PowerShell (limited bash compat but always available)
function resolveShell() {
  if (GIT_BASH_PATH) {
    return { cmd: GIT_BASH_PATH, args: ["-c"], type: "bash" };
  }
  return {
    cmd: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command"],
    type: "powershell",
  };
}

const shell = resolveShell();

// ---- Tool definition (matches built-in Bash schema) ----

const BASH_TOOL = {
  name: "Bash",
  description: `Executes a bash command in a sandboxed environment.

The command runs inside a Windows restricted token sandbox that limits
file system writes and network access according to the configured policy.

In sessions with mcp__sandboxed-bash__Bash always use it instead of the
built-in Bash tool (which is disabled).`,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description:
          "Optional timeout in milliseconds (max 120000). The sandbox helper has a 5-minute hard limit.",
      },
      description: {
        type: "string",
        description:
          "Clear, concise description of what this command does in 5-10 words, in active voice.",
      },
    },
    required: ["command"],
  },
};

// ---- Create MCP server ----

const server = new Server(
  { name: "sandboxed-bash", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ---- List tools handler ----

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [BASH_TOOL],
}));

// ---- Call tool handler ----

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "Bash") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const { command, timeout: timeoutMs } = request.params.arguments || {};

  if (!command || typeof command !== "string") {
    return {
      content: [{ type: "text", text: "Error: 'command' argument is required" }],
      isError: true,
    };
  }

  // Build sandbox policy JSON (matches Rust SandboxPolicy enum)
  const policy = {
    type: SANDBOX_MODE === "workspace-write" ? "workspace-write" : "read-only",
    network_access: NETWORK_ENABLED,
    ...(WRITABLE_ROOTS.length > 0 ? { writable_roots: WRITABLE_ROOTS } : {}),
  };

  // The sandbox helper's split_command() takes args.command[0] as the
  // executable and command[1..] as its arguments.  We wrap the user's
  // command with Git Bash (-c) for full bash syntax compatibility
  // (&&, ||, 2>/dev/null, pipes, redirects).  Falls back to PowerShell.
  const helperArgs = [
    "run",
    "--no-write-restricted",
    "--mode",
    SANDBOX_MODE,
    "--cwd",
    process.cwd(),
    "--policy-json",
    JSON.stringify(policy),
    "--",
    shell.cmd,
    ...shell.args,
    command,
  ];

  log("spawning sandbox helper", {
    mode: SANDBOX_MODE,
    cwd: process.cwd(),
    networkEnabled: NETWORK_ENABLED,
    shell: shell.type,
    commandPreview: command.slice(0, 120),
  });

  try {
    const result = await executeHelper(helperArgs, timeoutMs);

    // Format output like built-in Bash
    const parts = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(result.stderr);
    const output = parts.join("\n") || "(no output)";

    return {
      content: [{ type: "text", text: output }],
      isError: result.exit_code !== 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Sandbox execution error: ${msg}` }],
      isError: true,
    };
  }
});

// ---- Helper execution ----

/**
 * Spawn nuwax-sandbox-helper.exe and collect JSON output.
 *
 * The helper's `run` subcommand returns:
 * { exit_code: number, stdout: string, stderr: string, timed_out: boolean }
 */
function executeHelper(helperArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Build environment: inject NUWAX_SANDBOX_PATH into PATH so the
    // sandboxed process can find node, npm, git, uv, etc.
    const env = { ...process.env };
    if (SANDBOX_PATH) {
      env.PATH = SANDBOX_PATH + ";" + (env.PATH || "");
    }
    // Strip ELECTRON_RUN_AS_NODE to avoid helper inheriting it
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(HELPER_PATH, helperArgs, {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Optional Node.js-level timeout (supplement helper's built-in 5min limit)
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      const capped = Math.min(timeoutMs, 120_000);
      timer = setTimeout(() => {
        log("timeout reached, killing process", { timeoutMs: capped });
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, capped);
    }

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);

      // The helper outputs JSON to stdout on success
      try {
        const parsed = JSON.parse(stdout);
        log("helper result", {
          exit_code: parsed.exit_code,
          stdoutLen: (parsed.stdout || "").length,
          stderrLen: (parsed.stderr || "").length,
          timed_out: parsed.timed_out,
        });
        resolve({
          exit_code: parsed.exit_code ?? (code ?? 1),
          stdout: parsed.stdout || "",
          stderr: parsed.stderr || "",
          timed_out: parsed.timed_out || false,
        });
      } catch {
        // JSON parse failed — helper may have crashed or returned raw output
        log("JSON parse failed, returning raw output", {
          code,
          signal,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
        });
        resolve({
          exit_code: code ?? 1,
          stdout: stdout,
          stderr: stderr,
          timed_out: signal === "SIGKILL",
        });
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

// ---- Logging (to stderr — stdout is MCP JSON-RPC) ----

function log(message, data) {
  process.stderr.write(
    `[sandboxed-bash] ${message}${data ? " " + JSON.stringify(data) : ""}\n`,
  );
}

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
log("ready", {
  helper: HELPER_PATH,
  mode: SANDBOX_MODE,
  networkEnabled: NETWORK_ENABLED,
  writableRoots: WRITABLE_ROOTS,
  shell: shell.type,
  shellCmd: shell.cmd,
  sandboxPath: SANDBOX_PATH ? SANDBOX_PATH.split(";").length + " dirs" : "(none)",
});
