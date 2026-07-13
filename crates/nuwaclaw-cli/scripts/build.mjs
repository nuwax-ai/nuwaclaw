/**
 * esbuild build script — bundles nuwaclaw CLI into a single ESM entry.
 *
 * Runtime dependencies are inlined; the published package ships only
 * dist/cli.js plus its shebang. No native deps, no postinstall downloads —
 * anything heavy (adapter runtimes, codex-acp binary) is fetched lazily at
 * runtime into ~/.nuwaclaw-cli, not bundled here.
 */

import * as esbuild from "esbuild";

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
  // node-machine-id does a runtime `require("child_process")` inside its own
  // CJS module body to shell out to platform-specific commands; esbuild's
  // CJS-in-ESM interop shim can't resolve that dynamically at bundle time
  // ("Dynamic require of child_process is not supported"). Leave it external
  // so Node's real module loader resolves it at runtime instead.
  external: ["node-machine-id"],
});
