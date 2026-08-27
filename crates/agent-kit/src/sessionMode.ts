// ACP session-mode negotiation shared by nuwa-cli & nuwaclaw.
//
// Two discovery channels, in priority order:
//  1. `modes` field on session/new|load|resume responses (claude-code-acp-ts,
//     deepagents-flow-ts, codex-acp-ts — SDK 0.26+/1.x shape).
//  2. the `mode` select config option (nuwaxcode/opencode exposes modes only
//     this way; its session responses carry no `modes` field).
//
// All types are structural — no ACP SDK runtime import, so one build serves
// hosts on SDK 0.26 and 1.x alike (see package.json peerDependencies).

/** Mode id every supported engine happens to agree on for plan mode. */
export const PLAN_MODE_ID = "plan";

export interface SessionModeDescriptor {
  id: string;
  name?: string | null;
  description?: string | null;
}

/** Structural slice of `SessionModeState` (session RPC result `modes`). */
export interface SessionModeStateLike {
  currentModeId?: string | null;
  availableModes?: Array<SessionModeDescriptor | null> | null;
}

/** Structural slice of `SessionConfigSelect`-family options. */
export interface ConfigOptionLike {
  id?: string;
  type?: string;
  currentValue?: unknown;
  /** 0.16+/0.26+ select shape. */
  options?: Array<
    | {
        value?: string;
        name?: string | null;
        description?: string | null;
      }
    | {
        group?: string;
        name?: string | null;
        options?: Array<{
          value?: string;
          name?: string | null;
          description?: string | null;
        }>;
      }
  > | null;
  /** Defensive: older naming some adapters used. */
  choices?: Array<{
    id?: string;
    value?: string;
    name?: string | null;
    description?: string | null;
  }> | null;
}

export interface ModeDiscoveryInput {
  modes?: SessionModeStateLike | null;
  configOptions?: ConfigOptionLike[] | null;
}

export interface EngineModeInfo {
  availableModes: SessionModeDescriptor[];
  currentModeId: string | null;
  /** Which channel the info came from; hosts log/telemetry may care. */
  source: "modes" | "config_option" | "none";
}

function asModeDescriptor(value: unknown): SessionModeDescriptor | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.value;
  if (typeof id !== "string" || id.length === 0) return undefined;
  return {
    id,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.description === "string"
      ? { description: record.description }
      : {}),
  };
}

