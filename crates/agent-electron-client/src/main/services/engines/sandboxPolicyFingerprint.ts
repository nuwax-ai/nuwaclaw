import type { SandboxPolicy } from "@shared/types/sandbox";

const DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT = {
  enabled: true,
  backend: "auto",
  mode: "compat",
  autoFallback: "startup-only",
  windowsMode: "workspace-write",
} as const;

/**
 * Build a stable sandbox policy fingerprint string for warmup compatibility checks.
 * Keep this small and deterministic so different call sites can compare safely.
 */
export function buildSandboxPolicyFingerprint(
  policy: Partial<SandboxPolicy> | null | undefined,
): string {
  const normalized = {
    enabled:
      typeof policy?.enabled === "boolean"
        ? policy.enabled
        : DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT.enabled,
    backend:
      policy?.backend ?? DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT.backend,
    mode: policy?.mode ?? DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT.mode,
    autoFallback:
      policy?.autoFallback ??
      DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT.autoFallback,
    windowsMode:
      policy?.windowsMode ??
      DEFAULT_SANDBOX_POLICY_FINGERPRINT_INPUT.windowsMode,
  };
  return JSON.stringify(normalized);
}
