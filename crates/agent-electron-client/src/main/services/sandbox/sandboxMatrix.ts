import type {
  PermissionType,
  Platform,
  SandboxMode,
  WindowsSandboxMode,
} from "@shared/types/sandbox";
import {
  DEFAULT_PERMISSION_POLICY,
  DANGEROUS_COMMANDS,
} from "./PermissionManager";

export type MatrixVerdict = "allow" | "block" | "conditional" | "unsupported";
export type MatrixLayer = "sandbox" | "permission";
export type MatrixPlatform = Platform | "all";
export type MatrixBackend =
  | "macos-seatbelt"
  | "linux-bwrap"
  | "windows-sandbox"
  | "docker"
  | "permission-manager";
export type MatrixMode = SandboxMode | "n/a";
export type MatrixWindowsMode = WindowsSandboxMode | "n/a";

export interface SandboxMatrixRule {
  layer: MatrixLayer;
  platform: MatrixPlatform;
  backend: MatrixBackend;
  mode: MatrixMode;
  windowsMode: MatrixWindowsMode;
  operationId: string;
  verdict: MatrixVerdict;
  reason: string;
  evidence: string[];
}

export interface SandboxMatrixDocument {
  schemaVersion: "1.0.0";
  operations: string[];
  permissionLists: {
    commandAllowlist: string[];
    commandDenylist: string[];
    permissionTypeAutoApprove: PermissionType[];
    permissionTypeDeny: PermissionType[];
  };
  rules: SandboxMatrixRule[];
}

export const SANDBOX_OPERATIONS = [
  "fs.write.workspace",
  "fs.write.outside_workspace",
  "fs.delete.system_path",
  "network.external",
  "network.loopback",
  "exec.startup_chain_extra",
  "command.dangerous.system",
  "fallback.backend_unavailable",
] as const;

const PERMISSION_OPERATIONS = [
  "permission.command.safe",
  "permission.command.dangerous",
  "permission.path.sensitive",
  "permission.type.deny",
] as const;

type SandboxOperation = (typeof SANDBOX_OPERATIONS)[number];

interface Combo {
  platform: MatrixPlatform;
  backend: Exclude<MatrixBackend, "permission-manager">;
  mode: MatrixMode;
  windowsMode: MatrixWindowsMode;
}

function rule(
  combo: Combo,
  operationId: string,
  verdict: MatrixVerdict,
  reason: string,
  evidence: string[],
): SandboxMatrixRule {
  return {
    layer: "sandbox",
    platform: combo.platform,
    backend: combo.backend,
    mode: combo.mode,
    windowsMode: combo.windowsMode,
    operationId,
    verdict,
    reason,
    evidence,
  };
}

function darwinRuleVerdict(
  operationId: SandboxOperation,
  mode: SandboxMode,
): Pick<SandboxMatrixRule, "verdict" | "reason"> {
  const strictLike = mode === "strict" || mode === "compat";
  switch (operationId) {
    case "fs.write.workspace":
      return {
        verdict: "allow",
        reason: "workspace path is explicitly writable",
      };
    case "fs.write.outside_workspace":
    case "fs.delete.system_path":
      if (strictLike) {
        return {
          verdict: "block",
          reason: "seatbelt non-permissive mode only allows writablePaths",
        };
      }
      return {
        verdict: "allow",
        reason: "permissive mode enables file-write* globally",
      };
    case "network.external":
    case "network.loopback":
      return {
        verdict: "conditional",
        reason: "depends on networkEnabled -> (allow network*)",
      };
    case "exec.startup_chain_extra":
      if (mode === "strict") {
        return {
          verdict: "block",
          reason: "strict mode does not include startupExecAllowlist",
        };
      }
      if (mode === "compat") {
        return {
          verdict: "conditional",
          reason:
            "compat supports startupExecAllowlist but depends on caller input",
        };
      }
      return {
        verdict: "allow",
        reason: "permissive mode allows process-exec globally",
      };
    case "command.dangerous.system":
      return {
        verdict: "conditional",
        reason:
          "blocked primarily by PermissionManager; sandbox outcome may vary by command path",
      };
    case "fallback.backend_unavailable":
      return {
        verdict: "conditional",
        reason: "manual fails closed; startup-only/session degrade to none",
      };
  }
}

