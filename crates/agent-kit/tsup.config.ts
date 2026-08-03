import { defineConfig } from "tsup";

// Dual-format build: ESM (dist/index.js) + CJS (dist/index.cjs) + types
// (dist/index.d.ts). The package sets "type": "module", so the CJS output uses
// the .cjs extension to avoid being parsed as ESM.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node18",
  // Provide import.meta.url (and __dirname/__filename) shims for the CJS build
  // so createRequire(import.meta.url) works there too — the ESM build has them
  // natively. Avoids a runtime `typeof require` branch (unreliable on Node 22+).
  shims: true,
});
