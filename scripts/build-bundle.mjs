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
  // NOT `minify: true`. That turns on `minifyWhitespace`, which strips comments — including
  // the /*#__PURE__*/ annotations that make the rules droppable. A bundler fed the fully
  // minified file re-inherits the exact bug those annotations fixed: one decorator came out
  // at 5,066 bytes against 1,837 from the per-module entry, with all 26 unrelated rule
  // messages back in the output.
  //
  // Syntax and identifier minification keep them. The cost is 34.6 KB raw against 26.0 KB,
  // but 9.8 KB gzipped against 8.7 KB — about a kilobyte over the wire, which is a fair price
  // for a file that behaves correctly however someone ends up using it.
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

// The banner names a version, so a stale bundle would misreport itself rather than merely be
// out of date. Cheap to assert, and the build is the only place that can.
const emitted = await readFile(outfile, 'utf8');
if (!emitted.includes(`cereale ${pkg.version}`)) {
  throw new Error('the bundle banner does not carry the current version');
}
for (const name of ['toInstanceSync', 'IsString']) {
  if (!emitted.includes(name)) throw new Error(`${name} is missing from the flat bundle`);
}

// The whole reason this file is not fully minified. Asserting it here means a future change to
// the minify options fails the build rather than silently tripling what a bundler keeps.
const annotations = (emitted.match(/__PURE__/g) ?? []).length;
const expected = (await readFile(path.join(dist, 'esm/decorators.js'), 'utf8').then(
  (s) => (s.match(/__PURE__/g) ?? []).length
));
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
