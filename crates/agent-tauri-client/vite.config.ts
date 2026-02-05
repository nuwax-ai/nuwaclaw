import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 构建环境: 'test' | 'prod' | 'local' (默认 'test' 用于开发)
// @ts-expect-error process is a nodejs global
const buildEnv = process.env.VITE_BUILD_ENV || "test";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // 定义全局环境变量
  define: {
    __BUILD_ENV__: JSON.stringify(buildEnv),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
