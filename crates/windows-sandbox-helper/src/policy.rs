//! Sandbox policy types and parsing.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Windows Restricted Token sandbox policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SandboxPolicy {
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

        /// Sandbox strictness mode — controls which system paths are writable.
        /// - "strict":     only workspace + TEMP/TMP (no APPDATA)
        /// - "compat":     workspace + TEMP/TMP + APPDATA/LOCALAPPDATA
        /// - "permissive": all user-writable paths
        /// Defaults to "compat" when absent.
        #[serde(default = "default_sandbox_mode")]
        sandbox_mode: String,
    },
}

fn default_sandbox_mode() -> String {
    "compat".to_string()
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
            sandbox_mode: default_sandbox_mode(),
        }
    }

    pub fn has_full_network_access(&self) -> bool {
        match self {
            SandboxPolicy::ReadOnly => false,
            SandboxPolicy::WorkspaceWrite { network_access, .. } => *network_access,
        }
    }

    /// Returns the sandbox strictness mode, defaulting to "compat".
    pub fn sandbox_mode(&self) -> &str {
        match self {
            SandboxPolicy::ReadOnly => "strict",
            SandboxPolicy::WorkspaceWrite { sandbox_mode, .. } => sandbox_mode,
        }
    }
}

/// Parse a policy from a string (preset name or JSON).
pub fn parse_policy(value: &str) -> anyhow::Result<SandboxPolicy> {
    match value {
        "read-only" => Ok(SandboxPolicy::new_read_only_policy()),
        "workspace-write" => Ok(SandboxPolicy::new_workspace_write_policy()),
        other => Ok(serde_json::from_str(other)?),
    }
}
