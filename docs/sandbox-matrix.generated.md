# Sandbox Whitelist / Blacklist Matrix (Generated)

## Metadata

- Schema version: `1.0.0`
- Total operations: `12`
- Total rules: `124`
- Command allowlist size: `32`
- Command denylist size: `15`

## Permission Lists

### Command Allowlist

- `bun`
- `cargo`
- `cat`
- `cmake`
- `cp`
- `date`
- `echo`
- `env`
- `find`
- `git`
- `grep`
- `head`
- `ls`
- `make`
- `mkdir`
- `mv`
- `node`
- `npm`
- `npx`
- `pip`
- `pip3`
- `pnpm`
- `pwd`
- `python`
- `python3`
- `rustc`
- `rustup`
- `tail`
- `touch`
- `uv`
- `which`
- `yarn`

### Command Denylist

- `apt install`
- `apt-get install`
- `brew install`
- `chmod 777`
- `chown`
- `dnf install`
- `masscan`
- `nc -l`
- `netcat`
- `nmap`
- `pacman -S`
- `snap install`
- `su`
- `sudo`
- `yum install`

## Rules

| layer | platform | backend | mode | windowsMode | operationId | verdict | reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sandbox | darwin | macos-seatbelt | strict | n/a | fs.write.workspace | allow | workspace path is explicitly writable |
| sandbox | darwin | macos-seatbelt | strict | n/a | fs.write.outside_workspace | block | seatbelt non-permissive mode only allows writablePaths |
| sandbox | darwin | macos-seatbelt | strict | n/a | fs.delete.system_path | block | seatbelt non-permissive mode only allows writablePaths |
| sandbox | darwin | macos-seatbelt | strict | n/a | network.external | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | strict | n/a | network.loopback | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | strict | n/a | exec.startup_chain_extra | block | strict mode does not include startupExecAllowlist |
| sandbox | darwin | macos-seatbelt | strict | n/a | command.dangerous.system | conditional | blocked primarily by PermissionManager; sandbox outcome may vary by command path |
| sandbox | darwin | macos-seatbelt | strict | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | darwin | macos-seatbelt | compat | n/a | fs.write.workspace | allow | workspace path is explicitly writable |
| sandbox | darwin | macos-seatbelt | compat | n/a | fs.write.outside_workspace | block | seatbelt non-permissive mode only allows writablePaths |
| sandbox | darwin | macos-seatbelt | compat | n/a | fs.delete.system_path | block | seatbelt non-permissive mode only allows writablePaths |
| sandbox | darwin | macos-seatbelt | compat | n/a | network.external | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | compat | n/a | network.loopback | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | compat | n/a | exec.startup_chain_extra | conditional | compat supports startupExecAllowlist but depends on caller input |
| sandbox | darwin | macos-seatbelt | compat | n/a | command.dangerous.system | conditional | blocked primarily by PermissionManager; sandbox outcome may vary by command path |
| sandbox | darwin | macos-seatbelt | compat | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | darwin | macos-seatbelt | permissive | n/a | fs.write.workspace | allow | workspace path is explicitly writable |
| sandbox | darwin | macos-seatbelt | permissive | n/a | fs.write.outside_workspace | allow | permissive mode enables file-write* globally |
| sandbox | darwin | macos-seatbelt | permissive | n/a | fs.delete.system_path | allow | permissive mode enables file-write* globally |
| sandbox | darwin | macos-seatbelt | permissive | n/a | network.external | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | permissive | n/a | network.loopback | conditional | depends on networkEnabled -> (allow network*) |
| sandbox | darwin | macos-seatbelt | permissive | n/a | exec.startup_chain_extra | allow | permissive mode allows process-exec globally |
| sandbox | darwin | macos-seatbelt | permissive | n/a | command.dangerous.system | conditional | blocked primarily by PermissionManager; sandbox outcome may vary by command path |
| sandbox | darwin | macos-seatbelt | permissive | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | linux | linux-bwrap | strict | n/a | fs.write.workspace | allow | workspace path is bind-mounted writable |
| sandbox | linux | linux-bwrap | strict | n/a | fs.write.outside_workspace | block | strict/compat keep host root read-only outside writablePaths |
| sandbox | linux | linux-bwrap | strict | n/a | fs.delete.system_path | block | strict/compat keep host root read-only outside writablePaths |
| sandbox | linux | linux-bwrap | strict | n/a | network.external | conditional | depends on networkEnabled -> --unshare-net |
| sandbox | linux | linux-bwrap | strict | n/a | network.loopback | conditional | loopback behavior depends on namespace/runtime tooling |
| sandbox | linux | linux-bwrap | strict | n/a | exec.startup_chain_extra | conditional | strict only ro-binds minimal paths + command related dirs |
| sandbox | linux | linux-bwrap | strict | n/a | command.dangerous.system | conditional | blocked by PermissionManager first; sandbox-level outcome varies by command/capability |
| sandbox | linux | linux-bwrap | strict | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | linux | linux-bwrap | compat | n/a | fs.write.workspace | allow | workspace path is bind-mounted writable |
| sandbox | linux | linux-bwrap | compat | n/a | fs.write.outside_workspace | block | strict/compat keep host root read-only outside writablePaths |
| sandbox | linux | linux-bwrap | compat | n/a | fs.delete.system_path | block | strict/compat keep host root read-only outside writablePaths |
| sandbox | linux | linux-bwrap | compat | n/a | network.external | conditional | depends on networkEnabled -> --unshare-net |
| sandbox | linux | linux-bwrap | compat | n/a | network.loopback | conditional | loopback behavior depends on namespace/runtime tooling |
| sandbox | linux | linux-bwrap | compat | n/a | exec.startup_chain_extra | allow | compat/permissive keep full root visibility for exec |
| sandbox | linux | linux-bwrap | compat | n/a | command.dangerous.system | conditional | blocked by PermissionManager first; sandbox-level outcome varies by command/capability |
| sandbox | linux | linux-bwrap | compat | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | linux | linux-bwrap | permissive | n/a | fs.write.workspace | allow | workspace path is bind-mounted writable |
| sandbox | linux | linux-bwrap | permissive | n/a | fs.write.outside_workspace | allow | permissive mode bind-mounts root writable |
| sandbox | linux | linux-bwrap | permissive | n/a | fs.delete.system_path | allow | permissive mode bind-mounts root writable |
| sandbox | linux | linux-bwrap | permissive | n/a | network.external | allow | permissive mode skips network namespace isolation |
| sandbox | linux | linux-bwrap | permissive | n/a | network.loopback | allow | no net namespace isolation in permissive mode |
| sandbox | linux | linux-bwrap | permissive | n/a | exec.startup_chain_extra | allow | compat/permissive keep full root visibility for exec |
| sandbox | linux | linux-bwrap | permissive | n/a | command.dangerous.system | conditional | blocked by PermissionManager first; sandbox-level outcome varies by command/capability |
| sandbox | linux | linux-bwrap | permissive | n/a | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | strict | read-only | fs.write.workspace | block | read-only mode blocks workspace write |
| sandbox | win32 | windows-sandbox | strict | read-only | fs.write.outside_workspace | block | read-only mode blocks writes |
| sandbox | win32 | windows-sandbox | strict | read-only | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | strict | read-only | network.external | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | strict | read-only | network.loopback | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | strict | read-only | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | strict | read-only | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | strict | read-only | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | strict | workspace-write | fs.write.workspace | allow | workspace-write allows workspace root writes |
| sandbox | win32 | windows-sandbox | strict | workspace-write | fs.write.outside_workspace | conditional | strict limits writable_roots but helper still allows cwd/temp paths |
| sandbox | win32 | windows-sandbox | strict | workspace-write | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | strict | workspace-write | network.external | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | strict | workspace-write | network.loopback | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | strict | workspace-write | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | strict | workspace-write | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | strict | workspace-write | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | compat | read-only | fs.write.workspace | block | read-only mode blocks workspace write |
| sandbox | win32 | windows-sandbox | compat | read-only | fs.write.outside_workspace | block | read-only mode blocks writes |
| sandbox | win32 | windows-sandbox | compat | read-only | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | compat | read-only | network.external | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | compat | read-only | network.loopback | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | compat | read-only | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | compat | read-only | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | compat | read-only | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | compat | workspace-write | fs.write.workspace | allow | workspace-write allows workspace root writes |
| sandbox | win32 | windows-sandbox | compat | workspace-write | fs.write.outside_workspace | conditional | compat/permissive include wider writable roots and cwd-dependent allowances |
| sandbox | win32 | windows-sandbox | compat | workspace-write | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | compat | workspace-write | network.external | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | compat | workspace-write | network.loopback | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | compat | workspace-write | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | compat | workspace-write | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | compat | workspace-write | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | permissive | read-only | fs.write.workspace | block | read-only mode blocks workspace write |
| sandbox | win32 | windows-sandbox | permissive | read-only | fs.write.outside_workspace | block | read-only mode blocks writes |
| sandbox | win32 | windows-sandbox | permissive | read-only | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | permissive | read-only | network.external | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | permissive | read-only | network.loopback | conditional | read-only policy enforces no full network but relies on env-stub best-effort (no WFP yet); native socket clients can bypass |
| sandbox | win32 | windows-sandbox | permissive | read-only | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | permissive | read-only | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | permissive | read-only | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | fs.write.workspace | allow | workspace-write allows workspace root writes |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | fs.write.outside_workspace | conditional | compat/permissive include wider writable roots and cwd-dependent allowances |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | fs.delete.system_path | conditional | depends on helper ACL application and writable root boundary |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | network.external | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | network.loopback | conditional | network_access is env-stub only (best-effort), not kernel-level isolation; native socket clients can bypass; WFP integration planned for v1.1 |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | exec.startup_chain_extra | allow | helper executes command chain; restriction is policy/ACL not exec allowlist |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | command.dangerous.system | conditional | blocked mainly by PermissionManager and ACL boundaries |
| sandbox | win32 | windows-sandbox | permissive | workspace-write | fallback.backend_unavailable | conditional | manual fails closed; startup-only/session degrade to none |
| sandbox | all | docker | strict | n/a | fs.write.workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | fs.write.outside_workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | fs.delete.system_path | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | network.external | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | network.loopback | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | exec.startup_chain_extra | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | command.dangerous.system | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | strict | n/a | fallback.backend_unavailable | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | fs.write.workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | fs.write.outside_workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | fs.delete.system_path | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | network.external | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | network.loopback | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | exec.startup_chain_extra | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | command.dangerous.system | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | compat | n/a | fallback.backend_unavailable | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | fs.write.workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | fs.write.outside_workspace | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | fs.delete.system_path | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | network.external | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | network.loopback | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | exec.startup_chain_extra | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | command.dangerous.system | unsupported | docker process-level sandbox is not implemented |
| sandbox | all | docker | permissive | n/a | fallback.backend_unavailable | unsupported | docker process-level sandbox is not implemented |
| permission | all | permission-manager | n/a | n/a | permission.command.safe | allow | safeCommands includes "node" and is auto-approved for command:execute |
| permission | all | permission-manager | n/a | n/a | permission.command.dangerous | block | dangerous command pattern (e.g. "sudo") is blocked |
| permission | all | permission-manager | n/a | n/a | permission.path.sensitive | block | sensitive paths (.ssh, /etc/passwd, /etc/shadow, /etc/sudoers, /etc/group) are blocked |
| permission | all | permission-manager | n/a | n/a | permission.type.deny | block | denyList permission types are blocked |

## Evidence

- `src/main/services/sandbox/SandboxInvoker.ts`
- `src/main/services/sandbox/policy.ts`
- `src/main/services/sandbox/PermissionManager.ts`

