import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Tree-shakability is a property of the source that nothing else notices when it breaks.
 *
 * Every rule is declared as a top-level call — `export const IsString = rule(...)` — and rollup
 * can prove such a call pure by reading the factory, but esbuild and webpack will not. Without
 * the `/*#__PURE__*\/` annotations on those declarations, importing one decorator dragged in the
 * message and validator of all 68: 4909 bytes rather than 1837 through esbuild, 4823 rather
 * than 1818 through webpack. Nothing failed. The library simply got three times heavier in
 * every consumer's bundle, and the only way to notice was to go and measure.
 *
 * So these assertions are mostly about *content* rather than bytes: a byte ceiling tells you
 * something drifted, but naming the thing that should not be there says what.
 */

/** Markers that identify a chunk of the library in minified output. */
const MARKER = {
  isString: 'must be a string',
  minLength: 'must be longer than or equal to',
  isLatitude: 'must be a latitude',
  isSemVer: 'must be a valid semantic version',
  arraySize: 'must contain at least',
  serializer: 'Circular reference',
  representable: 'cannot be serialized to JSON',
  deserializer: 'Unknown property',
  validator: '[redacted]',
  naming: 'SCREAMING_SNAKE_CASE',
} as const;

const ENTRY = path.resolve('src/index.js').replace(/\.js$/, '.js');

async function bundle(source: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cereale-shake-'));
  try {
    const entry = path.join(dir, 'entry.ts');
    await writeFile(entry, source.replace('CEREALE', JSON.stringify(ENTRY)));
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      minify: true,
      target: 'es2022',
      write: false,
      tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
    });
    return result.outputFiles[0]!.text;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Asserts what a bundle kept and what it dropped.
 *
 * `keeps` is not decoration. A bundle that failed to build, or that resolved the library as an
 * external and inlined none of it, contains none of the markers — so an "everything was shaken"
 * result and a broken harness look identical without it.
 */
function expectShaken(code: string, keeps: string[], drops: string[]) {
  expect(code.length, 'the bundle is empty — the harness is broken, not the tree-shaking').toBeGreaterThan(200);
  for (const marker of keeps) {
    expect(code, `expected the bundle to contain ${JSON.stringify(marker)}`).toContain(marker);
  }
  for (const marker of drops) {
    expect(code, `${JSON.stringify(marker)} should have been shaken out`).not.toContain(marker);
  }
}

describe('tree-shaking', () => {
  it('drops the 67 rules you did not import', async () => {
    const code = await bundle(`
      import { IsString } from CEREALE;
      export const d = IsString();
    `);

    expectShaken(code, [MARKER.isString], [
      MARKER.isLatitude, MARKER.isSemVer, MARKER.arraySize, MARKER.minLength,
      MARKER.serializer, MARKER.deserializer, MARKER.naming,
    ]);
    // Generous ceiling: the measured figure is ~1.8 KB, and this is here to catch a regression
    // of the kind above (which trebled it), not to police every byte.
    expect(code.length).toBeLessThan(3000);
  });

  it('keeps the deserializer and drops the serializer when only reading', async () => {
    const code = await bundle(`
      import { toInstanceSync } from CEREALE;
      export const f = (C, p) => toInstanceSync(C, p, { validate: false });
    `);

    // Validation is kept on purpose: `validate` defaults to true, so the entry point
    // references it whatever the call site passes.
    expectShaken(code, [MARKER.deserializer, MARKER.validator], [MARKER.serializer, MARKER.representable]);
  });

  it('keeps the serializer and drops the deserializer when only writing', async () => {
    const code = await bundle(`
      import { toPlainSync } from CEREALE;
      export const f = (o) => toPlainSync(o, { validate: false });
    `);

    expectShaken(code, [MARKER.serializer, MARKER.representable, MARKER.validator], [MARKER.deserializer]);
  });

  it('drops both engines when only validating', async () => {
    const code = await bundle(`
      import { validateSync } from CEREALE;
      export const f = (o) => validateSync(o);
    `);

    expectShaken(code, [MARKER.validator], [MARKER.serializer, MARKER.deserializer, MARKER.isString]);
  });

  it('costs almost nothing to import only an error helper', async () => {
    const code = await bundle(`
      import { flattenErrors } from CEREALE;
      export const f = (e) => flattenErrors(e);
    `);

    expectShaken(code, [], [MARKER.serializer, MARKER.deserializer, MARKER.validator, MARKER.isString]);
    expect(code.length).toBeLessThan(1500);
  });

  it('still contains everything when everything is used', async () => {
    const code = await bundle(`
      import * as cereale from CEREALE;
      export default cereale;
    `);

    // The counterweight to every assertion above: proves the markers are findable at all, so a
    // "shaken" result upstream means shaken rather than misspelled.
    expectShaken(code, Object.values(MARKER), []);
  });

  /**
   * The cases above bundle `src/`, which is where the annotations are written — so they cannot
   * see what happens to them on the way into `dist/`. That is exactly where this broke: the
   * flat bundle behind `cereale/min` was built with esbuild's `minify: true`, whose
   * `minifyWhitespace` pass strips comments, annotations included. The published entry point
   * kept all 26 unrelated rules (5,066 bytes against 1,837) while every source-level check
   * stayed green.
   */
  describe('the published artifacts', () => {
    const dist = path.resolve('dist');
    const built = existsSync(path.join(dist, 'cereale.min.js'));

    it.runIf(built)('cereale/min tree-shakes as well as the per-module entry', async () => {
      const code = await bundle(`
        import { IsString } from ${JSON.stringify(path.join(dist, 'cereale.min.js'))};
        export const d = IsString();
      `.replace('CEREALE', 'unused'));

      expectShaken(code, [MARKER.isString], [MARKER.isLatitude, MARKER.isSemVer, MARKER.serializer]);
      expect(code.length).toBeLessThan(3000);
    });

    it.runIf(built)('keeps its purity annotations through minification', async () => {
      const flat = readFileSync(path.join(dist, 'cereale.min.js'), 'utf8');
      const perModule = readFileSync(path.join(dist, 'esm/decorators.js'), 'utf8');
      const count = (s: string) => (s.match(/__PURE__/g) ?? []).length;

      expect(count(perModule), 'src annotations should reach dist/esm').toBeGreaterThan(20);
      expect(count(flat), 'minification stripped the annotations from the flat bundle')
        .toBeGreaterThanOrEqual(count(perModule));
    });
  });
});
