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
  // shims: false —— createRequire 用 typeof __filename 检测双兼容(CJS native
  // __filename / ESM import.meta.url / esbuild bundle __filename),不需要 tsup shim。
  // shims:true 会在 ESM 输出注入 getFilename=fileURLToPath(import.meta.url),被
  // esbuild 打进 CJS bundle 时 import.meta.url=undefined → fileURLToPath(undefined) 崩溃。
  shims: false,
});
