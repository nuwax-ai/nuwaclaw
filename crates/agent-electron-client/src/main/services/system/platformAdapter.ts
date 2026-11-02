import * as fs from "fs";
import * as path from "path";
import type {
  Platform as SandboxPlatform,
  SandboxBackend,
  SandboxType,
} from "@shared/types/sandbox";

export type Platform = SandboxPlatform;

type CommandProbe = {
  command: string;
  args: string[];
};

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly isWindows: boolean;
  readonly isMacOS: boolean;
  readonly isLinux: boolean;
  readonly pathDelimiter: ":" | ";";
  readonly commandLocator: "which" | "where";
  readonly sandboxHelperName: string;
  getCommandProbe(command: string): CommandProbe;
  getRecommendedSandboxBackend(): SandboxBackend;
  getRecommendedSandboxType(): SandboxType;
  getSeatbeltPath(): string | null;
  getBundledLinuxBwrapCandidates(resourcesPath: string): string[];
  resolveBundledLinuxBwrapPath(resourcesPath: string): string | null;
  getBundledSandboxHelperCandidates(resourcesPath: string): string[];
  resolveBundledSandboxHelperPath(resourcesPath: string): string | null;
}

export function isSupportedPlatform(value: string): value is Platform {
  return value === "darwin" || value === "linux" || value === "win32";
}

export function getCurrentPlatform(): Platform {
  return isSupportedPlatform(process.platform) ? process.platform : "linux";
}

class RuntimePlatformAdapter implements PlatformAdapter {
  readonly isWindows: boolean;
  readonly isMacOS: boolean;
  readonly isLinux: boolean;
  readonly pathDelimiter: ":" | ";";
  readonly commandLocator: "which" | "where";
  readonly sandboxHelperName: string;

  constructor(readonly platform: Platform) {
    this.isWindows = platform === "win32";
    this.isMacOS = platform === "darwin";
    this.isLinux = platform === "linux";
    this.pathDelimiter = this.isWindows ? ";" : ":";
    this.commandLocator = this.isWindows ? "where" : "which";
    this.sandboxHelperName = this.isWindows
      ? "nuwax-sandbox-helper.exe"
      : "nuwax-sandbox-helper";
  }

  getCommandProbe(command: string): CommandProbe {
    return {
      command: this.commandLocator,
      args: [command],
    };
  }

  getRecommendedSandboxBackend(): SandboxBackend {
    if (this.isWindows) return "windows-sandbox";
    if (this.isMacOS) return "macos-seatbelt";
    return "linux-bwrap";
  }

  getRecommendedSandboxType(): SandboxType {
    if (this.isWindows) return "windows-sandbox";
    if (this.isMacOS) return "macos-seatbelt";
    return "linux-bwrap";
  }

  getSeatbeltPath(): string | null {
    return this.isMacOS ? "/usr/bin/sandbox-exec" : null;
  }

  getBundledLinuxBwrapCandidates(resourcesPath: string): string[] {
    const runtimeDir = path.join(resourcesPath, "sandbox-runtime");
    return [
      path.join(runtimeDir, "bin", "bwrap"),
      path.join(runtimeDir, "linux", "bwrap"),
    ];
  }

  resolveBundledLinuxBwrapPath(resourcesPath: string): string | null {
    for (const candidate of this.getBundledLinuxBwrapCandidates(
      resourcesPath,
    )) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  getBundledSandboxHelperCandidates(resourcesPath: string): string[] {
    const runtimeDir = path.join(resourcesPath, "sandbox-runtime");
    const helperRoot = path.join(resourcesPath, "sandbox-helper");
    const candidates = [
      path.join(runtimeDir, "bin", this.sandboxHelperName),
      path.join(helperRoot, this.sandboxHelperName),
    ];

    if (this.isWindows) {
      candidates.splice(
        1,
        0,
        path.join(runtimeDir, "windows", this.sandboxHelperName),
      );
    }

    return candidates;
  }

  resolveBundledSandboxHelperPath(resourcesPath: string): string | null {
    for (const candidate of this.getBundledSandboxHelperCandidates(
      resourcesPath,
    )) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}

export function createPlatformAdapter(
  platform: NodeJS.Platform = process.platform,
): PlatformAdapter {
  const resolvedPlatform = isSupportedPlatform(platform) ? platform : "linux";
  return new RuntimePlatformAdapter(resolvedPlatform);
}
