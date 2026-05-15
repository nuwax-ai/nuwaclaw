import { ipcMain, shell } from "electron";
import { spawn } from "child_process";
import { stat } from "fs/promises";
import * as path from "path";
import log from "electron-log";
import { STORAGE_KEYS } from "@shared/constants";
import { readSetting } from "../db";

export type WorkbenchOpenedBy = "cursor" | "vscode" | "system";

export type OpenEditorResult =
  | { success: true; openedBy: WorkbenchOpenedBy }
  | { success: false; error: string };

type EditorCandidate = {
  command: string;
  args: string[];
  openedBy: Exclude<WorkbenchOpenedBy, "system">;
};

const EDITOR_COMMAND_TIMEOUT_MS = 8_000;

function getEditorCandidates(workspaceDir: string): EditorCandidate[] {
  if (process.platform === "darwin") {
    return [
      {
        command: "/usr/bin/open",
        args: ["-a", "Cursor", workspaceDir],
        openedBy: "cursor",
      },
      {
        command: "/usr/bin/open",
        args: ["-a", "Visual Studio Code", workspaceDir],
        openedBy: "vscode",
      },
      { command: "cursor", args: [workspaceDir], openedBy: "cursor" },
      { command: "code", args: [workspaceDir], openedBy: "vscode" },
    ];
  }

  return [
    { command: "cursor", args: [workspaceDir], openedBy: "cursor" },
    { command: "code", args: [workspaceDir], openedBy: "vscode" },
  ];
}

function getEditorEnv(): NodeJS.ProcessEnv {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const fallbackPaths =
    process.platform === "win32"
      ? [
          process.env.SystemRoot
            ? path.join(process.env.SystemRoot, "System32")
            : "",
          process.env.SystemRoot ?? "",
        ]
      : [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];
  const existingPath = process.env.PATH ?? "";
  const mergedPath = [existingPath, ...fallbackPaths.filter(Boolean)]
    .filter(Boolean)
    .join(pathDelimiter);

  return {
    ...process.env,
    PATH: mergedPath,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function runEditorCommand(candidate: EditorCandidate): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, {
      env: getEditorEnv(),
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${candidate.command} timed out after ${EDITOR_COMMAND_TIMEOUT_MS}ms`,
        ),
      );
    }, EDITOR_COMMAND_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${candidate.command} exited with code ${code}`));
    });
  });
}

function getConfiguredWorkspaceDir(): string | null {
  const step1Config = readSetting(STORAGE_KEYS.STEP1_CONFIG) as {
    workspaceDir?: unknown;
  } | null;
  return typeof step1Config?.workspaceDir === "string"
    ? step1Config.workspaceDir
    : null;
}

async function resolveConfiguredWorkspaceDir(): Promise<string> {
  const workspaceDir = getConfiguredWorkspaceDir();
  if (!workspaceDir) {
    throw new Error("Configured workspace directory is required");
  }

  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const stats = await stat(resolvedWorkspaceDir);
  if (!stats.isDirectory()) {
    throw new Error("Configured workspace path is not a directory");
  }
  return resolvedWorkspaceDir;
}

export async function openWorkbenchEditor(): Promise<OpenEditorResult> {
  let resolvedWorkspaceDir: string;
  try {
    resolvedWorkspaceDir = await resolveConfiguredWorkspaceDir();
  } catch (error) {
    return { success: false, error: formatError(error) };
  }

  const editorErrors: string[] = [];

  for (const candidate of getEditorCandidates(resolvedWorkspaceDir)) {
    try {
      await runEditorCommand(candidate);
      return { success: true, openedBy: candidate.openedBy };
    } catch (error) {
      const message = formatError(error);
      editorErrors.push(`${candidate.command}: ${message}`);
      log.debug(
        `[IPC] workbench:openEditor candidate failed (${candidate.openedBy}): ${message}`,
      );
    }
  }

  try {
    const openResult = await shell.openPath(resolvedWorkspaceDir);
    if (openResult) {
      return {
        success: false,
        error: [openResult, ...editorErrors].join("; "),
      };
    }
    return { success: true, openedBy: "system" };
  } catch (error) {
    log.error("[IPC] workbench:openEditor shell fallback failed:", error);
    return {
      success: false,
      error: [formatError(error), ...editorErrors].join("; "),
    };
  }
}

export function registerWorkbenchHandlers(): void {
  ipcMain.handle("workbench:openEditor", async () => {
    try {
      return await openWorkbenchEditor();
    } catch (error) {
      log.error("[IPC] workbench:openEditor failed:", error);
      return { success: false, error: formatError(error) };
    }
  });
}
