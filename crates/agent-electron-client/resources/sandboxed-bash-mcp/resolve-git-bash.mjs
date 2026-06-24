/**
 * Windows bundled Git Bash 探测（MCP 侧纯 JS，与 binaryLocator.getBundledGitBashPath 对齐）。
 * 仅查找应用包 resources/git 下的 bash.exe，不探测系统 Git for Windows。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function bundledGitBashCandidates(resourcesRoot) {
  return [
    path.join(resourcesRoot, "git", "bin", "bash.exe"),
    path.join(resourcesRoot, "git", "usr", "bin", "bash.exe"),
    path.join(resourcesRoot, "git", "mingw64", "bin", "bash.exe"),
    path.join(resourcesRoot, "git", "mingw64", "usr", "bin", "bash.exe"),
  ];
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return "";
}

/** @returns {string} absolute path to bundled bash.exe, or "" */
export function resolveGitBashPath() {
  const fromEnv = process.env.NUWAX_SANDBOX_GIT_BASH_PATH || "";
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const resourcesRoots = new Set();
  if (process.resourcesPath) {
    resourcesRoots.add(process.resourcesPath);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  resourcesRoots.add(path.resolve(moduleDir, ".."));
  resourcesRoots.add(path.resolve(process.cwd(), "resources"));

  for (const root of resourcesRoots) {
    const bundled = firstExisting(bundledGitBashCandidates(root));
    if (bundled) {
      return bundled;
    }
  }

  return "";
}
