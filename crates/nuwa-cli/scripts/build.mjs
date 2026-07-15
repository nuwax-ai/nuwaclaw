/**
 * esbuild build script — bundles nuwa-cli CLI into a single ESM entry.
 *
 * Runtime dependencies that the CLI imports directly are inlined; adapter
 * packages resolved through require.resolve stay as normal npm/pnpm
 * dependencies. No postinstall downloads are added here; lanproxy remains the
 * only preintegrated-resource exception outside package dependencies.
 */

import * as esbuild from "esbuild";
import { cp, readFile, rm } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8"),
);
const distDir = new URL("../dist", import.meta.url);
const lanproxySource = new URL(
  "../resources/lanproxy",
  import.meta.url,
);
const lanproxyTarget = new URL("../dist/resources/lanproxy", import.meta.url);

await rm(distDir, { recursive: true, force: true });
await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  minify: false,
  legalComments: "none",
  define: {
    __NUWACLI_VERSION__: JSON.stringify(pkg.version),
  },
  // node-machine-id does a runtime `require("child_process")` inside its own
  // CJS module body to shell out to platform-specific commands; esbuild's
  // CJS-in-ESM interop shim can't resolve that dynamically at bundle time
  // ("Dynamic require of child_process is not supported"). Leave it external
  // so Node's real module loader resolves it at runtime instead.
  external: ["node-machine-id"],
});

await cp(lanproxySource, lanproxyTarget, {
  recursive: true,
  preserveTimestamps: true,
});
