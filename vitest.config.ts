import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts', 'app/**/__tests__/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    // Stub `server-only` so modules that import it can be unit-tested under
    // Node. Next.js's bundler swaps it for an empty module in production.
    alias: {
      'server-only': resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'server-only': resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
});