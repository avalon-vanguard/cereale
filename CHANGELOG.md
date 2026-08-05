# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-05

### `cereale/min` — one file, no bundler

The whole library flattened into a single minified ES module: **25.5 KB, 8.6 KB gzipped**, for
import maps, `<script type="module">`, Deno and Workers. It is built from `dist/esm/index.js`,
so the decorator lowering and the ES2025 target are whatever `tsc` produced — esbuild only
flattens and minifies.

It is an addition, not a replacement, and the measurement is why. Bundled through esbuild the
flat and per-module builds produce consumer bundles within **2 bytes** of each other; through
rollup + terser the flat one is 165 bytes smaller; unused decorators tree-shake out of both.
Since the size argument is a wash, the per-module build stays the default `import` for the one
thing it does better — readable stack traces for anyone not loading source maps.

### Tree-shaking

Importing one decorator pulled in the message and validator of all 68. **4,909 bytes instead of
1,837** through esbuild, 4,823 instead of 1,818 through webpack. Nothing failed and nothing
warned; the library was simply about three times heavier than it needed to be in every
consumer's bundle.

The cause is that every rule is a top-level call — `export const IsString = rule(…)`. rollup
proves such a call side-effect-free by reading the factory, which is why rollup was already
producing 1,823 bytes and hid the problem from a single-bundler measurement. esbuild and
webpack will not do that analysis, and keep the call. Thirty declarations now carry
`/*#__PURE__*/`, and all three bundlers land within 20 bytes of each other.

Measured, minified, across esbuild / rollup / webpack:

| What you import | esbuild | rollup | webpack |
| --- | ---: | ---: | ---: |
| `flattenErrors` | 287 | 292 | 291 |
| one decorator | 1,837 | 1,823 | 1,818 |
| `validateSync` | 3,722 | 3,554 | 3,823 |
| `toPlainSync` | 7,744 | 7,769 | 7,832 |
| `toInstanceSync` | 7,900 | 7,942 | 7,956 |
| a typical DTO | 10,395 | 10,402 | 10,372 |
| everything | 26,266 | 25,671 | 26,879 |

The serializer and deserializer drop independently. The validator is kept by both mapping
entry points because `validate` defaults to `true`, which is a real reference rather than a
missed optimisation.

`src/treeshake.test.ts` pins it. The assertions are mostly about content rather than bytes — it
names the rules that must not appear — and one case asserts that everything IS present when
everything is used, so a "shaken" result cannot come from a bundle that failed to build. Strip
the annotations and it fails with `"must be a latitude" should have been shaken out`.

### Frameworks

[FRAMEWORKS.md](FRAMEWORKS.md) — a setup recipe for each, every one run before it was written,
with the versions and date it was verified against.

The finding worth stating first: **Angular works**. The CLI scaffolds
`"experimentalDecorators": true`, but Angular does not need it — `ngtsc` erases `@Component`
and `@Injectable` into static properties rather than relying on TypeScript's decorator emit.
Flip the flag and both systems work in one program. Verified with `ngc` on Angular 21.2 with
`strictTemplates`: templates still type-check, and a wrong cereale rule is still a compile
error inside the Angular build.

**Next.js cannot work inline**, and the reason is structural rather than a missing option. It
derives *both* the SWC parser's decorator support and the transform mode from the single
`experimentalDecorators` flag, so the flag on gives legacy emit that cereale refuses, and the
flag off makes `@` a syntax error. There is no third setting.

**NestJS cannot work inline** either: its dependency injection genuinely needs the
`design:type` metadata only `emitDecoratorMetadata` produces.

Both have the same answer, and it is better than it sounds: put the cereale classes in a
package compiled by `tsc` and import the built output. The decorators run at class-definition
time inside that package, so the app only ever sees plain JavaScript and its own decorator
setting stops mattering. Verified inside a program with **both** legacy flags on, running
alongside `@Injectable()` — mapping and validation work normally, and the compile-time
guarantee still holds where the rules are written.

Also verified: **Bun** 1.3 needs no configuration at all, and a real Vite 8 build with the
`cereale/vite` plugin produces working output where the same build without it silently leaves
decorator syntax in the bundle.

### Packaging

`FRAMEWORKS.md` ships with the package. `sideEffects` now lists the flat bundle, which inlines
the `Symbol.metadata` install.

