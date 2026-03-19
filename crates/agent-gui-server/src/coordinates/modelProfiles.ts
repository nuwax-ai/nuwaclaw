/**
 * Model configuration table: coordinate modes and coordinate orders.
 *
 * Maps model names to their coordinate system properties via regex patterns.
 */

export type CoordinateMode = 'image-absolute' | 'normalized-1000' | 'normalized-999' | 'normalized-0-1';
export type CoordinateOrder = 'xy' | 'yx';

export interface ModelProfile {
  coordinateMode: CoordinateMode;
  coordinateOrder: CoordinateOrder;
}

interface ModelRule {
  pattern: RegExp;
  profile: ModelProfile;
}

const MODEL_RULES: ModelRule[] = [
  { pattern: /^claude-/i, profile: { coordinateMode: 'image-absolute', coordinateOrder: 'xy' } },
  { pattern: /^gpt-(4o|5)/i, profile: { coordinateMode: 'image-absolute', coordinateOrder: 'xy' } },
  { pattern: /^gemini/i, profile: { coordinateMode: 'normalized-999', coordinateOrder: 'yx' } },
  { pattern: /^ui-tars/i, profile: { coordinateMode: 'normalized-1000', coordinateOrder: 'xy' } },
  { pattern: /^qwen(2\.5)?-vl/i, profile: { coordinateMode: 'image-absolute', coordinateOrder: 'xy' } },
  { pattern: /^cogagent/i, profile: { coordinateMode: 'image-absolute', coordinateOrder: 'xy' } },
  { pattern: /^(seeclick|showui)/i, profile: { coordinateMode: 'normalized-0-1', coordinateOrder: 'xy' } },
];

const FALLBACK_PROFILE: ModelProfile = { coordinateMode: 'image-absolute', coordinateOrder: 'xy' };

/**
 * Get the coordinate profile for a given model name.
 *
 * @param modelName - The model name to match (e.g. 'claude-sonnet-4-20250514', 'gemini-2.5-pro')
 * @param overrideMode - If provided, overrides the coordinate mode from the matched profile
 */
export function getModelProfile(modelName: string, overrideMode?: CoordinateMode): ModelProfile {
  let profile = FALLBACK_PROFILE;

  for (const rule of MODEL_RULES) {
    if (rule.pattern.test(modelName)) {
      profile = rule.profile;
      break;
    }
  }

  if (overrideMode) {
    return { coordinateMode: overrideMode, coordinateOrder: profile.coordinateOrder };
  }

  return profile;
}
