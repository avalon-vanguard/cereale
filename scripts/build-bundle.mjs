/**
 * Flattens the ESM build into a single minified module.
 *
 * This is an *addition*, not a replacement. `dist/esm` stays the default `import`: it keeps
 * readable stack traces for anyone who does not load source maps, and it is what a bundler
 * should be handed.
 *
 * Where the single file does earn its place is everywhere a bundler is not involved: a
 * `<script type="module">` tag, a CDN, an import map, Deno, or a Worker. That is what
 * `cereale/min` is for.
 *
 * It is built from `dist/esm/index.js` rather than from `src/`, so the decorator lowering and
 * the ES2025 target are whatever `tsc` produced — esbuild is only flattening and minifying.
 * (esbuild has no `es2025` target name; `esnext` means "downlevel nothing", which is what we
 * want when the input is already at the target.)
 */
import { build } from 'esbuild';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const outfile = path.join(dist, 'cereale.min.js');

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [path.join(dist, 'esm/index.js')],
  bundle: true,
  format: 'esm',
  target: 'esnext',
  // NOT `minify: true`: `minifyWhitespace` strips comments, /*#__PURE__*/ included, and a
  // bundler fed the result keeps every unused rule — 5,066 bytes for one decorator against
  // 1,837. Asserted below. Costs about a kilobyte gzipped.
  minifySyntax: true,
  minifyIdentifiers: true,
  sourcemap: true,
  legalComments: 'none',
  banner: { js: `/*! cereale ${pkg.version} | MIT | ${pkg.homepage} */` },
  // The input is compiled JavaScript, so the project's tsconfig has no bearing here — and
  // reading it only earns a warning, because esbuild does not know the ES2025 target name
  // that tsc is perfectly happy with.
  tsconfigRaw: {},
  outfile,
});

// The whole reason this file is not fully minified. Asserting it here means a future change to
// the minify options fails the build rather than silently tripling what a bundler keeps.
//
// The floor on `expected` is not decoration: comparing the two counts alone passes vacuously if
// tsc ever stops emitting the annotations, since 0 >= 0. It has to be wrong in both directions.
const count = (s) => (s.match(/__PURE__/g) ?? []).length;
const emitted = await readFile(outfile, 'utf8');
const annotations = count(emitted);
const expected = count(await readFile(path.join(dist, 'esm/decorators.js'), 'utf8'));
if (expected < 30) {
  throw new Error(
    `dist/esm/decorators.js carries only ${expected} /*#__PURE__*/ annotations; src/decorators.ts ` +
    'writes 30. The compiler is dropping them, so every consumer keeps all 68 rules.'
  );
}
if (annotations < expected) {
  throw new Error(
    `the flat bundle kept ${annotations} /*#__PURE__*/ annotations but dist/esm/decorators.js has ` +
    `${expected}. Minification stripped them, so anything bundling cereale/min would keep every ` +
    'unused rule. Do not turn on minifyWhitespace here.'
  );
}

// dist/cjs/package.json is the nearest descriptor for every module beneath it, so bundlers
// read `sideEffects` from there rather than from the root manifest. Declaring it only at the
// root leaves the whole CommonJS build undeclared.
await writeFile(
  path.join(dist, 'cjs/package.json'),
  JSON.stringify({ type: 'commonjs', sideEffects: ['./metadata.js'] }, null, 2) + '\n'
);

const size = (await stat(outfile)).size;
const gzip = gzipSync(emitted).length;
console.log(`dist/cereale.min.js   ${(size / 1024).toFixed(1)} KB  (${(gzip / 1024).toFixed(1)} KB gzipped)`);