### Why 0.4.0 and not 0.3.1

`cereale/min` is a new public entry point, which is a minor bump under 0.x. It also keeps the
existing `v0.3.0` tag meaningful instead of force-moving it onto a commit it was never cut
from.

## [0.3.0] - 2026-08-05

Every change here comes from the same question: where does cereale currently fail *quietly*?
Three answers, each of which cost a real user nothing to hit and everything to diagnose.

### Vite 8 and Vitest 4 silently drop decorators — `cereale/vite`

Both transform TypeScript with oxc, which does not implement the standard decorator transform
and does not say so. It leaves the syntax in the output, so:

- `vitest` reports `0 test` next to a bare `SyntaxError`
- `vite build` reports **success**, having emitted a bundle that throws the moment it is imported

Cereale now ships the plugin that fixes it:

```ts
// vite.config.ts / vitest.config.ts
import { standardDecorators } from 'cereale/vite';

export default defineConfig({ plugins: [standardDecorators()] });
```

It transforms with esbuild, falling back to the TypeScript compiler; cereale depends on
neither, and says which to install if somehow neither is present. Options: `include`,
`target`, and `transformer` to pin one deliberately. The library's own test suite runs
through it, so it is exercised by every test rather than by one test about itself.

### Legacy decorators now say so

With `experimentalDecorators: true` — still the default in most existing TypeScript projects,
because class-validator required it — decorators are invoked as `(prototype, "name")` and
cereale died with `TypeError: Cannot convert undefined or null to object`, which names neither
the cause nor the fix. Every decorator now resolves its metadata through one checkpoint that
raises an error naming the tsconfig setting instead. The same checkpoint rejects application
to a method, getter or `accessor` field, all of which previously recorded metadata that
nothing would ever read.

### Values JSON cannot carry are refused, not emptied

A populated `Map` serialized to `{}`. A `Set` serialized to `{}`. A `Uint8Array` to
`{"0":1,"1":2}`. A `bigint` passed straight through, so the caller's own `JSON.stringify`
threw somewhere unrelated. `RegExp`, `Error`, `Promise`, `WeakMap`, `DataView`, symbols and
functions all had their own version of the same failure. All of them now raise a
`JsonMappingError` that names the property path and the two ways out:

```
JsonMappingError: lines[1].tags[0] is a Set, which cannot be serialized to JSON.
Give the property a @JsonSerialize() serializer that converts it, or drop it from the
output with @JsonIgnore().
```

The check also covers what a `@JsonSerialize` serializer hands back, sync or async. This is
**breaking** for anyone relying on the old behaviour, though "relying on" is a strong word for
losing data without being told.

Circular-reference and depth-limit errors now name the path too (`at child.parent`), which
came free with the bookkeeping.

### Fixed

- `defineRule` on a subclass with no decorators of its own wrote the rule into its **base
  class**, because the base's metadata object is inherited through the static prototype chain
  and `??=` found it non-nullish. Every sibling subclass then inherited a rule meant for one
  of them.
- The plugin's TypeScript path emitted a `//# sourceMappingURL=` comment pointing at a file
  nobody wrote, which Vite followed and failed to read on every transformed module.
- `fromRequest` was declared as taking the global `Request`, so cereale's own published
  `.d.ts` raised `Cannot find name 'Request'` in any project whose `lib` and `types` did not
  happen to supply it — an error inside a dependency, in code the consumer may never call,
  that they could not fix from the outside. It now takes a structural `JsonBody`
  (`{ json(): Promise<any> }`), which a `Request` still satisfies. The library's own type
  tests had been hiding this by enabling both `DOM` and `skipLibCheck`; `npm run check:types`
  now compiles a consumer against `dist/` with neither.

### The landing page

`docs/index.html` was rebuilt. Its playground had been dead for some time and said nothing
about it: the page loaded `@babel/standalone` from an **unpinned** CDN URL, which rolled over
to Babel 8 and dropped the `proposal-class-properties` plugin the page asked for, so
`Babel.transform` threw before it ever reached the decorators — and the decorator config it
passed was `{ legacy: true }`, which 0.2.0 had already made wrong. The copy was still selling
the 0.1.0 pitch ("Spring-like"), listed about half the decorators, and claimed "Zero overhead"
against a README that publishes the real microsecond costs.

