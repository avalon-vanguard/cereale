import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transpiles with oxc, which does not read `experimentalDecorators`
  // out of tsconfig.json for files the tsconfig does not `include`. Without this
  // the decorator syntax in the test files fails to parse and every suite is
  // silently reported as "0 test".
  oxc: {
    decorator: { legacy: true },
  },
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
