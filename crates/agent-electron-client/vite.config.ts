import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  root: './src/renderer',
  publicDir: '../../public',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@preload': path.resolve(__dirname, './src/preload'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    outDir: '../../dist',
    // 主进程 tsc 也输出到 dist/（dist/main/, dist/services/ 等），
    // 关闭 emptyOutDir 避免 vite build 清除主进程产物。
    // TODO: 后续可将 tsc outDir 改为 dist-main/ 以彻底隔离，届时可恢复 emptyOutDir: true
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // 优化代码分割，将第三方库分离
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-antd': ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  server: {
    port: 60173,
    strictPort: true,
  },
});