function modeDescriptorsFromOption(option: ConfigOptionLike): SessionModeDescriptor[] {
  const descriptors: SessionModeDescriptor[] = [];
  for (const entry of option.options ?? []) {
    if (entry === null || typeof entry !== "object") continue;
    // Grouped selects ({group, options[]}) carry the values one level down.
    if ("options" in entry && Array.isArray(entry.options)) {
      for (const nested of entry.options) {
        const descriptor = asModeDescriptor(nested);
        if (descriptor) descriptors.push(descriptor);
      }
      continue;
    }
    const descriptor = asModeDescriptor(entry);
    if (descriptor) descriptors.push(descriptor);
  }
  for (const entry of option.choices ?? []) {
    const descriptor = asModeDescriptor(entry);
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
}

/**
 * Resolve the engine's operable modes from whatever a session/new|load|resume
 * result carried. `modes` wins when present; otherwise the `mode` config
 * option's values are used (nuwaxcode path). Missing both → empty info, which
 * hosts treat as "engine-side modes unavailable" (degrade the plan UI).
 */
export function resolveEngineModeInfo(input: ModeDiscoveryInput): EngineModeInfo {
  const modes = input.modes;
  const fromModes = Array.isArray(modes?.availableModes)
    ? modes?.availableModes
        .map(asModeDescriptor)
        .filter((d): d is SessionModeDescriptor => !!d)
    : [];
  if (fromModes.length > 0) {
    return {
      availableModes: fromModes,
      currentModeId:
        typeof modes?.currentModeId === "string" ? modes.currentModeId : null,
      source: "modes",
    };
  }

  const modeOption = (input.configOptions ?? []).find(
    (option) => option?.id === "mode",
  );
  if (modeOption) {
    const descriptors = modeDescriptorsFromOption(modeOption);
    if (descriptors.length > 0) {
      return {
        availableModes: descriptors,
        currentModeId:
          typeof modeOption.currentValue === "string"
            ? modeOption.currentValue
            : null,
        source: "config_option",
      };
    }
  }

  return { availableModes: [], currentModeId: null, source: "none" };
}

/**
 * Find the engine's plan-mode id among the discovered modes. Exact `plan`
 * first; otherwise any id containing "plan" (future renames). Null means the
 * engine has no plan mode — hosts should hide/degrade the plan toggle.
 */
export function resolvePlanModeId(
  availableModes: SessionModeDescriptor[],
): string | null {
  const exact = availableModes.find((mode) => mode.id === PLAN_MODE_ID);
  if (exact) return exact.id;
  const fuzzy = availableModes.find((mode) =>
    mode.id.toLowerCase().includes(PLAN_MODE_ID),
  );
  return fuzzy ? fuzzy.id : null;
}

/**
 * Channel into an ACP agent for applying a session mode. Both members are
 * optional: agents implement them to varying degrees (nuwaxcode implements
 * both; some adapters only one; host SDK surfaces declare them optional).
 */
export interface SessionModeChannel {
  setSessionMode?(params: {
    sessionId: string;
    modeId: string;
  }): Promise<unknown>;
  setSessionConfigOption?(params: {
    sessionId: string;
    configId: string;
    value: string;
  }): Promise<unknown>;
}

export type SessionModeApplyOutcome =
  | { status: "applied"; modeId: string; via: "set_mode" | "config_option" }
  | { status: "unsupported"; modeId: string; reason: "no_channel" | "not_available" }
  | { status: "failed"; modeId: string; reason: string };

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

/**
 * Best-effort apply of a session mode: `session/set_mode` first, falling back
 * to the `mode` config option when the RPC is unimplemented or rejects the
 * modeId (e.g. agents that never adopted the modes field). Mode application is
 * advisory — on failure hosts should keep prompting rather than fail the turn.
 */
export async function applySessionMode(input: {
  sessionId: string;
  modeId: string;
  connection: SessionModeChannel;
}): Promise<SessionModeApplyOutcome> {
  const { sessionId, modeId, connection } = input;

  let setModeError: unknown;
  if (connection.setSessionMode) {
    try {
      await connection.setSessionMode({ sessionId, modeId });
      return { status: "applied", modeId, via: "set_mode" };
    } catch (err) {
      setModeError = err;
    }
  }

  if (connection.setSessionConfigOption) {
    try {
      await connection.setSessionConfigOption({
        sessionId,
        configId: "mode",
        value: modeId,
      });
      return { status: "applied", modeId, via: "config_option" };
    } catch (err) {
      return { status: "failed", modeId, reason: describeError(err) };
    }
  }

  if (setModeError !== undefined) {
    return { status: "failed", modeId, reason: describeError(setModeError) };
  }
  return { status: "unsupported", modeId, reason: "no_channel" };
}

/** Business-level agent mode carried by chat requests (nuwax agent_mode). */
export type BusinessAgentMode = "ask" | "yolo" | "plan";

export interface BusinessModeSyncResult {
  /** Engine mode id after this sync (unchanged when nothing was applied). */
  currentModeId: string | null;
  /** Outcome of the apply attempt when one was made (diagnostics/logging). */
  outcome?: SessionModeApplyOutcome;
}

/**
 * Sync a business agent_mode to the engine session mode — the single semantic
 * shared by nuwaclaw's per-chat sync and nuwa-cli's per-prompt sync:
 *
 * - plan → engine-side plan mode when the engine advertises one (exact `plan`
 *   id, else any id containing "plan"); no-op when already there; unsupported
 *   engines keep their default (plan is an enhancement, never a precondition).
 * - ask/yolo → engine default; only restores when the engine currently sits in
 *   a plan mode we (or the engine) previously entered, so plan never leaks
 *   across requests. Restore target = the engine's initial mode, else the
 *   first non-plan mode.
 *
 * `currentModeId` is the caller's mirror of the engine mode — hosts must keep
 * it updated from discovery results and `current_mode_update` notifications.
 */
export async function syncBusinessModeToEngine(input: {
  sessionId: string;
  desired: BusinessAgentMode;
  info: EngineModeInfo;
  currentModeId: string | null;
  connection: SessionModeChannel;
}): Promise<BusinessModeSyncResult> {
  const { sessionId, desired, info, currentModeId, connection } = input;
  const planModeId = resolvePlanModeId(info.availableModes);

  if (desired === "plan") {
    if (!planModeId) {
      return {
        currentModeId,
        outcome: { status: "unsupported", modeId: "plan", reason: "not_available" },
      };
    }
    if (currentModeId === planModeId) return { currentModeId };
    const outcome = await applySessionMode({
      sessionId,
      modeId: planModeId,
      connection,
    });
    return {
      currentModeId: outcome.status === "applied" ? planModeId : currentModeId,
      outcome,
    };
  }

  if (planModeId && currentModeId === planModeId) {
    const initialId = info.currentModeId;
    const restoreId =
      initialId && initialId !== planModeId
        ? initialId
        : (info.availableModes.find((mode) => mode.id !== planModeId)?.id ??
          null);
    if (!restoreId) return { currentModeId };
    const outcome = await applySessionMode({
      sessionId,
      modeId: restoreId,
      connection,
    });
    return {
      currentModeId: outcome.status === "applied" ? restoreId : currentModeId,
      outcome,
    };
  }

  return { currentModeId };
}