The rebuild is one self-contained page: hand-written CSS, no Tailwind CDN, no CodeMirror, and
a vendored compiler pinned by `package.json`. It loads **nothing** from the network, which
`npm run check:docs` now enforces in CI. The playground runs the real bundled library across
six examples; the reference lists all 68 decorators and the full API, counted from the bundle
at runtime so it cannot drift.

The hero's compiler error is not typed into the HTML — `scripts/build-docs.mjs` compiles the
snippet with the real `tsc` and writes the verbatim diagnostic into `docs/diagnostics.js`,
failing the build if a snippet the page calls a compile error ever compiles. Two more snippets
that must compile guard against the harness passing vacuously.

### Corrected

The README's toolchain table said esbuild takes "the same settings via `tsconfigRaw`". It does
not: esbuild lowers standard decorators only when its **own top-level `target`** is below
`esnext`. A `target` inside `tsconfigRaw` sets the `useDefineForClassFields` default and
nothing else, so following that advice leaves decorator syntax in the output — the same silent
passthrough the section blames on oxc. Both the table and the landing page now say so, and
`src/toolchain.test.ts` asserts both halves, so the trap is documented by a test rather than by
a sentence.

Also corrected in the same pass: the toolchain table is described as executed by a test, but
the oxc row — the only ✗ — cannot be, because oxc ships inside a native binary with no
standalone transform API. The claim now covers the three rows it actually covers.

### A rename now actually takes effect

**Breaking.** The docs said that once a property carries `@JsonProperty`, its original name
"is no longer accepted on input". It stopped being *mapped*, but it was not refused: unlike
`@JsonReadOnly`, whose JSON name goes into the blocked set, a renamed property's old key fell
through to the unknown-key policy, and the default `allow` copied it onto the instance
untouched. The value landed on a declared property having skipped everything declared for it —
no `@JsonType` conversion, so `@ValidateNested` then inspected a plain object with no model and
reported nothing. A payload aimed at the previous version of a class was accepted in part, in
silence.

Names that no longer reach their property are now refused. That covers three routes to the
same hole:

- the property key of a field renamed with `@JsonProperty`
- the raw key of a field a naming strategy renders differently (`firstName` under `snake_case`)
- the property key of a field that is both renamed and `@JsonReadOnly`, which was still
  settable under its own key

Refused, not silently swallowed. A stale name is a mismatch with whatever produced the payload
rather than a deliberate refusal like `@JsonReadOnly`, so `unknownKeys: 'error'` still reports
it — and now says which property it was reaching for and what that property is called now:

```
JsonMappingError: "ref" is not a JSON name for Order: property "ref" is mapped to
"order_ref". Send that name, or add @JsonAlias("ref") to keep accepting this one.
```

`@JsonAlias` remains the way to keep an old name working, and a key that some *other* property
legitimately answers to is still mapped to that property.

Two reference entries on the landing page were also imprecise: `@IsNotEmpty()` and `@IsEmpty()`
read as complements but are not (`[]` and `{}` pass both), and `unknownKeys` is
deserialization-only.

### Positioning

`zod-alternative` is out of the keywords, and the README leads with the comparison that
actually applies: cereale replaces **class-validator + class-transformer**. It does not infer
types from schemas, and framing it against Zod invited exactly the objection that it is
missing `z.infer` — which is a different design, not a gap.

The README's toolchain support table (`tsc`, esbuild, swc ✅, oxc ❌) is now
[executed by a test](src/toolchain.test.ts): each row compiles a decorated class with that
tool and asserts the metadata arrived, so the table cannot quietly go stale.

### Performance

Serialization is a few percent slower for the representability check. Primitives are handled
inline, and arrays and dates skip it, so it costs one `Symbol.toStringTag` read per object.
Validation is unchanged.

### Packaging

`files` was `["dist"]`, but `dist` carries 256 KB of `.js.map` and `.d.ts.map` files whose
`sources` point at `../../src/*.ts` — which was not published. Every shipped sourcemap
resolved to nothing: 44% of the tarball, dead. The source is only 116 KB and its comments are
the most detailed explanation of why the engine does what it does, so it is now published
(tests and the demo excluded) and the maps resolve. Stepping into cereale in a debugger, and
"go to definition" from a decorator, both land in the real TypeScript.

