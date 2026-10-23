import { defineConfig } from 'vitest/config';
import { standardDecorators } from './src/vite.js';

/**
 * The library's own tests run through the plugin the library ships, so that `cereale/vite`
 * is exercised by every test run rather than only by the one test that asserts it exists.
 */
export default defineConfig({
  plugins: [standardDecorators()],
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/example.ts', 'src/index.ts'],
      // Mesuré : 96,69 / 91,62 / 99,64 / 97,95 — seuil = plancher − 1.
      thresholds: { statements: 95, branches: 90, functions: 98, lines: 96 },
    },
  },
});
