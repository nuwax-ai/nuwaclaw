#!/usr/bin/env node
/**
 * Strict sandbox path smoke (no Electron): mirrors sandboxed-fs strict roots.
 * Usage: node scripts/verify-strict-sandbox-paths.mjs [sessionADir]
 */
import path from "node:path";
import { isWithinRoot } from "../resources/sandboxed-bash-mcp/sandboxed-bash-security.mjs";

const sessionA =
  process.argv[2] ||
  "C:/sandbox-regression/sessions/session-a";
const sessionB = path.join(path.dirname(sessionA), "session-b");
const workspaceRoot = path.join(path.dirname(path.dirname(sessionA)), "workspace-root");
const desktop = path.join(
  process.env.USERPROFILE || "C:/Users/soddygo",
  "Desktop/strict-fail.txt",
);

const roots = [path.resolve(sessionA)];

function allow(label, target) {
  const resolved = path.resolve(target);
  const ok = roots.some((r) => isWithinRoot(resolved, r));
  console.log(`${ok ? "ALLOW" : "BLOCK"}`, label, resolved);
  return ok;
}

let failed = 0;
if (!allow("inside-session", path.join(sessionA, "strict-ok.txt"))) failed++;
if (allow("desktop", desktop)) failed++;
if (allow("sibling-session", path.join(sessionB, "cross-fail.txt"))) failed++;
if (allow("workspace-root", path.join(workspaceRoot, "root-fail.txt"))) failed++;

if (failed > 0) {
  console.error(`\nFAIL: ${failed} case(s) did not match Strict expectations`);
  process.exit(1);
}
console.log("\nOK: strict writable-root policy matches expectations");
