declare const __NUWACLI_VERSION__: string | undefined;

export const PACKAGE_NAME = "@nuwax-ai/nuwa-cli";

export const CLI_VERSION =
  typeof __NUWACLI_VERSION__ === "string" && __NUWACLI_VERSION__
    ? __NUWACLI_VERSION__
    : "0.0.0-dev";
