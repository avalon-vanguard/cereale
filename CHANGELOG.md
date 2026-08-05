# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-05

The legacy-decorator line, promoted from 0.1.0 and now maintained in parallel with 2.x.
Functionally identical to the previous unreleased state; only the version and the
maintenance-line notice changed. See the 2.x branch for standard decorators and
compile-time rule checking.


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
