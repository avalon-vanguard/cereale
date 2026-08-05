# Cereale

**Validated domain objects, not validated data.**

Cereale maps JSON onto your own classes and gives you back real instances — with your methods,
your inheritance, your `instanceof` checks — and type-checks the validation rules against the
fields they are attached to. Zero runtime dependencies.

```typescript
class User {
  @JsonProperty('display_name')
  @IsString() @MinLength(2)
  displayName!: string;

  @IsInt() @Min(0)
  age!: number;

  @IsString()
  age2!: number;   // ← compile error: Type 'number' is not assignable to type 'string'

  greet() { return `Hi ${this.displayName}`; }
}

const user = fromJsonSync(User, body);   // a real User
user.greet();                            // your methods are still there
```

**[avalon-vanguard.github.io/cereale](https://avalon-vanguard.github.io/cereale/)** — an
interactive playground that runs this library in your browser, the full decorator reference,
and the toolchain matrix. The page is self-contained and loads nothing from the network; it is
served from `docs/` on `main`, and `npm run build:docs` rebuilds its assets to open locally.

## Where it fits

The stack Cereale replaces is **class-validator + class-transformer**:

| | class-validator + class-transformer | Cereale |
| --- | --- | --- |
| Packages to install | 2, plus `reflect-metadata` | 1, no runtime dependencies |
| Decorators | legacy (`experimentalDecorators`) | TC39 standard |
| Rules checked against the field | no — `@IsInt() name: string` compiles | **yes, at compile time** |
| Mapping and validation | two libraries that must agree | one model |

The comparison people ask about is **Zod**, and it is worth being precise about, because
Cereale is not a drop-in for it:

| | Zod | Cereale |
| --- | --- | --- |
| Result of parsing | an anonymous object matching a schema | an instance of **your class** |
| Methods, getters, inheritance | none — data only | preserved |
| Where the type comes from | inferred from the schema | your class declaration |
| Bidirectional mapping (renaming both ways) | not the focus | first-class |

Cereale does **not** infer your type from a schema. You write the field type and the rule, and
what it guarantees is that **the two cannot disagree** — `@IsInt() name!: string` does not
compile. If you want `z.infer`, you want Zod; that is a different design, not a missing feature.

Reach for Cereale when your domain model is already a class — a NestJS provider, a TypeORM
entity, anything with behaviour attached. Reach for Zod when you just want the data.

## Features

- **Strongly typed decorators:** a rule that does not fit its field is a compile error.
- **Real instances:** nested objects, polymorphic subtypes and arrays all come back as classes.
- **Field-name mapping:** `@JsonProperty`, `@JsonAlias` and naming strategies, both directions.
- **Access control:** keep passwords out of responses and server-owned ids out of requests.
- **Nothing fails quietly:** a misconfigured compiler, a cycle, or a value JSON cannot carry
  raises an error that names the cause — never an empty object.
- **Sync and async:** every entry point has a synchronous twin.
- **Zero dependencies**, ESM + CJS, Node 20+.

## Installation

```bash
npm install cereale
```

Cereale uses **TC39 standard decorators** (since 0.2.0), so no `experimentalDecorators` flag:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ESNext", "ESNext.Decorators"]
  }
}
```

Requires TypeScript 5.2+ and Node 20+. `reflect-metadata` is not needed and
`emitDecoratorMetadata` is not read.

`experimentalDecorators` must be **off**. The two decorator systems cannot coexist in one
program, so a project that still needs legacy decorators for another library cannot use
Cereale yet. If yours is configured for them, you get an error saying exactly that rather
than a `TypeError` from somewhere inside the engine.

### Toolchain support

Whether Cereale works at all depends on your compiler emitting standard decorators, so the three
✅ rows are [checked by a test](src/toolchain.test.ts) rather than asserted here — each compiles a
decorated class with that tool and asserts the metadata arrived. The ❌ row cannot be: oxc ships
inside a native binary with no standalone transform API.

| Transformer | Status | Notes |
| --- | --- | --- |
| `tsc` | ✅ | With `experimentalDecorators: false` and `target: ES2022`+ |
| esbuild | ✅ | `experimentalDecorators: false` via `tsconfigRaw`, **plus** esbuild's own top-level `target: es2022`. Its default `esnext` target leaves decorator syntax in the output |
| swc | ✅ | `jsc.transform.decoratorVersion: "2022-03"` |
| **oxc** | ❌ | Used by **Vite 8** and **Vitest 4** — see below |

### Frameworks

**[FRAMEWORKS.md](FRAMEWORKS.md)** has a setup recipe for each, every one of them run before it
was written. The short version:

| | | |
| --- | --- | --- |
| **Angular** 21 | ✅ | Flip the scaffolded `experimentalDecorators` to `false`. Angular does not need it — `ngtsc` erases its own decorators itself |
| **React, Vue, Svelte, Solid, Astro, Nuxt** | ✅ | Any Vite 8 app: add the `cereale/vite` plugin below |
| **Bun** | ✅ | No configuration |
| **Node** + `tsc` | ✅ | Just the flag |
| **Next.js** 16 | ⚠️ | Not inline: it derives both the SWC parser *and* the transform from one flag, so decorators either compile legacy or fail to parse. Keep your models in a package compiled by `tsc` |
| **NestJS** 11 | ⚠️ | Not inline: its DI needs `emitDecoratorMetadata`. Same precompiled-package route — verified working alongside `@Injectable()` in a program with both legacy flags on |

**If you are on Vite 8 or Vitest 4**, oxc leaves decorator syntax in the output without
reporting anything: `vitest` prints `0 test` next to a bare `SyntaxError`, and `vite build`
reports success while emitting a bundle that throws the moment it is imported. Cereale ships
the plugin that fixes it:

```ts
// vite.config.ts / vitest.config.ts
import { defineConfig } from 'vite';
import { standardDecorators } from 'cereale/vite';

