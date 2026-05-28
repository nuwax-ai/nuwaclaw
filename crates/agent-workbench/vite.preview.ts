/**
 * Vite config for the Markdown rendering preview page.
 *
 * Usage:
 *   cd crates/agent-workbench
 *   npx vite --config vite.preview.ts
 *
 * This is a separate config from vite.config.ts (which builds the library).
 * This one runs a dev server in app mode with HMR.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'preview'),
  resolve: {
    alias: {
      // Ensure preview imports resolve relative to the package root.
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5180,
    open: true,
  },
  // Optimize deps for faster cold start.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'rehype-katex',
      'rehype-raw',
      'prism-react-renderer',
    ],
  },
});