function linuxRuleVerdict(
  operationId: SandboxOperation,
  mode: SandboxMode,
): Pick<SandboxMatrixRule, "verdict" | "reason"> {
  switch (operationId) {
    case "fs.write.workspace":
      return {
        verdict: "allow",
        reason: "workspace path is bind-mounted writable",
      };
    case "fs.write.outside_workspace":
    case "fs.delete.system_path":
      if (mode === "permissive") {
        return {
          verdict: "allow",
          reason: "permissive mode bind-mounts root writable",
        };
      }
      return {
        verdict: "block",
        reason: "strict/compat keep host root read-only outside writablePaths",
      };
    case "network.external":
      if (mode === "permissive") {
        return {
          verdict: "allow",
          reason: "permissive mode skips network namespace isolation",
        };
      }
      return {
        verdict: "conditional",
        reason: "depends on networkEnabled -> --unshare-net",
      };
    case "network.loopback":
      if (mode === "permissive") {
        return {
          verdict: "allow",
          reason: "no net namespace isolation in permissive mode",
        };
      }
      return {
        verdict: "conditional",
        reason: "loopback behavior depends on namespace/runtime tooling",
      };
    case "exec.startup_chain_extra":
      if (mode === "strict") {
        return {
          verdict: "conditional",
          reason: "strict only ro-binds minimal paths + command related dirs",
        };
      }
      return {
        verdict: "allow",
        reason: "compat/permissive keep full root visibility for exec",
      };
    case "command.dangerous.system":
      return {
        verdict: "conditional",
        reason:
          "blocked by PermissionManager first; sandbox-level outcome varies by command/capability",
      };
    case "fallback.backend_unavailable":
      return {
        verdict: "conditional",
        reason: "manual fails closed; startup-only/session degrade to none",
      };
  }
}

function windowsRuleVerdict(
  operationId: SandboxOperation,
  mode: SandboxMode,
  windowsMode: WindowsSandboxMode,
): Pick<SandboxMatrixRule, "verdict" | "reason"> {
  const workspaceWrite = windowsMode === "workspace-write";
  switch (operationId) {
    case "fs.write.workspace":
      if (!workspaceWrite) {
        return {
          verdict: "block",
          reason: "read-only mode blocks workspace write",
        };
      }
      return {
        verdict: "allow",
        reason: "workspace-write allows workspace root writes",
      };
    case "fs.write.outside_workspace":
      if (!workspaceWrite) {
        return { verdict: "block", reason: "read-only mode blocks writes" };
      }
      if (mode === "strict") {
        return {
          verdict: "conditional",
          reason:
            "strict limits writable_roots but helper still allows cwd/temp paths",
        };
      }
      return {
        verdict: "conditional",
        reason:
          "compat/permissive include wider writable roots and cwd-dependent allowances",
      };
    case "fs.delete.system_path":
      return {
        verdict: "conditional",
        reason: "depends on helper ACL application and writable root boundary",
      };
    // Windows 网络隔离限制：当前仅 env-stub 级别（清空 HTTP_PROXY 等环境变量），
    // 原生 socket 客户端可绕过。v1.1 计划通过 WFP 实现内核级网络过滤。
    case "network.external":
    case "network.loopback":
      if (!workspaceWrite) {
        return {
          verdict: "conditional",
          reason:
            "read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass",
        };
      }
      return {
        verdict: "conditional",
        reason:
          "network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1",
      };
    case "exec.startup_chain_extra":
      return {
        verdict: "allow",
        reason:
          "helper executes command chain; restriction is policy/ACL not exec allowlist",
      };
    case "command.dangerous.system":
      return {
        verdict: "conditional",
        reason: "blocked mainly by PermissionManager and ACL boundaries",
      };
    case "fallback.backend_unavailable":
      return {
        verdict: "conditional",
        reason: "manual fails closed; startup-only/session degrade to none",
      };
  }
}

function buildSandboxRules(): SandboxMatrixRule[] {
  const rules: SandboxMatrixRule[] = [];
  const modes: SandboxMode[] = ["strict", "compat", "permissive"];

  // macOS seatbelt
  for (const mode of modes) {
    const combo: Combo = {
      platform: "darwin",
      backend: "macos-seatbelt",
      mode,
      windowsMode: "n/a",
    };
    for (const operationId of SANDBOX_OPERATIONS) {
      const decision = darwinRuleVerdict(operationId, mode);
      rules.push(
        rule(combo, operationId, decision.verdict, decision.reason, [
          "src/main/services/sandbox/SandboxInvoker.ts",
          "src/main/services/sandbox/policy.ts",
        ]),
      );
    }
  }

  // Linux bwrap
  for (const mode of modes) {
    const combo: Combo = {
      platform: "linux",
      backend: "linux-bwrap",
      mode,
      windowsMode: "n/a",
    };
    for (const operationId of SANDBOX_OPERATIONS) {
      const decision = linuxRuleVerdict(operationId, mode);
      rules.push(
        rule(combo, operationId, decision.verdict, decision.reason, [
          "src/main/services/sandbox/SandboxInvoker.ts",
          "src/main/services/sandbox/policy.ts",
        ]),
      );
    }
  }

  // Windows helper
  const windowsModes: WindowsSandboxMode[] = ["read-only", "workspace-write"];
  for (const mode of modes) {
    for (const windowsMode of windowsModes) {
      const combo: Combo = {
        platform: "win32",
        backend: "windows-sandbox",
        mode,
        windowsMode,
      };
      for (const operationId of SANDBOX_OPERATIONS) {
        const decision = windowsRuleVerdict(operationId, mode, windowsMode);
        rules.push(
          rule(combo, operationId, decision.verdict, decision.reason, [
            "src/main/services/sandbox/SandboxInvoker.ts",
            "src/main/services/sandbox/policy.ts",
          ]),
        );
      }
    }
  }

  // Docker (currently unsupported at process-level sandbox)
  for (const mode of modes) {
    const combo: Combo = {
      platform: "all",
      backend: "docker",
      mode,
      windowsMode: "n/a",
    };
    for (const operationId of SANDBOX_OPERATIONS) {
      rules.push(
        rule(
          combo,
          operationId,
          "unsupported",
          "docker process-level sandbox is not implemented",
          ["src/main/services/sandbox/SandboxInvoker.ts"],
        ),
      );
    }
  }

  return rules;
}