export default defineConfig({
  plugins: [standardDecorators()],
});
```

It transforms `.ts`, `.mts` and `.cts` outside `node_modules` with esbuild, falling back to
the TypeScript compiler if esbuild is not installed — Cereale depends on neither. Pass
`include` to widen or narrow the set (decorated classes in `.tsx` files need this),
`transformer: 'esbuild' | 'typescript'` to pin one, or `target` to change the output level
from the default `es2022`. Nothing in the plugin is specific to Cereale; delete it once oxc
implements the transform.

## Quick Start

### 1. Define your model

```typescript
import {
  IsString, IsDate, IsInt, Min, ValidateNested, JsonType,
  JsonProperty, JsonWriteOnly, JsonPolymorphic,
} from 'cereale';

class Address {
  @IsString() street!: string;
  @IsString() city!: string;

  format() { return `${this.street}, ${this.city}`; }
}

abstract class Media {
  // Standard decorators cannot decorate an `abstract` member, so declare it concretely.
  @IsString() type: string = '';
  @IsString() title: string = '';
}

class Book extends Media {
  @IsString() override type = 'book';
  @IsString() author!: string;

  @JsonProperty('published_at')
  @IsDate()
  publishedAt!: Date;
}

class Library {
  @IsString() name!: string;

  @ValidateNested() @JsonType(() => Address)
  address!: Address;              // the class must match the field

  @ValidateNested({ each: true })
  @JsonPolymorphic<Media>('type', [{ value: Book, name: 'book' }])
  items!: Media[];
}
```

Constraints accumulate down an inheritance chain: `Book` is checked against `Media`'s rules as
well as its own, and re-stating a rule on an override does not report it twice.

### 2. Map JSON, synchronously or not

```typescript
import { fromJsonSync, toJsonSync, JsonValidationError, flattenErrors } from 'cereale';

try {
  const library = fromJsonSync(Library, json);
  library.address.format();                   // your method, on a real Address
  library.items[0] instanceof Book;           // true
  console.log(toJsonSync(library));
} catch (error) {
  if (error instanceof JsonValidationError) {
    console.error(flattenErrors(error.errors));
    // { "items[0].title": ["title must be a string"] }
  }
}
```

Every function has an async form too (`fromJson`, `toJson`, …) for when a serializer,
deserializer or validator of yours returns a Promise.

### 3. Modern Web Frameworks (Request Integration)

Cereale is compatible with Fetch-based frameworks like Hono, Next.js, and Remix. Use the `fromRequest` async helper.

```typescript
import { fromRequest, toPlain } from 'cereale';

