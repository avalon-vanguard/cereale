/**
 * Fails if docs/ differs from what `npm run build:docs` just produced — including NEW
 * files. That last part is the reason this exists: `git diff --exit-code -- docs/` only
 * reports modifications to tracked files, so a build-script change whose only effect is
 * an additional output (a sourcemap, a second vendor asset) passed the old gate silently
 * and would have been deployed without ever being committed or reviewed.
 *
 * Run after build:docs (the check:docs-sync npm script chains them). Shared by ci.yml
 * and pages.yml so the two workflows cannot drift into enforcing different notions of
 * "in sync" — they already had, before this was extracted.
 */
import { execFileSync } from 'node:child_process';

const out = execFileSync('git', ['status', '--porcelain', '--', 'docs/'], { encoding: 'utf8' }).trim();

if (out) {
  console.error(out);
  console.error("docs/ is stale — run 'npm run build:docs' and commit the result");
  process.exit(1);
}
console.log('docs/ matches src/ — nothing modified, nothing untracked.');
