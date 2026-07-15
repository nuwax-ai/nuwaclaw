declare const __NUWA_CLI_VERSION__: string | undefined;

export const PACKAGE_NAME = "@nuwax-ai/nuwa-cli";

export const CLI_VERSION =
  typeof __NUWA_CLI_VERSION__ === "string" && __NUWA_CLI_VERSION__
    ? __NUWA_CLI_VERSION__
    : "0.0.0-dev";
