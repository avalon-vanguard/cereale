# Repo rules

Shared by every avalon-vanguard repo. This file is synced from `avalon-vanguard/ci`
(`templates/all/`): change it there, a local edit fails the `rules` check.
Repo-specific facts (stack, commands, lessons) live in `CLAUDE.md`.

## Git flow

- `develop` is the default branch (integration). `main` is production; merging into it deploys.
- Work on short-lived branches named `type/subject`, English kebab-case subject:
  `feat/sticky-bar`, `fix/openship-403`. Types are the commit types below.
- Feature PRs target `develop` and are squash-merged. Until a repo has a `develop` branch, PRs
  target its default branch; do not create `develop` yourself.
- Release: a PR `develop` -> `main`, titled `🔖 chore(release): ...`, merged with a merge commit.
- Hotfix: `fix/*` branched from `main`, PR into `main` titled `🚑️ fix...`, then merge `main`
  back into `develop`.

## Commits and PR titles

Gitmoji + conventional commits, in English: `✨ feat(scope): add sticky bar`.
Scope is optional, `!` before `:` marks a breaking change. Use the emoji character, not
`:shortcode:`. The PR title becomes the squashed commit on `develop`, and CI checks it.

<!-- prettier-ignore -->
| Type | Emojis |
|---|---|
| feat | ✨ 💄 🎉 📈 💥 🍱 ♿️ 💬 🗃️ 🔊 🚸 📱 🥚 ⚗️ 🔍️ 🌱 🚩 💫 🛂 👔 🩺 🧵 🦺 ✈️ |
| fix | 🐛 🚑️ 💄 🔒️ 🚨 💚 ✏️ 👽️ 💥 ♿️ 💬 🗃️ 🚸 📱 🔍️ 🏷️ 🥅 🛂 🩹 👔 🩺 🧵 🦺 ✈️ |
| docs | 📝 ✏️ 📄 💡 👥 |
| style | 🎨 💄 🚨 💫 |
| refactor | 🎨 ♻️ 🔥 👽️ 🚚 💥 🗃️ 🔇 🏗️ 🏷️ 🗑️ ⚰️ |
| perf | ⚡️ 🧵 |
| test | ✅ 🤡 📸 🧪 |
| build | 📦️ ⬇️ ⬆️ 📌 ➕ ➖ 🧱 |
| ci | 👷 🚀 💚 🧱 |
| chore | 🔧 🔖 🔥 🚀 🎉 🔐 ⬇️ ⬆️ 📌 ➕ ➖ 🔨 📄 🍱 🔊 🔇 👥 🙈 ⚗️ 🌱 🚩 🗑️ 🧐 🧱 🧑‍💻 💸 |
| revert | ⏪️ |
| i18n | 🌐 |

🔖 is only for `chore(release)` (PRs `develop` -> `main`), and `chore(release)` must use 🔖.
A PR into `main` from `fix/*` must be titled `🚑️ fix...` (hotfix).
Not accepted: 🚧, 💩, 🍻, 🔀.

## Language

English for everything: code, comments, docs, commits, PR titles and bodies, branch names.
User-facing UI: English source strings with a French translation (i18n).

## Before pushing

Be green before pushing: run the repo's lint, typecheck, test and build. See `CLAUDE.md` for
the exact commands.

`lefthook.yml` runs gitleaks on commit, and osv-scanner, jscpd (both as in CI) and an advisory knip on push;
install the tools with `scripts/install_dev_hooks.sh` from `avalon-vanguard/ci`. A missing tool only
warns. Skip the hooks once with `LEFTHOOK=0 git push`; CI still blocks.

## Coding principles

- Simplest thing that works. No speculative code, option or abstraction; add it when a second
  real use appears. No new dependency for what the stdlib or a few lines do.
- SOLID, applied pragmatically:
  - S: one reason to change per class/module/function; split when a unit mixes concerns
    (I/O + logic + presentation).
  - O: extend by adding code only where a second variant exists; don't pre-build extension points.
  - L: a subtype honours its base contract (no throwing "not supported" overrides).
  - I: small, focused interfaces/types; no client depends on members it doesn't use.
  - D: depend on abstractions **through injection** (Angular DI, constructor parameters,
    `TimeProvider`, a function parameter). Introduce an interface when there are two
    implementations or a test double is needed, never one interface per class.
