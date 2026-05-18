/**
 * @deprecated Import from `./opencodeAcpSandbox` or `./acpEngineSandbox` instead.
 */
export {
  OPENCODE_NATIVE_SANDBOX_CONFIG_ENABLED as NUWAXCODE_NATIVE_OPENCODE_SANDBOX_ENABLED,
  OPENCODE_NATIVE_SANDBOX_CONFIG_MIN_VERSION as NUWAXCODE_OPENCODE_SANDBOX_CONFIG_MIN_VERSION,
  parseSemverTriplet,
  compareSemver,
  supportsOpencodeConfigSandbox,
  usesNativeOpencodeSandbox as useNativeNuwaxcodeSandbox,
  getSandboxedBashMcpScriptPath,
  getSandboxedFsMcpScriptPath,
  resolveSandboxWritableRoots,
  canInjectSandboxedBashMcp,
  canInjectSandboxedFsMcp,
  type FileExistsFn,
} from "./opencodeAcpSandbox";

import {
  applyOpencodeSandboxToOpenCodeConfig,
  readBundledOpencodeEngineVersion,
  type ApplyOpencodeSandboxConfigOptions,
  type ApplyOpencodeSandboxConfigResult,
} from "./opencodeAcpSandbox";

export type ApplyNuwaxcodeSandboxConfigOptions =
  ApplyOpencodeSandboxConfigOptions & {
    /** @deprecated use engineVersion */
    nuwaxcodeVersion?: string | null;
  };

export type ApplyNuwaxcodeSandboxConfigResult =
  ApplyOpencodeSandboxConfigResult;

export function readBundledNuwaxcodeVersion(): string | undefined {
  return readBundledOpencodeEngineVersion("nuwaxcode");
}

export function applyNuwaxcodeSandboxToOpenCodeConfig(
  options: ApplyNuwaxcodeSandboxConfigOptions,
): ApplyNuwaxcodeSandboxConfigResult {
  const { nuwaxcodeVersion, ...rest } = options;
  return applyOpencodeSandboxToOpenCodeConfig({
    ...rest,
    engineVersion:
      rest.engineVersion ?? nuwaxcodeVersion ?? readBundledNuwaxcodeVersion(),
  });
}
