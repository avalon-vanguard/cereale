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
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/example.ts', 'src/index.ts'],
    },
  },
});