// Hono Example
app.post('/books', async (c) => {
  const book = await fromRequest(Book, c.req.raw);
  return c.json(await toPlain(book));
});
```

## Field-name Mapping

JSON rarely uses the same names as your classes.

```typescript
import { JsonProperty, JsonAlias } from 'cereale';

class User {
  @JsonProperty('first_name')
  firstName: string;        // <-> {"first_name": "Ada"}

  @JsonProperty('surname')
  @JsonAlias('last_name')   // also accepted on input, never emitted
  lastName: string;
}
```

Or convert every property at once with a naming strategy:

```typescript
import { configure, toPlain } from 'cereale';

// once, for the whole application
configure({ namingStrategy: 'snake_case' });

// or per call
await toPlain(user, { namingStrategy: 'snake_case' });
```

Built-in strategies: `identity` (default), `camelCase`, `PascalCase`, `snake_case`,
`SCREAMING_SNAKE_CASE`, `kebab-case`. You can also pass your own
`(propertyKey: string) => string`. An explicit `@JsonProperty` always wins.

Acronyms split where a reader expects them to: `parseHTTPResponse` becomes
`parse_http_response`, not `parse_h_t_t_p_response`.

## Access Control

```typescript
import { JsonIgnore, JsonReadOnly, JsonWriteOnly } from 'cereale';

class Account {
  @JsonReadOnly()      // sent to clients, never settable by them
  id: number;

  @IsString()
  email: string;

  @JsonWriteOnly()     // accepted from clients, never echoed back
  @IsString()
  password: string;

  @JsonIgnore()        // never crosses the boundary in either direction
  internalNotes: string;
}
```

## Options

Every mapping function takes an optional trailing options argument, and `configure()` sets
defaults for the whole application. Per-call options win.

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `validate` | `boolean` | `true` | Validate the result; throw `JsonValidationError` on failure. |
| `namingStrategy` | strategy name or function | `identity` | JSON naming convention for properties without `@JsonProperty`. |
| `unknownKeys` | `allow` \| `strip` \| `error` | `allow` | What to do with incoming keys matching no declared property. |
| `maxDepth` | `number` | `64` | Nesting depth before a `JsonMappingError` is raised, bounding hostile payloads. |

```typescript
// lenient parse: build the instance, inspect the damage yourself
const draft = await fromJson(Order, body, { validate: false });
const problems = flattenErrors(await validate(draft));

// strict intake: reject anything you did not declare
const order = await fromJson(Order, body, { unknownKeys: 'error' });
```

## Synchronous API

Nothing on the default path is genuinely asynchronous — only a serializer, deserializer or
validator you supply can be — so every mapping function has a synchronous twin.

```typescript
import { fromJsonSync, toJsonSync, validateSync } from 'cereale';