- OOP: encapsulate state (private by default, expose behaviour, not fields); composition over
  inheritance; inheritance only for a true "is-a" with a shared contract, max one level deep in
  app code; immutable values where possible.
- Separate pure logic from I/O and UI so it can be unit-tested without mocks.
- Names say what things do; comments explain why, never what. No dead code, no commented-out
  code, no TODO without a linked issue.
- Errors: fail loudly at the boundary that can act on them; never swallow an exception; no
  catch-all that hides the cause.

## Testing

- TDD: write the failing test first, then the code. Every bug fix starts with a test that
  reproduces it.
- Unit tests for logic (fast, no network, no real clock). End-to-end tests for user flows, on the
  production build: a served page proves nothing; a click must produce its effect and a write
  must go through the UI.
- Test database rules in the database (pgTAP for Supabase/Postgres), with seed rows so that
  "0 rows visible" cannot pass by accident.
- No skipped tests in CI; a test that cannot run there is deleted or fixed.
- Line coverage >= 80 % per repo, enforced by CI. Coverage is a floor, not a goal: a test asserts
  behaviour, never just executes lines.

## Security

- Access control lives where it cannot be bypassed: in the database (RLS, `security definer`
  functions with `set search_path = ''`, private buckets). Route guards and UI checks are
  ergonomics only.
- Secrets only from Dopbase; never in code, committed `.env`, logs, URLs or command arguments.
  One least-privilege token per use.
- Validate all external input (HTTP, forms, files, env, other services) where it enters. Never
  build SQL, shell commands or HTML from strings; use parameters and the framework's escaping.
- `quality.yml` (gitleaks, semgrep, osv-scanner, jscpd) runs on every PR and blocks.

## Performance

- Angular apps declare bundle budgets in `angular.json` that fail the build.
- Heavy libraries (three.js, editors, charts...) live in one folder, are loaded with `@defer` or a
  lazy route, and nothing else imports them.
- Bound queries (pagination or `limit`) and index them for their filters; no query inside a loop
  (N+1).
- Lighthouse runs in CI on every web app and blocks under its thresholds (default 0.9 for
  performance, accessibility and best-practices).

## Review & merge

- A PR merges only when every required check is green: `rules`, the stack check (lint, format,
  types, tests + coverage, build), `quality`, `lighthouse` (web apps).
- These gates (`quality`, coverage, `lighthouse`) are switched on per repo in its alignment PR
  (see `avalon-vanguard/ci` `docs/rollout.md`); until then, run the same checks locally before
  pushing.
- Every repo must have CI callers for `rules`, `quality`, Junie review and its stack check (node,
  python, dotnet, go; Angular, Supabase and `none` add nothing, and a `none` repo with something
  to execute names that workflow as `test_workflow` in `repos.json`). A repo can add on top, never
  narrow: each caller runs on every PR, with no `paths` or `branches` filter and no `if`, `needs`
  or `continue-on-error`. Stack CI runs tests only where they exist, so Node needs a `test` script
  in the root `package.json` and Python a `tests/` directory.
- The `rules` check shows these workflows exist and run on every PR, not what they test
  (`echo ok` passes) nor their `with:` inputs. A workflow Gitea refuses to run, or one disabled in
  the UI, is not seen: required status checks cover that. YAML written to confuse the reader is
  rejected or out of its reach.
- The Junie review caller is required, but its verdict is advisory and must be answered: fix, or
  reply why not.
- A PR does one thing; refactors go in their own PR.

## Synced files

`AGENTS.md`, `.editorconfig` and `.gitattributes` (above the `# --- local (not synced) ---`
line), `.gitea/pull_request_template.md`, `.gitea/workflows/rules.yml`,
`.gitea/workflows/junie-review.yml`, `.gitea/workflows/claude-issues.yml`, `lefthook.yml`,
`.gitea/osv-org.toml`, `.agents/` (per-stack rules) and `ruff.toml` (Python repos) come from
`avalon-vanguard/ci`. Change them there, never in this repo. Repo-specific hooks go in
`lefthook-local.yml`, which is committed here, contrary to lefthook's usual gitignore convention.

Stack rules: see `.agents/`.