function buildPermissionRules(): SandboxMatrixRule[] {
  const safeSample = DEFAULT_PERMISSION_POLICY.safeCommands[0] ?? "node";
  const dangerousSample = DANGEROUS_COMMANDS[0] ?? "sudo";

  return [
    {
      layer: "permission",
      platform: "all",
      backend: "permission-manager",
      mode: "n/a",
      windowsMode: "n/a",
      operationId: PERMISSION_OPERATIONS[0],
      verdict: "allow",
      reason: `safeCommands includes "${safeSample}" and is auto-approved for command:execute`,
      evidence: ["src/main/services/sandbox/PermissionManager.ts"],
    },
    {
      layer: "permission",
      platform: "all",
      backend: "permission-manager",
      mode: "n/a",
      windowsMode: "n/a",
      operationId: PERMISSION_OPERATIONS[1],
      verdict: "block",
      reason: `dangerous command pattern (e.g. "${dangerousSample}") is blocked`,
      evidence: ["src/main/services/sandbox/PermissionManager.ts"],
    },
    {
      layer: "permission",
      platform: "all",
      backend: "permission-manager",
      mode: "n/a",
      windowsMode: "n/a",
      operationId: PERMISSION_OPERATIONS[2],
      verdict: "block",
      reason:
        "sensitive paths (.ssh, /etc/passwd, /etc/shadow, /etc/sudoers, /etc/group) are blocked",
      evidence: ["src/main/services/sandbox/PermissionManager.ts"],
    },
    {
      layer: "permission",
      platform: "all",
      backend: "permission-manager",
      mode: "n/a",
      windowsMode: "n/a",
      operationId: PERMISSION_OPERATIONS[3],
      verdict: "block",
      reason: "denyList permission types are blocked",
      evidence: ["src/main/services/sandbox/PermissionManager.ts"],
    },
  ];
}

export function generateSandboxMatrixDocument(): SandboxMatrixDocument {
  const permissionLists = {
    commandAllowlist: [...DEFAULT_PERMISSION_POLICY.safeCommands].sort(),
    commandDenylist: [...DANGEROUS_COMMANDS].sort(),
    permissionTypeAutoApprove: [
      ...DEFAULT_PERMISSION_POLICY.autoApprove,
    ].sort(),
    permissionTypeDeny: [...DEFAULT_PERMISSION_POLICY.denyList].sort(),
  };

  const rules = [...buildSandboxRules(), ...buildPermissionRules()];
  const operations = [
    ...SANDBOX_OPERATIONS,
    ...PERMISSION_OPERATIONS,
  ] as string[];

  return {
    schemaVersion: "1.0.0",
    operations,
    permissionLists,
    rules,
  };
}

export function renderSandboxMatrixMarkdown(
  doc: SandboxMatrixDocument,
): string {
  const lines: string[] = [];
  lines.push("# Sandbox Whitelist / Blacklist Matrix (Generated)");
  lines.push("");
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- Schema version: \`${doc.schemaVersion}\``);
  lines.push(`- Total operations: \`${doc.operations.length}\``);
  lines.push(`- Total rules: \`${doc.rules.length}\``);
  lines.push(
    `- Command allowlist size: \`${doc.permissionLists.commandAllowlist.length}\``,
  );
  lines.push(
    `- Command denylist size: \`${doc.permissionLists.commandDenylist.length}\``,
  );
  lines.push("");
  lines.push("## Permission Lists");
  lines.push("");
  lines.push("### Command Allowlist");
  lines.push("");
  for (const cmd of doc.permissionLists.commandAllowlist) {
    lines.push(`- \`${cmd}\``);
  }
  lines.push("");
  lines.push("### Command Denylist");
  lines.push("");
  for (const cmd of doc.permissionLists.commandDenylist) {
    lines.push(`- \`${cmd}\``);
  }
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push(
    "| layer | platform | backend | mode | windowsMode | operationId | verdict | reason |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of doc.rules) {
    lines.push(
      `| ${row.layer} | ${row.platform} | ${row.backend} | ${row.mode} | ${row.windowsMode} | ${row.operationId} | ${row.verdict} | ${row.reason.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("- `src/main/services/sandbox/SandboxInvoker.ts`");
  lines.push("- `src/main/services/sandbox/policy.ts`");
  lines.push("- `src/main/services/sandbox/PermissionManager.ts`");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function stringifySandboxMatrixJson(doc: SandboxMatrixDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