const user = fromJsonSync(User, body);      // no await
const errors = validateSync(user);
const payload = toJsonSync(user);
```

`validateSync`, `validateOrRejectSync`, `toPlainSync`, `toJsonSync`, `toInstanceSync`,
`toInstanceArraySync`, `fromJsonSync`, `fromJsonArraySync`.

If one of your hooks does return a Promise, the synchronous call raises a `JsonMappingError`
naming the async function to use instead, rather than handing back a half-built object.
`fromRequest` has no synchronous form, since reading a request body is inherently async.

## API Reference

### Mapping Decorators

- `@JsonProperty(name: string)`: Renames the property in JSON, both directions.
- `@JsonAlias(...names: string[])`: Extra names accepted on input only.
- `@JsonIgnore()`: Excludes the property from mapping entirely.
- `@JsonReadOnly()`: Serialized, but never populated from incoming JSON.
- `@JsonWriteOnly()`: Populated from incoming JSON, but never serialized.
- `@JsonSerialize(serializer: ClassConstructor<JsonSerializer>)`: Custom serializer for a property. Skipped when the value is `null`/`undefined`.
- `@JsonDeserialize(deserializer: ClassConstructor<JsonDeserializer>)`: Custom deserializer for a property.
- `@JsonType(typeFunction: () => ClassConstructor<any>)`: Explicitly sets the type for nested transformations. Applies element-wise to arrays.
- `@JsonPolymorphic(discriminator, subTypes, options?)`: Polymorphic transformation based on a discriminator field. `options` accepts `{ onUnknown: 'keep' | 'error' }` (default `keep`, which preserves the raw value) and `{ fallback: ClassConstructor }`.

### Validation Decorators

Most validation decorators accept an optional `ValidationOptions` object:
- `each: boolean`: Apply validation to each element of an array.
- `message: string | ((args: ValidationArguments) => string)`: Custom error message, reported verbatim.

| Decorator | Description |
| --- | --- |
| `@IsString()` | Checks if value is a string. |
| `@IsNumber()` | Checks if value is a number (and not NaN). |
| `@IsInt()` | Checks if value is an integer. |
| `@IsBoolean()` | Checks if value is a boolean. |
| `@IsBigInt()` | Checks if value is a bigint. |
| `@IsObject()` | Checks if value is an object (not null/array). |
| `@IsDate()` | Checks if value is a valid Date object. |
| `@IsDefined()` | Checks if value is not null or undefined. |
| `@IsOptional()` | Skips other validations if value is null/undefined. |
| `@IsNotEmpty()` | Checks if value is not null/undefined/empty string. |
| `@IsEmpty()` | Checks if value is null/undefined/`''`/`[]`/`{}`. |
| `@Equals(value)` / `@NotEquals(value)` | Strict equality against a fixed value. |
| `@IsEnum(enumObject)` | Checks membership of a TypeScript enum. |
| `@IsInstance(Class)` | Checks `value instanceof Class`. |
| `@Min(value)` / `@Max(value)` | Numeric bounds. |
| `@Positive()` / `@Negative()` | Checks sign. |
| `@IsDivisibleBy(n)` | Checks `value % n === 0`. |
| `@IsPort()` | Integer in 0–65535, as number or numeric string. |
| `@IsLatitude()` / `@IsLongitude()` | Geographic bounds. |
| `@MinLength(len)` / `@MaxLength(len)` | String length bounds. |
| `@Length(min, max?)` | Both bounds in one rule. |
| `@IsAlpha()` / `@IsAlphanumeric()` | Character-class checks. |
| `@IsLowercase()` / `@IsUppercase()` | Case checks. |
| `@IsNumberString()` | String that parses as a finite number. |
| `@Contains(s)` / `@NotContains(s)` | Substring checks. |
| `@StartsWith(s)` / `@EndsWith(s)` | Affix checks. |
| `@Email()` | Checks if string is a valid email. |
| `@IsUrl()` | Checks if string is a valid URL. |
| `@IsUUID(version?)` | Checks if string is a valid UUID. |
| `@IsIP(version?)` | Checks if string is a valid IPv4/IPv6 address. |
| `@IsJSON()` | Checks if string parses as JSON. |
| `@IsDateString()` | Checks if string is a parseable date. |
| `@IsSemVer()` | Checks if string is a semantic version. |
| `@IsHexColor()` | Checks `#rgb`, `#rrggbb`, `#rrggbbaa`. |
| `@Matches(regex)` | Checks if string matches a regular expression. |
| `@MinDate(d)` / `@MaxDate(d)` | Date bounds. Accepts `() => Date` for a moving bound. |
| `@IsArray()` | Checks if value is an array. |
| `@ArrayNotEmpty()` | Checks if array is not empty. |
| `@ArrayMinSize(n)` / `@ArrayMaxSize(n)` | Array size bounds. |
| `@ArrayUnique(keyFn?)` | Checks for duplicate elements. |
| `@ArrayContains(vals)` / `@ArrayNotContains(vals)` | Membership checks. |
| `@IsIn(values)` / `@IsNotIn(values)` | Allow/deny lists. |
| `@ValidateNested(options?)` | Recursively validates nested objects/arrays. |
| `@ValidateIf(o => boolean)` | Skips this property's rules when the condition is false. |
| `@Allow()` | Declares a property with no rules of its own. |
| `@Validate(validator, constraints?, options?)` | Applies a custom validator class or function. |

