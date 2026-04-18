import { 
  IsString, 
  IsInt, 
  Min, 
  ValidateNested, 
  IsArray, 
  IsDate,
  JsonSerialize, 
  JsonDeserialize, 
  JsonPolymorphic, 
  toJson,
  fromJson,
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

function IsUsername(options?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'isUsername',
      target: object.constructor,
      propertyName: propertyName,
      ...(options ? { options } : {}),
      validator: (value: any) => typeof value === 'string' && /^[a-zA-Z0-9_]+$/.test(value)
    });
  };
}

// --- Custom Serializers ---

class DateSerializer implements JsonSerializer<Date, string> {
  serialize(value: Date): string {
    if (value instanceof Date) {
      return value.toISOString().split('T')[0] || '';
    }
    return String(value);
  }
}

class DateDeserializer implements JsonDeserializer<string, Date> {
  deserialize(value: string): Date {
    return new Date(value);
  }
}

// --- Domain Models ---

abstract class Media {
  @IsString()
  abstract type: string;

  @IsString()
  title: string;
}

class Book extends Media {
  @IsString()
  override type: string = 'book';

  @IsString()
  @IsUsername({ message: 'Title must be a valid alphanumeric username' })
  declare title: string;

  @IsString()
  @Validate(IsLongerThan, [5])
  author: string;

  @JsonSerialize(DateSerializer)
  @JsonDeserialize(DateDeserializer)
  @IsDate()
  publishedAt: Date;
}

class Movie extends Media {
  @IsString()
  type: string = 'movie';

  @IsInt()
  @Min(1)
  duration: number;
}

class Library {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested()
  @JsonPolymorphic('type', [
    { value: Book, name: 'book' },
    { value: Movie, name: 'movie' }
  ])
  items: Media[];
}

// --- Execution ---

async function runExample() {
  console.log("--- Starting Example ---");

  // 1. Create a Library instance
  const library = new Library();
  library.name = "Central Library";
  
  const book = new Book();
  book.title = "Gatsby";
  book.author = "Fitzgerald";
  book.publishedAt = new Date("1925-04-10");

  const movie = new Movie();
  movie.title = "Inception";
  movie.duration = 148;

  library.items = [book, movie];

  try {
    // 2. Serialize to JSON
    console.log("\n[1] Serializing Library to JSON...");
    const json = await toJson(library);
    console.log("JSON Output:", json);

    // 3. Deserialize back to Instance
    console.log("\n[2] Deserializing JSON back to Library instance...");
    const deserializedLibrary = await fromJson(Library, json);
    console.log("Deserialized Library Name:", deserializedLibrary.name);
    console.log("Items count:", deserializedLibrary.items.length);

    // Check Polymorphism
    deserializedLibrary.items.forEach((item, index) => {
      console.log(`Item ${index} is instance of ${item.constructor.name}: ${item.title}`);
      if (item instanceof Book) {
        console.log(`  > Book Author: ${item.author}`);
        console.log(`  > Published At: ${item.publishedAt.toISOString()} (instanceof Date: ${item.publishedAt instanceof Date})`);
      } else if (item instanceof Movie) {
        console.log(`  > Movie Duration: ${item.duration} mins`);
      }
    });

    // 4. Test Validation Failure
    console.log("\n[3] Testing Validation Failure (Invalid Movie Duration)...");
    const invalidJson = JSON.stringify({
      name: "Invalid Library",
      items: [
        { type: "movie", title: "Short Film", duration: -5 } // Invalid: duration < 1
      ]
    });

    await fromJson(Library, invalidJson);
  } catch (error) {
    if (error instanceof Error) {
      console.log("Caught expected error:", error.message);
      if ((error as any).errors) {
        console.log("Validation details:", JSON.stringify((error as any).errors, null, 2));
      }
    }
  }
}

runExample();