`CHANGELOG.md` ships too. The `repository`, `homepage` and `bugs` URLs said `Avalon-Vanguard`
and only worked through GitHub's redirect; they now use the org's actual lowercase name.
`publishConfig.access` is set explicitly so a future move to a scoped name cannot quietly
attempt a private publish.

A `Publish to npm` workflow is in place but deliberately manual — pushing a tag does not
publish. It checks that the tag exists and points at the commit being published, refuses a
version already on the registry, runs the full `verify` gate, prints the file list, and
defaults to a dry run. Publishing needs an `NPM_TOKEN` secret and someone choosing to run it.

## [0.2.0] - 2026-08-04

> The project stays on 0.x while nothing has been published: under semver that signals the
> API may still move, which is honest for software with no real-world users. A breaking
> change is therefore a minor bump, which is why this is 0.2.0 rather than 2.0.0.

**Breaking.** Cereale moves to TC39 standard decorators, which is what makes validation rules
type-checked against the fields they are attached to.

### The headline

A rule that does not fit its field is now a compile error:

```ts
class User {
  @IsString() name!: string;   // fine
  @IsString() age!: number;    // Type 'number' is not assignable to type 'string'
}
```

Legacy decorators receive `(target: any, key: string)` and lose the field's type entirely, so
this was impossible in v1. Standard decorators receive `ClassFieldDecoratorContext<This, Value>`,
which carries it. Checked rules include:

- scalar rules against scalar fields (`@Min` on a string is rejected)
- `{ each: true }` against arrays (`@IsString({ each: true })` demands a `string[]`, and a bare
  `@IsString()` on a `string[]` is rejected)
- `@JsonType(() => Address)` against the field's class
- `@JsonSerialize` / `@JsonDeserialize` against the field's type
- `@IsIn([...])` and `@IsEnum(E)` against the field's value type

17 tests invoke the real compiler to assert these stay rejected.

### Migration

- Remove `"experimentalDecorators": true`; add `"ESNext.Decorators"` to `lib`.
- `registerDecorator({ target, propertyName, validator })` is replaced by
  `defineRule(Class, 'field', constraint)`.
- Decorators cannot be applied to `abstract` fields. Declare the field concretely in the base.
- Field types may need tightening where a rule narrows them: `@IsIn(['a','b']) x!: string`
  becomes `x!: 'a' | 'b'`.
- `@JsonPolymorphic` takes its base type explicitly to check subtypes:
  `@JsonPolymorphic<Media>('type', [...])`.
- `@ValidateIf` takes the class as a type argument: `@ValidateIf<Movie>(m => ...)`.

Everything else — the engine, options, naming strategies, access control, error helpers, the
sync API — is unchanged.

### Removed

- `metadata-storage.ts` and its WeakMap singleton. Metadata now lives on `context.metadata`,
  the language's own mechanism, which also removes the dual ESM/CJS double-singleton hazard.
- `registerDecorator`, replaced by `defineRule`.

### Fixed

- Inheritance merging is now structural rather than reconstructed: `context.metadata` inherits
  through the prototype chain, so the subclass-shadowing defect fixed by hand in 0.1.0 cannot
  reoccur by construction. Identical inherited rules are still collapsed so re-stating a rule
  on an override does not double-report.

### Toolchain

Standard decorators are transformed by `tsc` and by esbuild; **oxc does not implement them
yet**. The library builds with `tsc` and consumers bundling with esbuild or Vite are fine, but
the test runner (Vitest 4, which uses oxc) needs an esbuild transform plugin — see
`vitest.config.ts`. Projects on an oxc-based toolchain should stay on 0.1.x for now.

## [0.1.0] - 2026-08-05

### Added

**Synchronous API.** `validateSync`, `validateOrRejectSync`, `toPlainSync`, `toJsonSync`,
`toInstanceSync`, `toInstanceArraySync`, `fromJsonSync` and `fromJsonArraySync`. Nothing on
the default path is genuinely asynchronous — only a user-supplied serializer, deserializer or
validator can be — so requiring `await` everywhere was a tax on the common case.

The engines are now written synchronously, and anything a hook makes asynchronous is recorded
and reconciled once at the end. There is no second copy of the traversal logic to keep in
step, and the async entry points stop paying for a microtask per property. If a hook does
return a Promise, the `*Sync` call raises a `JsonMappingError` naming the async alternative
rather than silently returning a half-built object.