Write your own with `registerDecorator({ name, target, propertyName, validator })`.

### Utilities

- `toJson(obj, options?)`: Validates and serializes an instance to a JSON string (`Promise<string>`).
- `toPlain(obj, options?)`: Validates and transforms an instance to a plain object (`Promise<any>`).
- `fromJson(clazz, json, options?)`: Parses JSON to a validated class instance (`Promise<T>`).
- `fromJsonArray(clazz, json, options?)`: Same, for a JSON array (`Promise<T[]>`).
- `toInstance(clazz, plain, options?)`: Transforms a plain object to a validated class instance (`Promise<T>`).
- `toInstanceArray(clazz, plain, options?)`: Same, for an array (`Promise<T[]>`).
- `fromRequest(clazz, request, options?)`: Extracts JSON from a Fetch `Request` (`Promise<T>`).
- `validate(obj, options?)`: Full validation, returning `Promise<ValidationError[]>`.
- `validateOrReject(obj, options?)`: As above, but throws `JsonValidationError`.
- Synchronous twins of all of the above except `fromRequest`: `toPlainSync`, `toJsonSync`,
  `fromJsonSync`, `fromJsonArraySync`, `toInstanceSync`, `toInstanceArraySync`,
  `validateSync`, `validateOrRejectSync`.
- `configure(options)` / `getConfig()` / `resetConfig()`: Library-wide defaults.

### Error Handling

`JsonValidationError` carries a nested `ValidationError[]`. Three helpers turn it into
something you can return to a client:

```typescript
import { flattenErrors, formatErrors, collectErrorMessages } from 'cereale';

flattenErrors(errors);        // { "items[0].qty": ["qty must be at least 1"] }
formatErrors(errors);         // "items[0].qty: qty must be at least 1"
collectErrorMessages(errors); // ["qty must be at least 1"]
```

Values of properties that never leave the process — `@JsonWriteOnly` and `@JsonIgnore` — are
replaced with `REDACTED` in `ValidationError.value`, so a rejected password does not travel
into your logs inside an error object. The property name and message are unaffected.

`JsonMappingError` is raised when a value cannot be mapped at all — a body that is not
JSON, a circular reference, an unknown discriminator under `{ onUnknown: 'error' }` — as
distinct from mapping fine and failing validation.

## Framework Integrations

### Hono / Next.js / Cloudflare Workers
Use `fromRequest` for seamless integration with the Fetch `Request` API.

### NestJS
Use Cereale inside your controllers for explicit mapping and validation without needing `reflect-metadata`.

```typescript
import { toInstance } from 'cereale';

@Post()
async create(@Body() body: any) {
  const user = await toInstance(User, body);
  return this.userService.create(user);
}
```

### Express / Fastify

```typescript
import { toInstance, toPlain, JsonValidationError, flattenErrors } from 'cereale';

app.post('/user', async (req, res) => {
  try {
    const user = await toInstance(User, req.body);
    res.json(await toPlain(user));
  } catch (err) {
    if (err instanceof JsonValidationError) {
      return res.status(400).json({ errors: flattenErrors(err.errors) });
    }
    throw err;
  }
});
```

## Performance

Decorator metadata is fixed once your classes are declared, so cereale resolves each class's
validation, serialization and deserialization plans once and memoizes them per prototype.
A version counter invalidates the caches if metadata is registered late, so `registerDecorator`
after first use still behaves correctly. The engines are synchronous internally, so the async
entry points do not pay for a microtask per property.

Indicative throughput for a customer record with a nested address and 10 orders, measured
against `JSON.parse` + `JSON.stringify` (5.8 us) on the same machine:

| Operation | Time |
| --- | --- |
| `toInstance` (deserialize + validate) | ~8 us |
| `toInstance` with `{ validate: false }` | ~3 us |
| `validate` on an existing instance | ~4.5 us |
| `toPlain` (validate + serialize) | ~12 us |

