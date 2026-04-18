# Cereale

Cereale is a lightweight TypeScript library that provides Spring-like decorators for JSON mapping and validation. Built with ZERO external dependencies, it simplifies the process of converting between plain JSON and class instances with full validation support.

## Features

- **Spring-like Decorators:** Familiar `@JsonSerialize`, `@JsonDeserialize`, `@JsonType`, and `@JsonPolymorphic`.
- **Custom Serializers/Deserializers:** Easily handle complex types like Dates, BigInts, or custom objects.
- **Polymorphism Support:** Native handling of polymorphic types via discriminators.
- **Integrated Validation:** Automatically validates objects during serialization and deserialization.
- **Type Safety:** Fully written in TypeScript for excellent developer experience.
- **Zero Dependencies:** Extremely lightweight and fast.

## Installation

```bash
npm install cereale
```

Make sure to enable `experimentalDecorators` and `emitDecoratorMetadata` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "target": "ES2025"
  }
}
```

## Quick Start

### 1. Define your Models

Use decorators to define how your data should be transformed and validated.

```typescript
import { 
  IsString, 
  IsInt, 
  Min, 
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
    return value.toISOString().split('T')[0];
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

### 2. Map JSON with Validation

Use standalone utility functions to handle the conversion process directly.

```typescript
import { fromJson, toJson, JsonValidationError } from 'cereale';

async function main() {
  const json = '{"name": "Central Library", "items": [{"type": "book", "title": "The Great Gatsby", "author": "F. Scott Fitzgerald", "publishedAt": "1925-04-10"}]}';

  try {
    // Deserialize JSON to Class Instance
    const library = await fromJson(Library, json);
    console.log(library.name); // "Central Library"
    console.log(library.items[0] instanceof Book); // true

    // Serialize Class Instance back to JSON
    const outputJson = await toJson(library);
    console.log(outputJson);
  } catch (error) {
    if (error instanceof JsonValidationError) {
      console.error("Validation failed:", error.errors);
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

## API Reference

### Decorators

- `@JsonSerialize(serializer: ClassConstructor<JsonSerializer>)`: Specifies a custom serializer for a property.
- `@JsonDeserialize(deserializer: ClassConstructor<JsonDeserializer>)`: Specifies a custom deserializer for a property.
- `@JsonType(typeFunction: () => ClassConstructor<any>)`: Explicitly sets the type for nested transformations.
- `@JsonPolymorphic(discriminator: string, subTypes: { value: ClassConstructor<any>, name: string }[])`: Configures polymorphic transformation based on a discriminator field.

#### Validation Decorators

Most validation decorators accept an optional `ValidationOptions` object:
- `each: boolean`: Apply validation to each element of an array.
- `message: string | ((args: ValidationArguments) => string)`: Custom error message.

| Decorator | Description |
| --- | --- |
| `@IsString()` | Checks if value is a string. |
| `@IsNumber()` | Checks if value is a number (and not NaN). |
| `@IsInt()` | Checks if value is an integer. |
| `@IsBoolean()` | Checks if value is a boolean. |
| `@IsObject()` | Checks if value is an object (not null/array). |
| `@IsDate()` | Checks if value is a valid Date object. |
| `@IsDefined()` | Checks if value is not null or undefined. |
| `@IsOptional()` | Skips other validations if value is null/undefined. |
| `@IsNotEmpty()` | Checks if value is not null/undefined/empty string. |
| `@Min(value)` | Checks if number is >= value. |
| `@Max(value)` | Checks if number is <= value. |
| `@Positive()` | Checks if number is > 0. |
| `@Negative()` | Checks if number is < 0. |
| `@MinLength(len)` | Checks if string length is >= len. |
| `@MaxLength(len)` | Checks if string length is <= len. |
| `@Email()` | Checks if string is a valid email. |
| `@IsUrl()` | Checks if string is a valid URL. |
| `@Matches(regex)`| Checks if string matches a regular expression. |
| `@IsArray()` | Checks if value is an array. |
| `@ArrayNotEmpty()`| Checks if array is not empty. |
| `@ArrayMinSize(n)`| Checks if array has at least n elements. |
| `@ArrayMaxSize(n)`| Checks if array has at most n elements. |
| `@IsIn(values)` | Checks if value is in the allowed list. |
| `@IsNotIn(vals)` | Checks if value is NOT in the list. |
| `@ValidateNested()`| Recursively validates nested objects/arrays. |

### Utilities

- `toJson(obj: any)`: Validates and serializes an instance to a JSON string (Returns `Promise<string>`).
- `toPlain(obj: any)`: Validates and transforms an instance to a plain object (Returns `Promise<any>`).
- `fromJson(clazz: ClassConstructor, json: string)`: Parses JSON and transforms it to a validated class instance (Returns `Promise<T>`).
- `toInstance(clazz: ClassConstructor, plain: any)`: Transforms a plain object to a validated class instance (Returns `Promise<T>`).
- `fromRequest(clazz: ClassConstructor, request: Request)`: Extracts JSON from a Fetch `Request` and transforms it to a validated instance (Returns `Promise<T>`).
- `validate(obj: any)`: Performs full validation on an object/instance (Returns `Promise<ValidationError[]>`).

## Framework Integrations

Cereale is designed to be compatible with all trending web frameworks.

### Hono / Next.js / Cloudflare Workers
Use `fromRequest` for seamless integration with the Fetch `Request` API.

### NestJS
You can use Cereale inside your controllers for explicit mapping and validation without needing `reflect-metadata`.

```typescript
import { toInstance } from 'cereale';

@Post()
async create(@Body() body: any) {
  const user = await toInstance(User, body);
  return this.userService.create(user);
}
```

### Express / Fastify
Easily integrate with traditional Node.js frameworks.

```typescript
import { toInstance, toPlain } from 'cereale';

app.post('/user', async (req, res) => {
  try {
    const user = await toInstance(User, req.body);
    res.json(await toPlain(user));
  } catch (err) {
    res.status(400).json(err);
  }
});
```

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

Cereale is licensed under the [MIT License](LICENSE).