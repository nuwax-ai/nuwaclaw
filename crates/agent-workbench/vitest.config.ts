import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The Vite plugin types diverge from vitest's bundled Vite types because the
  // monorepo resolves @vitejs/plugin-react against a different Vite version.
  // The runtime contract is identical, so we cast at the boundary.
  plugins: [react()] as never,
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
