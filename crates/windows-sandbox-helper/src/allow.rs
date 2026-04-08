//! Compute allow/deny path sets from a sandbox policy.

use crate::policy::SandboxPolicy;
use dunce::canonicalize;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct AllowDenyPaths {
    pub allow: HashSet<PathBuf>,
    pub deny: HashSet<PathBuf>,
}

pub fn compute_allow_paths(
    policy: &SandboxPolicy,
    policy_cwd: &Path,
    command_cwd: &Path,
    env_map: &HashMap<String, String>,
) -> AllowDenyPaths {
    let mut allow: HashSet<PathBuf> = HashSet::new();
    let mut deny: HashSet<PathBuf> = HashSet::new();

    let mut add_allow_path = |p: PathBuf| {
        if p.exists() {
            allow.insert(p);
        }
    };
    let mut add_deny_path = |p: PathBuf| {
        if p.exists() {
            deny.insert(p);
        }
    };

    if matches!(policy, SandboxPolicy::WorkspaceWrite { .. }) {
        let add_writable_root =
            |root: PathBuf, policy_cwd: &Path,
             add_allow: &mut dyn FnMut(PathBuf), add_deny: &mut dyn FnMut(PathBuf)| {
                let candidate = if root.is_absolute() {
                    root
                } else {
                    policy_cwd.join(root)
                };
                let canonical = canonicalize(&candidate).unwrap_or(candidate);
                add_allow(canonical.clone());

                let git_dir = canonical.join(".git");
                if git_dir.is_dir() {
                    add_deny(git_dir);
                }
            };

        add_writable_root(
            command_cwd.to_path_buf(),
            policy_cwd,
            &mut add_allow_path,
            &mut add_deny_path,
        );

        if let SandboxPolicy::WorkspaceWrite { writable_roots, .. } = policy {
            for root in writable_roots {
                add_writable_root(
                    root.clone(),
                    policy_cwd,
                    &mut add_allow_path,
                    &mut add_deny_path,
                );
            }
        }
    }

    // Always include TEMP/TMP as writable roots
    for key in ["TEMP", "TMP"] {
        if let Some(v) = env_map.get(key) {
            add_allow_path(PathBuf::from(v));
        } else if let Ok(v) = std::env::var(key) {
            add_allow_path(PathBuf::from(v));
        }
    }

    AllowDenyPaths { allow, deny }
}
