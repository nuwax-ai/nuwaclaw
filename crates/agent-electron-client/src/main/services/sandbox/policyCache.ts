import type { SandboxPolicy } from "@shared/types/sandbox";

const DEFAULT_POLICY: SandboxPolicy = {
  enabled: false,
  backend: "auto",
  mode: "compat",
  autoFallback: "startup-only",
  windowsMode: "workspace-write",
};

let cachedPolicy: SandboxPolicy = { ...DEFAULT_POLICY };

export function getCachedSandboxPolicy(): SandboxPolicy {
  return { ...cachedPolicy };
}

export function setCachedSandboxPolicy(policy: SandboxPolicy): void {
  cachedPolicy = { ...policy };
}