`fromRequest` has no synchronous counterpart, because reading a request body is inherently
asynchronous.

- `maxDepth` option (default 64) on every mapping function and on `configure()`. All three
  engines recurse, so a hostile payload nested thousands of levels deep could exhaust the
  call stack; it now raises a `JsonMappingError`. Cycles were already handled, but legitimate
  deep nesting was not bounded.
- `validate(obj, options?)` accepts options, so `maxDepth` applies to standalone validation.
- `REDACTED` export, the placeholder substituted for withheld values.

### Security

- **Validation errors no longer carry the value of a property that is never serialized.**
  A `@JsonWriteOnly` password that failed `@MinLength` put the rejected password into
  `ValidationError.value`, and from there into any log that recorded the error. Values for
  `@JsonWriteOnly` and `@JsonIgnore` properties are replaced with `REDACTED`; the property
  name and the failure message are unchanged, so the error is still actionable.

### Performance

Profiling the validator showed roughly **half of all validation time** was spent re-deriving
answers that cannot change: `collectConstraints` (22%), `getOwnMetadata` (12%),
`getMetadataChain` (9%), `getProperties` (4%) and `getMetadata` (3%), plus 8% garbage
collection from the allocation churn. The constraint predicates themselves accounted for
under 1%.

Decorator metadata is fixed once classes are declared, so the derived structures are now
memoized per prototype — the validation plan, the serialization plan, the deserialization
plan, and serializer/deserializer instances (previously constructed fresh for every property
of every object). `MetadataStorage` carries a version counter that invalidates every cache
if metadata is registered late, so `registerDecorator` after first use still works.

Together with the synchronous core, measured on a customer record with a nested address and
orders, against `JSON.parse` + `JSON.stringify` (5.8 us) as a fixed reference point:

| Operation | 0.1.0 | Now | Speedup |
| --- | --- | --- | --- |
| `validate` (50 orders) | 221.6 us | 17.8 us | 12.4x |
| `validate` (10 orders) | 47.8 us | 4.5 us | 10.6x |
| `toPlain` (50 orders) | 294.4 us | 36.0 us | 8.2x |
| `toInstance` (50 orders) | 255.1 us | 31.7 us | 8.0x |
| `toInstance` (10 orders) | 64.6 us | 8.2 us | 7.9x |
| `toInstance` (single) | 19.8 us | 5.2 us | 3.8x |

### Changed

- `each: true` failures now report which element failed — `"... (failed at index 3)"`. A bad
  entry in a 200-item array previously produced a message that could not locate it. A message
  function now receives the failing element as `args.value` rather than the whole array;
  caller-supplied string messages are still reported verbatim.

## [0.1.0] - 2026-08-03

The first release with a working test suite. Everything below the "Fixed" heading was
found by writing tests against the previous release; the suite has grown from 40 tests
that never executed to 136 that do.

### Added

**Field-name mapping.** A library whose headline feature is "JSON mapping" could not map
a name. It can now.

- `@JsonProperty(name)` renames a property in both directions.
- `@JsonAlias(...names)` accepts extra names on input only, so a field can be renamed
  without breaking older clients.
- Naming strategies — `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE`, `PascalCase`,
  `camelCase`, or your own function — applied to properties with no explicit name.
  Acronyms split where a reader expects: `parseHTTPResponse` → `parse_http_response`.

**Access control.**

- `@JsonIgnore()` — excluded in both directions.
- `@JsonWriteOnly()` — accepted from input, never echoed back (passwords).
- `@JsonReadOnly()` — serialized, never settable by a client (server-owned ids).

**Transform options**, per call or globally via `configure()`.

- `validate: false` maps without validating, for lenient parsing.
- `unknownKeys: 'allow' | 'strip' | 'error'` decides what happens to undeclared keys.
- `namingStrategy` selects the JSON naming convention.

**Error ergonomics.** Turning the nested `ValidationError` tree into an HTTP 400 body used
to be the caller's problem.

- `flattenErrors(errors)` → `{ "items[0].qty": ["qty must be at least 1"] }`
- `formatErrors(errors)` → one human-readable line per failure
- `collectErrorMessages(errors)` → just the messages
- `validateOrReject(obj)` throws instead of returning an array you might forget to check

