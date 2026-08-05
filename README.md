# Cereale

> **This is the 1.x maintenance line**, which uses TypeScript's legacy
> `experimentalDecorators`. It is feature-complete and supported for bug fixes.
>
> **New projects should use 2.x**, which moves to TC39 standard decorators and gains
> compile-time checking of validation rules against field types — `@IsString() age: number`
> becomes a compile error rather than a runtime surprise.
>
> Stay on 1.x if your toolchain transpiles with **oxc**, which does not yet implement the
> standard decorator transform. `tsc` and esbuild both do, so most projects can move.

Cereale is a lightweight TypeScript library that provides Spring-like decorators for JSON mapping and validation. Built with ZERO external dependencies, it simplifies the process of converting between plain JSON and class instances with full validation support.

## Features

- **Spring-like Decorators:** Familiar `@JsonProperty`, `@JsonSerialize`, `@JsonDeserialize`, `@JsonType`, and `@JsonPolymorphic`.
- **Field-name Mapping:** Map `first_name` to `firstName` per property or with a naming strategy.
- **Access Control:** Keep passwords out of responses and server-owned ids out of requests.
- **Custom Serializers/Deserializers:** Easily handle complex types like Dates, BigInts, or custom objects.
- **Polymorphism Support:** Native handling of polymorphic types via discriminators.
- **Integrated Validation:** 50+ validation decorators, applied during mapping or on demand.
- **Type Safety:** Fully written in TypeScript for excellent developer experience.
- **Zero Dependencies:** Extremely lightweight and fast.

## Installation

```bash
npm install cereale
```

Enable `experimentalDecorators` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "target": "ES2022"
  }
}
```

Cereale stores its own metadata, so `reflect-metadata` is not required and
`emitDecoratorMetadata` is not read. Requires Node 20 or later.

## Quick Start

### 1. Define your Models

```typescript
import {
  IsString,
  IsDate,
  ValidateNested,
  JsonSerialize,
  JsonDeserialize,
  JsonPolymorphic,
  JsonSerializer,
  JsonDeserializer
} from 'cereale';

// Custom Date Serializer
class DateSerializer implements JsonSerializer<Date, string> {
  serialize(value: Date): string {
    return value.toISOString().split('T')[0]!;
  }
}

class DateDeserializer implements JsonDeserializer<string, Date> {
  deserialize(value: string): Date {
    return new Date(value);
  }
}

abstract class Media {
  @IsString()
  abstract type: string;

  @IsString()
  title: string;
}

class Book extends Media {
  type = 'book';

  @IsString()
  author: string;

  @JsonSerialize(DateSerializer)
  @JsonDeserialize(DateDeserializer)
  @IsDate()
  publishedAt: Date;
}

class Library {
  @IsString()
  name: string;

  @ValidateNested({ each: true })
  @JsonPolymorphic('type', [
    { value: Book, name: 'book' }
  ])
  items: Media[];
}
```

Constraints accumulate down an inheritance chain: `Book` is checked against `Media`'s
`@IsString() title` as well as its own rules.

### 2. Map JSON with Validation

```typescript
import { fromJson, toJson, JsonValidationError, flattenErrors } from 'cereale';

async function main() {
  const json = '{"name": "Central Library", "items": [{"type": "book", "title": "The Great Gatsby", "author": "F. Scott Fitzgerald", "publishedAt": "1925-04-10"}]}';

  try {
    // Deserialize JSON to Class Instance
    const library = await fromJson(Library, json);
    console.log(library.name);                     // "Central Library"
    console.log(library.items[0] instanceof Book); // true

    // Serialize Class Instance back to JSON
    console.log(await toJson(library));
  } catch (error) {
    if (error instanceof JsonValidationError) {
      console.error(flattenErrors(error.errors));
      // { "items[0].title": ["title must be a string"] }
    }
  }
}
```

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

## Notes and Limitations

- **Circular references** are rejected during serialization with a `JsonMappingError`. Break
  the cycle with `@JsonIgnore()` on the back-reference.
- **`validate()` on a plain object** returns no errors: rules live on the class, so validate
  the instance you get back from `toInstance`, not the raw payload.
- **Renaming is not backwards-compatible by itself.** Once a property carries
  `@JsonProperty`, its original name is no longer accepted on input — add `@JsonAlias` to
  keep older clients working.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

Cereale is licensed under the [MIT License](LICENSE).
