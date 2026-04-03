//! Sandbox policy types and parsing.
//!
//! Extracted from OpenAI Codex windows-sandbox-rs (codex-protocol::protocol::SandboxPolicy).
//! Reimplemented here to avoid codex-protocol workspace dependency.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Windows Restricted Token sandbox policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SandboxPolicy {
    /// No restrictions whatsoever. Use with caution.
    DangerFullAccess,

    /// Read-only access to the entire file-system.
    ReadOnly,

    /// Read-only + write access to workspace directories.
    WorkspaceWrite {
        /// Additional writable folders beyond cwd and TMPDIR.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        writable_roots: Vec<PathBuf>,

        /// Allow outbound network access. Defaults to false.
        #[serde(default)]
        network_access: bool,

        /// Exclude per-user TMPDIR from writable roots.
        #[serde(default)]
        exclude_tmpdir_env_var: bool,

        /// Exclude /tmp from writable roots (UNIX-only, no-op on Windows).
        #[serde(default)]
        exclude_slash_tmp: bool,
    },
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        SandboxPolicy::ReadOnly
    }
}

impl SandboxPolicy {
    pub fn new_read_only_policy() -> Self {
        SandboxPolicy::ReadOnly
    }

    pub fn new_workspace_write_policy() -> Self {
        SandboxPolicy::WorkspaceWrite {
            writable_roots: Vec::new(),
            network_access: false,
            exclude_tmpdir_env_var: false,
            exclude_slash_tmp: false,
        }
    }

    pub fn has_full_disk_read_access(&self) -> bool {
        true
    }

    pub fn has_full_disk_write_access(&self) -> bool {
        match self {
            SandboxPolicy::DangerFullAccess => true,
            SandboxPolicy::ReadOnly => false,
            SandboxPolicy::WorkspaceWrite { .. } => false,
        }
    }

    pub fn has_full_network_access(&self) -> bool {
        match self {
            SandboxPolicy::DangerFullAccess => true,
            SandboxPolicy::ReadOnly => false,
            SandboxPolicy::WorkspaceWrite { network_access, .. } => *network_access,
        }
    }
}

/// Parse a policy from a string (preset name or JSON).
pub fn parse_policy(value: &str) -> anyhow::Result<SandboxPolicy> {
    match value {
        "read-only" => Ok(SandboxPolicy::ReadOnly),
        "workspace-write" => Ok(SandboxPolicy::new_workspace_write_policy()),
        "danger-full-access" => {
            anyhow::bail!("DangerFullAccess is not supported for sandboxing")
        }
        other => {
            let parsed: SandboxPolicy = serde_json::from_str(other)?;
            if matches!(parsed, SandboxPolicy::DangerFullAccess) {
                anyhow::bail!("DangerFullAccess is not supported for sandboxing");
            }
            Ok(parsed)
        }
    }
}
