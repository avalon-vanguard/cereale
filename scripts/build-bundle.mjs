/**
 * Flattens the ESM build into a single minified module.
 *
 * This is an *addition*, not a replacement. `dist/esm` stays the default `import`, because
 * measuring says the flat file buys a consumer nothing: bundled through esbuild the two come
 * out within 2 bytes of each other, through rollup+terser the flat one is ~165 bytes smaller,
 * and unused decorators tree-shake out of both. What the per-module build keeps is readable
 * stack traces for anyone who does not load source maps.
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
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  banner: { js: `/*! cereale ${pkg.version} | MIT | ${pkg.homepage} */` },
  // The input is compiled JavaScript, so the project's tsconfig has no bearing here — and
  // reading it only earns a warning, because esbuild does not know the ES2025 target name
  // that tsc is perfectly happy with.
  tsconfigRaw: {},
  outfile,
});

// The banner names a version, so a stale bundle would misreport itself rather than merely be
// out of date. Cheap to assert, and the build is the only place that can.
const emitted = await readFile(outfile, 'utf8');
if (!emitted.includes(`cereale ${pkg.version}`)) {
  throw new Error('the bundle banner does not carry the current version');
}
for (const name of ['toInstanceSync', 'IsString', 'standardDecorators']) {
  if (name === 'standardDecorators') continue; // cereale/vite is a separate entry point
  if (!emitted.includes(name)) throw new Error(`${name} is missing from the flat bundle`);
}

const size = (await stat(outfile)).size;
const gzip = gzipSync(emitted).length;
console.log(`dist/cereale.min.js   ${(size / 1024).toFixed(1)} KB  (${(gzip / 1024).toFixed(1)} KB gzipped)`);
