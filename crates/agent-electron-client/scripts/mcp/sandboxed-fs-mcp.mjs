#!/usr/bin/env node
/**
 * Sandboxed File System MCP Server
 *
 * Replaces Claude Code's built-in Write and Edit tools with sandboxed versions
 * that validate all target paths against NUWAX_SANDBOX_WRITABLE_ROOTS before
 * performing file I/O.
 *
 * Environment variables:
 *   NUWAX_SANDBOX_WRITABLE_ROOTS  — JSON array of writable paths
 *   NUWAX_SANDBOX_MODE            — "strict" | "compat" (permissive skips this MCP entirely)
 *   TEMP / TMP                    — System temp directories (always allowed)
 *   APPDATA / LOCALAPPDATA        — Application data (allowed in compat mode)
 *
 * The built-in Write/Edit/NotebookEdit are disabled via
 * _meta.claudeCode.options.disallowedTools, so this MCP provides the only
 * way to write files in sandbox mode.
 *
 * Tools:
 *   - Write (mcp__sandboxed-fs__Write)
 *   - Edit  (mcp__sandboxed-fs__Edit)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { isWithinRoot } from "./sandboxed-bash-security.mjs";

// ---- Configuration from environment ----

// Resolve a path, falling back gracefully if it does not exist yet.
function resolveReal(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const SANDBOX_MODE = process.env.NUWAX_SANDBOX_MODE || "strict";

const WRITABLE_ROOTS = JSON.parse(
  process.env.NUWAX_SANDBOX_WRITABLE_ROOTS || "[]",
).map((p) => resolveReal(path.resolve(p)));

// Always include TEMP/TMP as writable (matching Rust allow.rs behavior)
const ADDITIONAL_ROOTS = [process.env.TEMP, process.env.TMP]
  .filter(Boolean)
  .map((p) => resolveReal(path.resolve(p)));

// compat mode: also allow APPDATA / LOCALAPPDATA (application data dirs)
const COMPAT_ROOTS = SANDBOX_MODE === "compat"
  ? [process.env.APPDATA, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((p) => resolveReal(path.resolve(p)))
  : [];

const ALL_WRITABLE_ROOTS = [...WRITABLE_ROOTS, ...ADDITIONAL_ROOTS, ...COMPAT_ROOTS];

// ---- Path validation ----

function validatePath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    return { allowed: false, error: "Sandbox: file_path is required" };
  }

  let resolved = path.resolve(targetPath);

  // Resolve symlinks for defense-in-depth
  try {
    resolved = realpathSync(resolved);
  } catch {
    // File doesn't exist yet — resolve the parent directory
    try {
      const parentReal = realpathSync(path.dirname(resolved));
      resolved = path.join(parentReal, path.basename(resolved));
    } catch {
      // Parent also doesn't exist — best effort with path.resolve
    }
  }

  if (ALL_WRITABLE_ROOTS.length === 0) {
    return {
      allowed: false,
      error: `Sandbox: No writable roots configured. Path rejected: ${resolved}`,
    };
  }

  for (const root of ALL_WRITABLE_ROOTS) {
    if (isWithinRoot(resolved, root)) {
      return { allowed: true, resolved };
    }
  }

  return {
    allowed: false,
    error: `Sandbox: Path outside writable roots: ${resolved}. Allowed: ${ALL_WRITABLE_ROOTS.join(", ")}`,
  };
}

// ---- Helpers ----

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

// ---- Tool definitions ----

const WRITE_TOOL = {
  name: "Write",
  description: `Writes content to a file, creating it if it does not exist.
All file paths are validated against the sandbox writable roots.
In sessions with mcp__sandboxed-fs__Write always use it instead of the
built-in Write tool (which is disabled in sandbox mode).`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description:
          "Absolute path to the file to write (must be within writable roots)",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },
};

const EDIT_TOOL = {
  name: "Edit",
  description: `Performs exact string replacements in a file.
All file paths are validated against the sandbox writable roots.
In sessions with mcp__sandboxed-fs__Edit always use it instead of the
built-in Edit tool (which is disabled in sandbox mode).`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description:
          "Absolute path to the file to edit (must be within writable roots)",
      },
      old_string: {
        type: "string",
        description: "The text to replace",
      },
      new_string: {
        type: "string",
        description: "The text to replace it with",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences of old_string (default false)",
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },
};

// ---- Create MCP server ----

const server = new Server(
  { name: "sandboxed-fs", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ---- List tools handler ----

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [WRITE_TOOL, EDIT_TOOL],
}));

// ---- Call tool handler ----

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = request.params.arguments || {};

  if (name === "Write") {
    return await handleWrite(args);
  } else if (name === "Edit") {
    return await handleEdit(args);
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ---- Write handler ----

async function handleWrite(args) {
  const { file_path, content } = args;

  if (!file_path || typeof file_path !== "string") {
    return {
      content: [{ type: "text", text: "Error: file_path is required" }],
      isError: true,
    };
  }
  if (typeof content !== "string") {
    return {
      content: [{ type: "text", text: "Error: content must be a string" }],
      isError: true,
    };
  }

  const validation = validatePath(file_path);
  if (!validation.allowed) {
    return { content: [{ type: "text", text: validation.error }], isError: true };
  }

  try {
    await ensureParentDir(validation.resolved);
    await writeFile(validation.resolved, content, "utf-8");
    log("file written", { path: validation.resolved, size: content.length });
    return {
      content: [
        { type: "text", text: `Successfully wrote to ${validation.resolved}` },
      ],
      isError: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Write error: ${msg}` }],
      isError: true,
    };
  }
}

// ---- Edit handler ----

async function handleEdit(args) {
  const { file_path, old_string, new_string, replace_all } = args;

  if (!file_path || typeof file_path !== "string") {
    return {
      content: [{ type: "text", text: "Error: file_path is required" }],
      isError: true,
    };
  }
  if (!old_string || typeof old_string !== "string") {
    return {
      content: [
        { type: "text", text: "Error: old_string must be a non-empty string" },
      ],
      isError: true,
    };
  }
  if (typeof new_string !== "string") {
    return {
      content: [
        {
          type: "text",
          text: "Error: new_string must be a string",
        },
      ],
      isError: true,
    };
  }

  const validation = validatePath(file_path);
  if (!validation.allowed) {
    return { content: [{ type: "text", text: validation.error }], isError: true };
  }

  try {
    if (!existsSync(validation.resolved)) {
      return {
        content: [
          { type: "text", text: `File not found: ${validation.resolved}` },
        ],
        isError: true,
      };
    }

    const currentContent = await readFile(validation.resolved, "utf-8");

    if (!currentContent.includes(old_string)) {
      return {
        content: [
          {
            type: "text",
            text: `old_string not found in file. The exact text was not found.`,
          },
        ],
        isError: true,
      };
    }

    let count = 0;
    let newContent;

    if (replace_all) {
      // Count occurrences
      let idx = 0;
      while ((idx = currentContent.indexOf(old_string, idx)) !== -1) {
        count++;
        idx += old_string.length;
      }
      newContent = currentContent.split(old_string).join(new_string);
    } else {
      // Check for multiple occurrences when replace_all is not set
      const firstIdx = currentContent.indexOf(old_string);
      const secondIdx = currentContent.indexOf(old_string, firstIdx + 1);
      if (secondIdx !== -1) {
        const total =
          currentContent.split(old_string).length - 1;
        return {
          content: [
            {
              type: "text",
              text: `old_string matches ${total} occurrences. Use replace_all: true to replace all, or provide a larger old_string to uniquely identify the location.`,
            },
          ],
          isError: true,
        };
      }
      count = 1;
      newContent = currentContent.replace(old_string, new_string);
    }

    await writeFile(validation.resolved, newContent, "utf-8");
    log("file edited", {
      path: validation.resolved,
      replacements: count,
      replaceAll: !!replace_all,
    });
    return {
      content: [
        {
          type: "text",
          text: `Successfully edited ${validation.resolved} (${count} replacement${count > 1 ? "s" : ""})`,
        },
      ],
      isError: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Edit error: ${msg}` }],
      isError: true,
    };
  }
}

// ---- Logging (to stderr — stdout is MCP JSON-RPC) ----

function log(message, data) {
  process.stderr.write(
    `[sandboxed-fs] ${message}${data ? " " + JSON.stringify(data) : ""}\n`,
  );
}

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
log("ready", {
  mode: SANDBOX_MODE,
  writableRoots: ALL_WRITABLE_ROOTS,
});
