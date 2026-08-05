import { defineConfig } from 'vitest/config';
import { transform } from 'esbuild';

/**
 * Transpiles test sources with esbuild instead of oxc.
 *
 * Vitest 4 transforms with oxc, which does not yet implement the TC39 standard decorator
 * transform — it leaves the syntax in place and Node then fails to parse it, reporting
 * "0 test" rather than an error. esbuild and tsc both implement it, so the library's own
 * build (`tsc`) and consumers bundling with esbuild or Vite are unaffected; only the test
 * runner needs this. Remove it once oxc gains standard-decorator support.
 */
function standardDecorators() {
  return {
    name: 'cereale:standard-decorators',
    enforce: 'pre' as const,
    async transform(code: string, id: string) {
      if (!/\.ts$/.test(id) || id.includes('node_modules')) return null;
      const result = await transform(code, {
        loader: 'ts',
        target: 'es2022',
        sourcefile: id,
        sourcemap: true,
        // Standard semantics, not the legacy ones: the library reads context.metadata.
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
      });
      return { code: result.code, map: result.map };
    },
  };
}

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
