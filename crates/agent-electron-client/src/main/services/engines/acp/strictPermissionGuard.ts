import * as fs from "fs";
import * as path from "path";
import type { AcpPermissionRequest } from "./acpClient";
import { getCurrentPlatform } from "@main/services/system/platformAdapter";

const WRITE_KEYWORDS = [
  "write",
  "edit",
  "notebook",
  "rename",
  "move",
  "delete",
  "create_file",
  "create file",
] as const;

const NON_WRITE_KEYWORDS = ["bash", "terminal", "shell", "webfetch", "http"];

const PATH_FIELDS = new Set([
  "path",
  "file",
  "file_path",
  "filepath",
  "filePath",
  "target_notebook",
  "targetNotebook",
  "notebook_path",
  "notebookPath",
  "new_path",
  "newPath",
  "old_path",
  "oldPath",
  "target_path",
  "targetPath",
  "source_path",
  "sourcePath",
  "destination_path",
  "destinationPath",
  "directory",
  "dir",
  "folder",
]);

export interface StrictPermissionContext {
  strictEnabled: boolean;
  sandboxMode?: string;
  workspaceDir?: string;
  projectWorkspaceDir?: string;
  isolatedHome?: string | null;
  appDataDir: string;
  tempDirs?: Array<string | null | undefined>;
  platform?: NodeJS.Platform;
}

export interface StrictPermissionDecision {
  isWriteRequest: boolean;
  blocked: boolean;
  reason: string;
  candidatePaths: string[];
  resolvedPaths: string[];
  writableRoots: string[];
}

interface PathResolveContext {
  baseDir?: string;
  homeDir?: string | null;
  platform: NodeJS.Platform;
}

export function evaluateStrictWritePermission(
  request: AcpPermissionRequest,
  context: StrictPermissionContext,
): StrictPermissionDecision {
  if (!context.strictEnabled) {
    return {
      isWriteRequest: false,
      blocked: false,
      reason: "strict_not_active",
      candidatePaths: [],
      resolvedPaths: [],
      writableRoots: [],
    };
  }

  const isWriteRequest = isWriteLikePermissionRequest(request);
  if (!isWriteRequest) {
    return {
      isWriteRequest: false,
      blocked: false,
      reason: "not_write_request",
      candidatePaths: [],
      resolvedPaths: [],
      writableRoots: [],
    };
  }

  const pathResolveContext = buildPathResolveContext(context);
  const writableRoots = buildStrictWritableRoots(context, pathResolveContext);
  const candidates = extractPathCandidates(request.toolCall.rawInput);
  if (candidates.length === 0) {
    return {
      isWriteRequest: true,
      blocked: true,
      reason: "strict_missing_path",
      candidatePaths: [],
      resolvedPaths: [],
      writableRoots,
    };
  }

  const resolvedPaths: string[] = [];
  const platform = context.platform ?? getCurrentPlatform();
  for (const candidate of candidates) {
    const resolved = resolvePathForSandbox(candidate, pathResolveContext);
    if (!resolved) {
      return {
        isWriteRequest: true,
        blocked: true,
        reason: "strict_unresolved_path",
        candidatePaths: candidates,
        resolvedPaths,
        writableRoots,
      };
    }
    resolvedPaths.push(resolved);
    if (!isPathWithinAnyRoot(resolved, writableRoots, platform)) {
      return {
        isWriteRequest: true,
        blocked: true,
        reason: "strict_path_outside_roots",
        candidatePaths: candidates,
        resolvedPaths,
        writableRoots,
      };
    }
  }

  return {
    isWriteRequest: true,
    blocked: false,
    reason: "strict_paths_allowed",
    candidatePaths: candidates,
    resolvedPaths,
    writableRoots,
  };
}

function buildPathResolveContext(
  context: StrictPermissionContext,
): PathResolveContext {
  return {
    baseDir: context.projectWorkspaceDir || context.workspaceDir,
    homeDir: context.isolatedHome,
    platform: context.platform ?? getCurrentPlatform(),
  };
}

function isWriteLikePermissionRequest(params: AcpPermissionRequest): boolean {
  const kindAndTitle =
    `${params.toolCall.kind ?? ""} ${params.toolCall.title ?? ""}`
      .toLowerCase()
      .trim();

  if (NON_WRITE_KEYWORDS.some((kw) => kindAndTitle.includes(kw))) {
    return false;
  }
  if (WRITE_KEYWORDS.some((kw) => kindAndTitle.includes(kw))) {
    return true;
  }
  return extractPathCandidates(params.toolCall.rawInput).length > 0;
}

