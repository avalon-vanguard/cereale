import { describe, it, expect } from 'vitest';
import { 
  toPlain, 
  toInstance, 
  toJson, 
  fromJson, 
  fromRequest,
  validate, 
  IsString, 
  IsNumber, 
  JsonValidationError 
} from './index.js';

describe('Standalone Utility Functions', () => {
  class User {
    @IsString()
    name: string;

    @IsNumber()
    age: number;
  }

  it('should validate an object directly', async () => {
    const user = new User();
    user.name = 'John';
    user.age = 30;
    const errors = await validate(user);
    expect(errors).toHaveLength(0);

    user.age = '30' as any;
    const errors2 = await validate(user);
    expect(errors2).toHaveLength(1);
    expect(errors2[0].property).toBe('age');
  });

  it('should transform to plain object directly', async () => {
    const user = new User();
    user.name = 'John';
    user.age = 30;
    const plain = await toPlain(user);
    expect(plain).toEqual({ name: 'John', age: 30 });
    expect(plain).not.toBeInstanceOf(User);
  });

  it('should throw JsonValidationError in toPlain if invalid', async () => {
    const user = new User();
    user.name = 'John';
    user.age = '30' as any;
    await expect(toPlain(user)).rejects.toThrow(JsonValidationError);
  });

  it('should transform to instance directly', async () => {
    const plain = { name: 'John', age: 30 };
    const user = await toInstance(User, plain);
    expect(user).toBeInstanceOf(User);
    expect(user.name).toBe('John');
    expect(user.age).toBe(30);
  });

  it('should throw JsonValidationError in toInstance if invalid', async () => {
    const plain = { name: 'John', age: '30' };
    await expect(toInstance(User, plain)).rejects.toThrow(JsonValidationError);
  });

  it('should transform to JSON directly', async () => {
    const user = new User();
    user.name = 'John';
    user.age = 30;
    const json = await toJson(user);
    expect(json).toBe('{"name":"John","age":30}');
  });

  it('should transform from JSON directly', async () => {
    const json = '{"name":"John","age":30}';
    const user = await fromJson(User, json);
    expect(user).toBeInstanceOf(User);
    expect(user.name).toBe('John');
    expect(user.age).toBe(30);
  });

  it('should transform from Request directly', async () => {
    const json = '{"name":"John","age":30}';
    const request = new Request('https://example.com', {
      method: 'POST',
      body: json,
      headers: { 'Content-Type': 'application/json' }
    });
    const user = await fromRequest(User, request);
    expect(user).toBeInstanceOf(User);
    expect(user.name).toBe('John');
    expect(user.age).toBe(30);
  });
});
