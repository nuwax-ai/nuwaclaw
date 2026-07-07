export interface ResolvedEngine {
  command: string;
  args: string[];
  /** Env values this engine needs beyond the inherited base (e.g. CLAUDE_CODE_EXECUTABLE). */
  envOverlay: NodeJS.ProcessEnv;
}

export interface EngineSpec {
  id: "claude" | "codex";
  /** Locates/installs whatever is needed and returns the spawn target. Throws with a user-facing message if the prerequisite CLI isn't installed. */
  resolve(): Promise<ResolvedEngine>;
}