function buildStrictWritableRoots(
  context: StrictPermissionContext,
  pathResolveContext: PathResolveContext,
): string[] {
  const roots = new Set<string>();

  const add = (candidate: string | null | undefined) => {
    if (!candidate) return;
    const resolved = resolvePathForSandbox(candidate, pathResolveContext);
    if (resolved) roots.add(resolved);
  };

  add(context.workspaceDir);
  add(context.projectWorkspaceDir);
  // Only include appDataDir in compat/permissive — matches Rust allow.rs behavior.
  // Strict mode intentionally excludes APPDATA for minimal write surface.
  if (context.sandboxMode !== "strict") {
    add(context.appDataDir);
  }
  if (context.tempDirs) {
    for (const tempPath of context.tempDirs) {
      add(tempPath);
    }
  }
  if (context.isolatedHome) {
    add(context.isolatedHome);
    add(path.join(context.isolatedHome, "tmp"));
  }

  return [...roots];
}

function extractPathCandidates(rawInput: unknown): string[] {
  const found = new Set<string>();
  const stack: Array<{ value: unknown; keyHint: string }> = [
    { value: rawInput, keyHint: "" },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { value, keyHint } = current;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (isLikelyPathValue(trimmed, keyHint)) {
        found.add(trimmed);
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push({ value: item, keyHint });
      }
      continue;
    }

    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        stack.push({ value: v, keyHint: k });
      }
    }
  }

  return [...found];
}

function isLikelyPathValue(value: string, keyHint: string): boolean {
  if (/^https?:\/\//i.test(value)) return false;

  const key = keyHint.trim();
  if (!key) {
    return looksLikePath(value);
  }
  if (
    PATH_FIELDS.has(key) ||
    key.endsWith("_path") ||
    key.toLowerCase().endsWith("path") ||
    key.toLowerCase().includes("directory") ||
    key.toLowerCase().includes("folder")
  ) {
    return true;
  }
  // 兼容未知字段名（例如部分 MCP 工具参数会用 target_notebook 之外的自定义键），
  // 只要值本身明显是路径，就按路径处理，避免 strict 模式误判为 missing_path。
  return looksLikePath(value);
}

function looksLikePath(value: string): boolean {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return true;
  }
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    return true;
  }
  if (value.startsWith("./") || value.startsWith("../")) return true;
  return false;
}

function getPathOps(
  platform: NodeJS.Platform,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

function resolvePathForSandbox(
  pathCandidate: string,
  context?: PathResolveContext,
): string | null {
  const platform = context?.platform ?? getCurrentPlatform();
  const pathOps = getPathOps(platform);
  const expanded = expandHomePath(pathCandidate, context?.homeDir, pathOps);
  const baseDir = context?.baseDir;
  const resolved =
    baseDir && !pathOps.isAbsolute(expanded)
      ? pathOps.resolve(baseDir, expanded)
      : pathOps.resolve(expanded);

  // Cross-platform unit tests may evaluate Windows-style paths on non-Windows hosts.
  // Skip filesystem canonicalization in that case; runtime on target platform still
  // goes through realpath below.
  if (platform !== getCurrentPlatform()) {
    return resolved;
  }

  try {
    return fs.realpathSync(resolved);
  } catch {
    let cursor = pathOps.dirname(resolved);
    let suffix = pathOps.basename(resolved);
    while (true) {
      try {
        const cursorReal = fs.realpathSync(cursor);
        return pathOps.join(cursorReal, suffix);
      } catch {
        const parent = pathOps.dirname(cursor);
        if (parent === cursor) {
          return resolved;
        }
        suffix = pathOps.join(pathOps.basename(cursor), suffix);
        cursor = parent;
      }
    }
  }
}

function expandHomePath(
  inputPath: string,
  homeDir: string | null | undefined,
  pathOps: typeof path.posix | typeof path.win32,
): string {
  const fallbackHome = process.env.HOME || process.env.USERPROFILE || "";
  const home = homeDir || fallbackHome;
  if (inputPath === "~") {
    return home || "~";
  }
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return home ? pathOps.join(home, inputPath.slice(2)) : inputPath;
  }
  return inputPath;
}

function normalizePathForCompare(
  inputPath: string,
  platform: NodeJS.Platform,
): string {
  let normalized = inputPath.replace(/\\/g, "/");
  if (platform === "win32") {
    normalized = normalized.toLowerCase();
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    const isWindowsDriveRoot = /^[a-z]:\/$/i.test(normalized);
    if (!isWindowsDriveRoot) {
      normalized = normalized.replace(/\/+$/, "");
    }
  }
  return normalized;
}

function isPathWithinAnyRoot(
  candidatePath: string,
  roots: string[],
  platform: NodeJS.Platform,
): boolean {
  const normalizedCandidate = normalizePathForCompare(candidatePath, platform);
  for (const root of roots) {
    const normalizedRoot = normalizePathForCompare(root, platform);
    if (!normalizedRoot) continue;
    if (normalizedCandidate === normalizedRoot) return true;
    const prefix = normalizedRoot.endsWith("/")
      ? normalizedRoot
      : `${normalizedRoot}/`;
    if (normalizedCandidate.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