**30 validation decorators.** `@Equals`, `@NotEquals`, `@IsEmpty`, `@IsEnum`, `@IsInstance`,
`@Length`, `@IsAlpha`, `@IsAlphanumeric`, `@IsNumberString`, `@IsLowercase`, `@IsUppercase`,
`@Contains`, `@NotContains`, `@StartsWith`, `@EndsWith`, `@IsUUID`, `@IsJSON`,
`@IsDateString`, `@IsSemVer`, `@IsHexColor`, `@IsIP`, `@IsDivisibleBy`, `@IsPort`,
`@IsLatitude`, `@IsLongitude`, `@IsBigInt`, `@MinDate`, `@MaxDate`, `@ArrayUnique`,
`@ArrayContains`, `@ArrayNotContains`.

**Conditional validation.** `@ValidateIf(o => ...)` makes a property's rules depend on the
rest of the object; `@Allow()` declares a property that needs no rules of its own.

**Correctly typed array entry points.** `toInstanceArray()` and `fromJsonArray()`.
`toInstance`/`fromJson` accept arrays at runtime but type the result as `T`, so callers had
to cast to reach the elements.

**`@JsonPolymorphic` options.** `{ onUnknown: 'error' }` and `{ fallback: SomeClass }`.

**`JsonMappingError`** — raised when a value cannot be mapped at all, as distinct from
mapping fine and failing validation.

### Fixed

- **Inheritance silently discarded base-class rules.** A subclass re-decorating an inherited
  property registered its constraints against its own prototype, and the engine read only the
  nearest set. Constraints now merge down the whole prototype chain, base first. The
  library's own example was affected: `Media`'s `@IsString() title` had never been enforced
  for `Book`.
- **A circular reference exhausted the heap.** `serialize()` recursed forever, taking 8 GB
  and the process with it. It now raises a `JsonMappingError` naming the cause. Diamonds
  still serialize; `validate()` skips back-edges.
- **`@Matches` with a `g` or `y` flag was stateful.** `RegExp.test` advances `lastIndex`, so
  validating the same value twice gave different answers. Those flags are stripped.
- **An unmatched `@JsonPolymorphic` discriminator silently dropped the value.** The
  single-object branch fell through without assigning; the property came back `undefined`.
  The raw value is now preserved.
- **`@JsonSerialize` serializers ran on `null`/`undefined`**, crashing on any unset optional
  property. They now only see real values.
- **`serialize()` crashed on null-prototype objects.** It read `obj.constructor.prototype`;
  both engines now agree on `Object.getPrototypeOf`.
- **`__proto__`, `constructor` and `prototype` in untrusted JSON** were copied onto the
  instance, detaching it from its own class. They are dropped.
- **Caller-supplied messages were mangled** by the `each element in ...` prefix, producing
  sentences like "each element in tags must all be strings".
- **Two rules sharing a name overwrote each other**, so only one failure was ever reported.
- **`fromRequest` leaked a raw `SyntaxError`** for a non-JSON body; it now reports a
  `JsonMappingError`.
- **`@ValidateNested({ each: true })`** was documented in the README but did not compile —
  `ValidateNested()` accepted no arguments. It now does, and asserts the value is an array.

### Changed

- `toPlain`, `toJson`, `toInstance`, `fromJson`, `fromJsonArray`, `toInstanceArray` and
  `fromRequest` accept an optional trailing options argument. All defaults preserve the
  previous behaviour.
- `src/example.ts` is no longer published in `dist`. It called `runExample()` at import
  time — an import side effect in a package declaring `"sideEffects": false`.
- Minimum supported Node is 20.

### Infrastructure

- **The test suite had never run.** Vitest 4 transpiles with oxc, which does not read
  `experimentalDecorators` from a tsconfig that excludes the files it is transforming, so
  every decorator-using suite failed to parse and was reported as "0 test" rather than as an
  error. A `vitest.config.ts` enabling legacy decorators brought all 40 existing tests back
  to life.
- Test files are now type-checked, which surfaced 17 strict-mode errors.
- CI runs lint, coverage tests, build and ESM/CJS entry-point smoke checks across Node
  20/22/24, and `npm ci` works because `package-lock.json` is committed.
- `npm run build:docs` regenerates the previously hand-maintained `docs/cereale.js`.

## [0.0.1]

Initial release: mapping and validation decorators, polymorphic types, custom
serializers/deserializers, and the `toJson` / `fromJson` / `toPlain` / `toInstance` API.
