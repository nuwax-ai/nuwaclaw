declare const __NUWACLAW_VERSION__: string | undefined;

export const PACKAGE_NAME = "nuwaclaw";

export const CLI_VERSION =
  typeof __NUWACLAW_VERSION__ === "string" && __NUWACLAW_VERSION__
    ? __NUWACLAW_VERSION__
    : "0.0.0-dev";
