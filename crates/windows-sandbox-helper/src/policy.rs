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
        }
    }

    pub fn has_full_network_access(&self) -> bool {
        match self {
            SandboxPolicy::ReadOnly => false,
            SandboxPolicy::WorkspaceWrite { network_access, .. } => *network_access,
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
