import path from "node:path";

export const SANDBOX_SAFE_ENV_KEYS = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "windir",
  "SYSTEMDRIVE",
  "SystemDrive",
  "COMSPEC",
  "ComSpec",
  "PATHEXT",
  "PATHExt",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "LOCALAPPDATA",
  "APPDATA",
  "COMPUTERNAME",
  "USERNAME",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "LANG",
  "TZ",
];

export function isWithinRoot(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveSandboxWorkingDirectory(
  requestedCwd,
  sandboxMode,
  writableRoots,
) {
  const resolvedCwd = path.resolve(requestedCwd);
  if (sandboxMode !== "workspace-write") {
    return resolvedCwd;
  }

  const roots = writableRoots.map((root) => path.resolve(root));
  if (roots.length === 0) {
    return resolvedCwd;
  }

  if (roots.some((root) => isWithinRoot(resolvedCwd, root))) {
    return resolvedCwd;
  }

  return roots[0];
}

export function buildSandboxHelperEnv(baseEnv, sandboxPath) {
  const env = {};
  for (const key of SANDBOX_SAFE_ENV_KEYS) {
    const value = baseEnv[key];
    if (value !== undefined && value !== null) {
      env[key] = String(value);
    }
  }

  if (sandboxPath) {
    env.PATH = sandboxPath + ";" + (env.PATH || "");
  }

  // Avoid inheriting electron-specific execution mode.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
