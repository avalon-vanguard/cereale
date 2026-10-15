/**
 * Fails if a published entry point does not load from dist/: `.` and `./vite`, each as ESM
 * and as CommonJS, and the flat `./min` bundle. Run after `npm run build` (first step of
 * `npm run check`). Moved here from inline `node -e` lines in the CI workflow.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assert = (ok, what) => {
  if (!ok) throw new Error(`${what} broken`);
};

assert(typeof (await import('../dist/esm/index.js')).toInstance === 'function', 'ESM entry point');
assert(typeof require('../dist/cjs/index.js').toInstance === 'function', 'CJS entry point');
assert((await import('../dist/esm/vite.js')).standardDecorators().enforce === 'pre', 'ESM cereale/vite');
assert(require('../dist/cjs/vite.js').standardDecorators().enforce === 'pre', 'CJS cereale/vite');
assert(typeof (await import('../dist/cereale.min.js')).toInstanceSync === 'function', 'flat bundle');
