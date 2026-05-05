import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Separate config for Vitest. Keeping this outside `vite.config.ts` avoids a
// duplicate `vite` type-graph under `exactOptionalPropertyTypes: true` (vitest
// bundles its own `vite` types; mixing the two in one file breaks the plugin
// signatures). Vitest auto-loads this file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: {
      // Mirror SvelteKit's `$lib` alias so test modules can import via the
      // same path as production code. SvelteKit's vite plugin sets this up
      // for the dev/build server but not for vitest.
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
});
