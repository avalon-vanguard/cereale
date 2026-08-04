import {
  IsString,
  IsInt,
  Min,
  ValidateNested,
  IsArray,
  IsDate,
  IsEnum,
  IsUUID,
  ValidateIf,
  JsonProperty,
  JsonAlias,
  JsonReadOnly,
  JsonWriteOnly,
  JsonSerialize,
  JsonDeserialize,
  JsonPolymorphic,
  toJson,
  fromJson,
  toPlain,
  validate,
  flattenErrors,
  JsonSerializer,
  JsonDeserializer,
  Validate,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions
} from './index.js';

// --- Custom Validators ---

class IsLongerThan implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    const minLength = args.constraints[0];
    return typeof value === 'string' && value.length > minLength;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be longer than ${args.constraints[0]} characters (actual: ${args.value?.length})`;
  }
}

function IsSlug(options?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'isSlug',
      target: object.constructor,
      propertyName: propertyName,
      ...(options ? { options } : {}),
      validator: (value: any) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value)
    });
  };
}

// --- Custom Serializers ---

class DateSerializer implements JsonSerializer<Date, string> {
  serialize(value: Date): string {
    return value.toISOString().split('T')[0] || '';
  }
}

class DateDeserializer implements JsonDeserializer<string, Date> {
  deserialize(value: string): Date {
    return new Date(value);
  }
}

// --- Domain Models ---

enum Format {
  Hardback = 'hardback',
  Paperback = 'paperback',
}

abstract class Media {
  @IsString()
  abstract type: string;

  // Declared once here. Subclasses inherit the rule without restating it.
  @IsString()
  title: string;
}

class Book extends Media {
  @IsString()
  override type: string = 'book';

  @IsString()
  @Validate(IsLongerThan, [5])
  author: string;

  @IsEnum(Format)
  format: Format = Format.Paperback;

  @JsonProperty('published_at')
  @JsonSerialize(DateSerializer)
  @JsonDeserialize(DateDeserializer)
  @IsDate()
  publishedAt: Date;
}

class Movie extends Media {
  @IsString()
  override type: string = 'movie';

  @IsInt()
  @Min(1)
  duration: number;

  // Only checked for films that claim to be part of a series.
  @ValidateIf((movie: Movie) => movie.duration > 200)
  @IsString()
  intermissionNote?: string;
}

class Library {
  @JsonReadOnly()
  @IsUUID(4)
  id: string;

  @IsString()
  @IsSlug({ message: 'name must be a lowercase slug' })
  name: string;

  @JsonProperty('curator_email')
  @JsonAlias('curatorEmail')
  @IsString()
  curatorEmail: string;

  @JsonWriteOnly()
  @IsString()
  adminToken: string;

  @IsArray()
  @ValidateNested({ each: true })
  @JsonPolymorphic('type', [
    { value: Book, name: 'book' },
    { value: Movie, name: 'movie' }
  ])
  items: Media[];
}

// --- Execution ---

async function runExample() {
  console.log('--- Starting Example ---');

  const library = new Library();
  library.id = '9b2e4c1a-77bd-4f2e-8c33-1d9a6b0e5f21';
  library.name = 'central-library';
  library.curatorEmail = 'ada@example.com';
  library.adminToken = 'super-secret';

  const book = new Book();
  book.title = 'Gatsby';
  book.author = 'Fitzgerald';
  book.format = Format.Hardback;
  book.publishedAt = new Date('1925-04-10');

  const movie = new Movie();
  movie.title = 'Inception';
  movie.duration = 148;

  library.items = [book, movie];

  // 1. Serialize, honouring @JsonProperty and the write-only token
  console.log('\n[1] Serializing Library to JSON...');
  const json = await toJson(library);
  console.log('JSON Output:', json);
  console.log('Secret withheld from output:', !json.includes('super-secret'));

  // 2. Deserialize back, resolving the polymorphic items
  console.log('\n[2] Deserializing JSON back to Library instance...');
  const restored = await fromJson(Library, json, { validate: false });
  console.log('Curator (read via curator_email):', restored.curatorEmail);
  console.log('Items count:', restored.items.length);
  restored.items.forEach((item, index) => {
    console.log(`Item ${index} is a ${item.constructor.name}: ${item.title}`);
    if (item instanceof Book) {
      console.log(`  > Author: ${item.author}, format: ${item.format}`);
      console.log(`  > Published: ${item.publishedAt.toISOString()} (Date: ${item.publishedAt instanceof Date})`);
    } else if (item instanceof Movie) {
      console.log(`  > Duration: ${item.duration} mins`);
    }
  });

  // 3. A client cannot set a @JsonReadOnly field
  console.log('\n[3] A client trying to set the read-only id...');
  const hijacked = await fromJson(
    Library,
    JSON.stringify({ id: 'attacker-supplied', name: 'x', curator_email: 'a@b.c', adminToken: 't', items: [] }),
    { validate: false }
  );
  console.log('id after mapping (expected undefined):', hijacked.id);

  // 4. Validation failures, flattened for an HTTP response
  console.log('\n[4] Reporting validation failures...');
  const invalid = await fromJson(
    Library,
    JSON.stringify({
      name: 'Not A Slug',
      curator_email: 'a@b.c',
      adminToken: 't',
      items: [{ type: 'movie', title: 'Short Film', duration: -5 }]
    }),
    { validate: false }
  );
  console.log(flattenErrors(await validate(invalid)));

  // 5. A base-class rule applies to a subclass that never restates it
  console.log('\n[5] Base-class constraints reach subclasses...');
  const untitled = new Book();
  untitled.title = undefined as any;
  untitled.author = 'Fitzgerald';
  untitled.publishedAt = new Date('1925-04-10');
  console.log(flattenErrors(await validate(untitled)));

  // 6. Naming strategies convert every property at once
  console.log('\n[6] The same movie under snake_case...');
  console.log(await toPlain(movie, { namingStrategy: 'snake_case' }));
}

runExample().catch((error) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
