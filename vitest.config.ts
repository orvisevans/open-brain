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
});