If you validate at the edge and map internally afterwards, `{ validate: false }` skips the
dominant cost.

Serialization also checks every value it walks against the set JSON cannot represent. That
costs a few percent on `toPlain`, which is the price of never emitting `{}` where a `Map`
used to be; primitives are handled inline and the check is skipped for arrays and dates, so
it is one `Symbol.toStringTag` read per object.

## Bundle size

Cereale tree-shakes. Every rule is declared so that a bundler can drop the ones you did not
import, which matters for a library with 68 decorators — you pay for what you name and nothing
else. Minified bytes, measured through three bundlers, and
[pinned by a test](src/treeshake.test.ts) so it cannot quietly regress:

| What you import | esbuild | rollup | webpack |
| --- | ---: | ---: | ---: |
| `flattenErrors` | 287 | 292 | 291 |
| one decorator | 1,837 | 1,823 | 1,818 |
| `validateSync` | 3,722 | 3,554 | 3,823 |
| `toPlainSync` | 7,744 | 7,769 | 7,832 |
| `toInstanceSync` | 7,900 | 7,942 | 7,956 |
| a typical DTO — 5 decorators, map, validate, format errors | 10,395 | 10,402 | 10,372 |
| the whole library | 26,266 | 25,671 | 26,879 |

The serializer and the deserializer drop independently: read JSON and you do not pay for
writing it. The validator is kept by both, because `validate` defaults to `true` and the entry
points reference it whatever a given call site passes.

This did not come for free. Every rule is a top-level call — `export const IsString = rule(…)` —
and rollup can prove such a call side-effect-free by reading the factory, but esbuild and
webpack will not. Without a `/*#__PURE__*/` annotation on each of them, importing one decorator
pulled in the message and validator of all 68: **4,909 bytes instead of 1,837**. Nothing failed;
the library was simply three times heavier in every consumer's bundle, and the only way to find
out was to measure.

## Notes and Limitations

- **Rules are checked, types are not inferred.** You write both the field type and the rule;
  cereale guarantees they agree. If you want the type derived from a schema, that is Zod's
  model, not this one.
- **`abstract` fields cannot be decorated.** Standard decorators do not apply to abstract
  members. Declare the field concretely in the base class instead.
- **`accessor` fields cannot be decorated.** Their value lives in a private slot that mapping
  and validation cannot reach. Applying a decorator to one is an error, not a silent no-op.
- **oxc does not transform standard decorators yet.** `tsc`, esbuild and swc do — see
  [Toolchain support](#toolchain-support) for the Vite/Vitest plugin.
- **Values JSON cannot carry are rejected**, not quietly dropped. `Map`, `Set`, `RegExp`,
  `Error`, typed arrays, `bigint`, `symbol` and functions all raise a `JsonMappingError` naming
  the property path:

  ```
  JsonMappingError: lines[1].tags[0] is a Set, which cannot be serialized to JSON.
  Give the property a @JsonSerialize() serializer that converts it, or drop it from the
  output with @JsonIgnore().
  ```

  Serializing a populated `Map` to `{}` and returning success is the failure mode this
  library exists to prevent, so it does not do it either.
- **Circular references** are rejected during serialization with a `JsonMappingError` that
  names where the cycle closed. Break it with `@JsonIgnore()` on the back-reference.
- **`validate()` on a plain object** returns no errors: rules live on the class, so validate
  the instance you get back from `toInstance`, not the raw payload.
- **Renaming is not backwards-compatible by itself.** Once a property carries
  `@JsonProperty`, its original name no longer reaches it — and is refused rather than copied
  onto the instance behind the rename's back. Add `@JsonAlias` to keep older clients working.
  Under `unknownKeys: 'error'` the stale name is reported along with what the property is
  called now:

  ```
  JsonMappingError: "ref" is not a JSON name for Order: property "ref" is mapped to
  "order_ref". Send that name, or add @JsonAlias("ref") to keep accepting this one.
  ```

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

Cereale is licensed under the [MIT License](LICENSE).
