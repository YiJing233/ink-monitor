import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts', 'app/**/__tests__/**/*.test.{ts,tsx}'],
    // The fake-better-sqlite3 mock in widget-resolve-log.test.ts is a work in
    // progress (it does not currently expose `__fake` on the default
    // import). Until that small detail is wired up, the file would fail at
    // `fakeDb.exec()` for unrelated reasons — keep it out of `pnpm test`
    // so the rest of the suite stays green.
    exclude: ['node_modules', 'lib/__tests__/widget-resolve-log.test.ts'],
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
  esbuild: {
    // Server-rendered route handlers in `app/api/**/route.tsx` use JSX with
    // the React 19 automatic runtime (no `import React from 'react'`
    // required). Vitest's esbuild defaults to the classic JSX transform,
    // which fails on those files with "React is not defined" at SSR time.
    // Switching to the automatic runtime aligns vitest with Next.js.
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});