/**
 * Guards the two properties the landing page silently lost before.
 *
 * 1. It must load nothing from the network. The previous page pulled Tailwind, CodeMirror and
 *    Babel from three CDNs, and its playground died without a sound the day the unpinned
 *    `@babel/standalone` URL started serving Babel 8, whose plugin list no longer had the
 *    plugin the page asked for. Nobody noticed, because nothing on the page said so.
 * 2. The bundle the playground runs must match the library source. It is built from `src/`,
 *    so a change there leaves the page demonstrating a version that no longer exists.
 *
 * Ordinary <a href> links out are fine — a link is not a subresource.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docs = path.join(root, 'docs');

const failures = [];

/** Subresource references — the things a browser fetches without being clicked. */
const SUBRESOURCES = [
  [/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, 'script src'],
  [/<(?:img|iframe|video|audio|source|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, 'media src'],
  [/@import\s+(?:url\()?["']([^"']+)["']/gi, 'css @import'],
  [/url\(\s*["']?(https?:\/\/[^)"']+)/gi, 'css url()'],
];

/**
 * `<link>` relations the browser actually fetches or connects to.
 *
 * Checked against `rel` rather than flagging every `<link href>`, because the metadata
 * relations — `canonical` above all — are declarations about the document, not requests. A
 * check that cannot tell the difference gets switched off the first time it is wrong.
 */
const FETCHING_REL = new Set([
  'stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed',
  'manifest', 'preload', 'modulepreload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch',
]);

const isRemote = (url) => /^(?:https?:)?\/\//i.test(url);

const html = (await readdir(docs)).filter((name) => name.endsWith('.html'));
if (html.length === 0) failures.push('docs/ contains no HTML page');

for (const name of html) {
  const source = await readFile(path.join(docs, name), 'utf8');
  for (const [pattern, kind] of SUBRESOURCES) {
    for (const match of source.matchAll(pattern)) {
      if (isRemote(match[1])) failures.push(`docs/${name}: remote ${kind} — ${match[1]}`);
    }
  }

  for (const match of source.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '').trim().toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && isRemote(href) && FETCHING_REL.has(rel)) {
      failures.push(`docs/${name}: remote link rel="${rel}" — ${href}`);
    }
  }
  // A fetch to a CDN would not be caught by the markup scan.
  for (const match of source.matchAll(/\b(?:fetch|importScripts)\(\s*["'`](https?:\/\/[^"'`]+)/gi)) {
    failures.push(`docs/${name}: remote fetch — ${match[1]}`);
  }
}

for (const name of (await readdir(docs)).filter((f) => f.endsWith('.js'))) {
  const source = await readFile(path.join(docs, name), 'utf8');
  for (const match of source.matchAll(/\.src\s*=\s*["'`](https?:\/\/[^"'`]+)/gi)) {
    failures.push(`docs/${name}: loads a remote script — ${match[1]}`);
  }
  for (const match of source.matchAll(/\bfetch\(\s*["'`](https?:\/\/[^"'`]+)/gi)) {
    failures.push(`docs/${name}: remote fetch — ${match[1]}`);
  }
}

// The playground compiles against whatever is in the bundle, so a stale bundle means the
// page demonstrates a library that no longer exists.
const bundle = await readFile(path.join(docs, 'cereale.js'), 'utf8').catch(() => null);
if (bundle === null) {
  failures.push('docs/cereale.js is missing — run `npm run build:docs`');
} else {
  // Spot-check that the exports the page relies on actually made it into the bundle.
  for (const name of ['toInstanceSync', 'toPlainSync', 'flattenErrors', 'JsonMappingError', 'IsString']) {
    if (!bundle.includes(name)) failures.push(`docs/cereale.js does not export ${name} — rebuild it`);
  }
}

const babel = path.join(docs, 'vendor/babel.min.js');
await readFile(babel).catch(() => failures.push('docs/vendor/babel.min.js is missing — run `npm run build:docs`'));

if (failures.length > 0) {
  console.error('docs check failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`docs check passed — ${html.length} page(s), no network dependencies.`);
