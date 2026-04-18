import { describe, it, expect } from 'vitest';
import { 
  IsString, 
  IsBoolean,
  IsInt, 
  Min, 
  MinLength,
  MaxLength,
  Email,
  IsUrl,
  IsOptional,
  IsIn,
  ArrayNotEmpty,
  ValidateNested, 
  IsArray, 
  IsDate,
  JsonSerialize, 
  JsonDeserialize, 
  JsonPolymorphic, 
  JsonMapper, 
  JsonSerializer, 
  JsonDeserializer,
  JsonValidationError
} from './index.js';

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
  type: string = 'book';

  @IsString()
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

describe('JsonMapper', () => {
  it('should serialize a Library instance correctly', async () => {
    const library = new Library();
    library.name = "Central Library";
    
    const book = new Book();
    book.title = "The Great Gatsby";
    book.author = "F. Scott Fitzgerald";
    book.publishedAt = new Date("1925-04-10");

    library.items = [book];

    const json = await JsonMapper.toJson(library);
    const parsed = JSON.parse(json);

    expect(parsed.name).toBe("Central Library");
    expect(parsed.items[0].type).toBe("book");
    expect(parsed.items[0].publishedAt).toBe("1925-04-10");
  });

  it('should deserialize a JSON string back to a Library instance', async () => {
    const json = JSON.stringify({
      name: "Central Library",
      items: [
        { 
          type: "book", 
          title: "The Great Gatsby", 
          author: "F. Scott Fitzgerald", 
          publishedAt: "1925-04-10" 
        },
        {
          type: "movie",
          title: "Inception",
          duration: 148
        }
      ]
    });

    const library = await JsonMapper.fromJson(Library, json);

    expect(library).toBeInstanceOf(Library);
    expect(library.items).toHaveLength(2);
    expect(library.items[0]).toBeInstanceOf(Book);
    expect(library.items[1]).toBeInstanceOf(Movie);
    expect((library.items[0] as Book).publishedAt).toBeInstanceOf(Date);
    expect((library.items[1] as Movie).duration).toBe(148);
  });

  it('should throw JsonValidationError for invalid data', async () => {
    const invalidJson = JSON.stringify({
      name: "Invalid Library",
      items: [
        { type: "movie", title: "Short Film", duration: -5 }
      ]
    });

    await expect(JsonMapper.fromJson(Library, invalidJson)).rejects.toThrow(JsonValidationError);
  });

  describe('New Validation Decorators', () => {
    class User {
      @IsString()
      @MinLength(3)
      @MaxLength(10)
      username: string;

      @Email()
      email: string;

      @IsOptional()
      @IsInt()
      @Min(18)
      age?: number;

      @IsBoolean()
      active: boolean;

      @ArrayNotEmpty()
      @IsIn(['admin', 'user', 'guest'], { each: true })
      roles: string[];

      @IsUrl()
      @IsOptional()
      website?: string;
    }

    it('should validate a valid user', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['user'];

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(0);
    });

    it('should validate a valid user with optional fields', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['user'];
      user.age = 25;
      user.website = 'https://example.com';

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(0);
    });

    it('should fail on invalid username length', async () => {
      const user = new User();
      user.username = 'jo'; // too short
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['user'];

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('username');
      expect(errors[0].constraints).toHaveProperty('minLength');
    });

    it('should fail on invalid email', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'invalid-email';
      user.active = true;
      user.roles = ['user'];

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('email');
      expect(errors[0].constraints).toHaveProperty('isEmail');
    });

    it('should fail on invalid role (IsIn)', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['superadmin'];

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('roles');
      expect(errors[0].constraints).toHaveProperty('isIn');
    });

    it('should skip validation for null optional field', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['user'];
      user.age = undefined; // optional

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(0);
    });

    it('should fail if optional field is provided but invalid', async () => {
      const user = new User();
      user.username = 'johndoe';
      user.email = 'john@example.com';
      user.active = true;
      user.roles = ['user'];
      user.age = 15; // too young (Min 18)

      const errors = await JsonMapper.validate(user);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('age');
      expect(errors[0].constraints).toHaveProperty('min');
    });
  });
});
