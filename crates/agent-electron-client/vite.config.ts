import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    // 主进程 tsc 也输出到 dist/（dist/main/, dist/services/ 等），
    // 关闭 emptyOutDir 避免 vite build 清除主进程产物。
    // TODO: 后续可将 tsc outDir 改为 dist-main/ 以彻底隔离，届时可恢复 emptyOutDir: true
    emptyOutDir: false,
  },
  server: {
    port: 60173,
    strictPort: true,
  },
});
