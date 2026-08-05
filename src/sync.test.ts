import { describe, it, expect } from 'vitest';
import {
  IsString, IsInt, Min, MinLength, IsIn, ValidateNested, JsonType, JsonProperty,
  JsonSerialize, JsonDeserialize, JsonSerializer, JsonDeserializer,
  JsonIgnore, JsonWriteOnly, Validate, JsonMappingError, JsonValidationError, REDACTED,
  validate, validateSync, validateOrReject, validateOrRejectSync,
  toPlain, toPlainSync, toJson, toJsonSync,
  toInstance, toInstanceSync, toInstanceArray, toInstanceArraySync,
  fromJsonSync, fromJsonArraySync,
  flattenErrors,
} from './index.js';

class Upper implements JsonSerializer<string, string> {
  serialize(value: string): string { return value.toUpperCase(); }
}
class Lower implements JsonDeserializer<string, string> {
  deserialize(value: string): string { return value.toLowerCase(); }
}

class User {
  @JsonProperty('display_name')
  @IsString()
  @MinLength(2)
  displayName: string;

  @IsInt()
  @Min(0)
  age: number;
}

describe('synchronous API', () => {
  it('toInstanceSync / fromJsonSync map and validate without a Promise', () => {
    const user = toInstanceSync(User, { display_name: 'Ada', age: 36 });
    expect(user).toBeInstanceOf(User);
    expect(user.displayName).toBe('Ada');

    const parsed = fromJsonSync(User, '{"display_name":"Ada","age":36}');
    expect(parsed.displayName).toBe('Ada');
  });

  it('toPlainSync / toJsonSync round-trip', () => {
    const user = new User();
    user.displayName = 'Ada';
    user.age = 36;

    expect(toPlainSync(user)).toEqual({ display_name: 'Ada', age: 36 });
    expect(toJsonSync(user)).toBe('{"display_name":"Ada","age":36}');
  });

  it('validateSync returns the same errors as validate', async () => {
    const user = new User();
    user.displayName = 'A';
    user.age = -1;

    const sync = validateSync(user);
    const async = await validate(user);
    expect(flattenErrors(sync)).toEqual(flattenErrors(async));
    expect(Object.keys(flattenErrors(sync))).toEqual(['displayName', 'age']);
  });

  it('throws JsonValidationError on invalid input, like the async form', () => {
    expect(() => toInstanceSync(User, { display_name: 'A', age: 5 })).toThrow(JsonValidationError);
    expect(() => validateOrRejectSync(Object.assign(new User(), { displayName: 'A', age: 1 })))
      .toThrow(JsonValidationError);
  });

  it('honours options', () => {
    const lenient = toInstanceSync(User, { display_name: 'A', age: -1 }, { validate: false });
    expect(lenient.displayName).toBe('A');

    expect(() => toInstanceSync(User, { display_name: 'Ada', age: 1, stray: 1 }, { unknownKeys: 'error' }))
      .toThrow(/Unknown property "stray"/);
  });

  it('array entry points work synchronously', () => {
    class Item {
      @IsString()
      name: string;
    }
    expect(toInstanceArraySync(Item, [{ name: 'a' }])[0]!.name).toBe('a');
    expect(fromJsonArraySync(Item, '[{"name":"b"}]')[0]!.name).toBe('b');
    expect(() => toInstanceArraySync(Item, {} as any)).toThrow(JsonMappingError);
  });

  it('runs synchronous custom serializers and deserializers', () => {
    class Doc {
      @JsonSerialize(Upper)
      @JsonDeserialize(Lower)
      code: string;
    }
    const doc = toInstanceSync(Doc, { code: 'ABC' }, { validate: false });
    expect(doc.code).toBe('abc');
    expect(toPlainSync(doc)).toEqual({ code: 'ABC' });
  });

  it('handles nesting, cycles and depth the same way', () => {
    class Child { @IsString() name: string; }
    class Parent {
      @ValidateNested()
      @JsonType(() => Child)
      child: Child;
    }
    const parent = toInstanceSync(Parent, { child: { name: 'x' } });
    expect(parent.child).toBeInstanceOf(Child);

    const cyclic: any = new Parent();
    cyclic.child = cyclic;
    expect(() => toPlainSync(cyclic, { validate: false })).toThrow(/Circular reference/);
  });
});

describe('synchronous API refuses asynchronous hooks', () => {
  class SlowSerializer implements JsonSerializer<string, string> {
    async serialize(value: string): Promise<string> { return value.toUpperCase(); }
  }
  class SlowDeserializer implements JsonDeserializer<string, string> {
    async deserialize(value: string): Promise<string> { return value.toLowerCase(); }
  }

  it('reports a clear error for an async serializer and names the async alternative', () => {
    class Doc {
      @JsonSerialize(SlowSerializer)
      code: string;
    }
    const doc = new Doc();
    doc.code = 'abc';

    expect(() => toPlainSync(doc, { validate: false })).toThrow(JsonMappingError);
    expect(() => toPlainSync(doc, { validate: false })).toThrow(/toPlainSync\(\) requires every/);
    expect(() => toPlainSync(doc, { validate: false })).toThrow(/Use toPlain\(\) instead/);
  });

  it('reports a clear error for an async deserializer', () => {
    class Doc {
      @JsonDeserialize(SlowDeserializer)
      code: string;
    }
    expect(() => toInstanceSync(Doc, { code: 'ABC' }, { validate: false }))
      .toThrow(/toInstanceSync\(\) requires every/);
  });

  it('reports a clear error for an async validator', () => {
    class Doc {
      @Validate(async (v: any) => v === 'ok')
      code: string;
    }
    const doc = new Doc();
    doc.code = 'ok';
    expect(() => validateSync(doc)).toThrow(/validateSync\(\) requires every/);
  });

  it('does not leave an unhandled rejection behind when it refuses', async () => {
    class Exploding implements JsonSerializer<string, string> {
      serialize(): Promise<string> { return Promise.reject(new Error('boom')); }
    }
    class Doc {
      @JsonSerialize(Exploding)
      code: string;
    }
    const doc = new Doc();
    doc.code = 'x';

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(() => toPlainSync(doc, { validate: false })).toThrow(JsonMappingError);
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

describe('the async API still supports asynchronous hooks', () => {
  it('awaits an async serializer', async () => {
    class Slow implements JsonSerializer<string, string> {
      async serialize(value: string): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, 1));
        return value.toUpperCase();
      }
    }
    class Doc {
      @JsonSerialize(Slow)
      code: string;

      @IsString()
      other: string;
    }
    const doc = new Doc();
    doc.code = 'abc';
    doc.other = 'kept';

    await expect(toPlain(doc)).resolves.toEqual({ code: 'ABC', other: 'kept' });
    await expect(toJson(doc)).resolves.toBe('{"code":"ABC","other":"kept"}');
  });

  it('awaits an async deserializer, including inside a nested type', async () => {
    class Slow implements JsonDeserializer<string, Date> {
      async deserialize(value: string): Promise<Date> {
        await new Promise(resolve => setTimeout(resolve, 1));
        return new Date(value);
      }
    }
    class Child {
      @JsonDeserialize(Slow)
      at: Date;
    }
    class Parent {
      @JsonType(() => Child)
      child: Child;
    }

    const parent = await toInstance(Parent, { child: { at: '2026-01-01T00:00:00Z' } }, { validate: false });
    expect(parent.child.at).toBeInstanceOf(Date);
    expect(parent.child.at.getUTCFullYear()).toBe(2026);
  });

  it('awaits an async deserializer inside an array', async () => {
    class Slow implements JsonDeserializer<string, string> {
      async deserialize(value: string): Promise<string> { return value.toUpperCase(); }
    }
    class Row {
      @JsonDeserialize(Slow)
      code: string;
    }
    const rows = await toInstanceArray(Row, [{ code: 'a' }, { code: 'b' }], { validate: false });
    expect(rows.map(r => r.code)).toEqual(['A', 'B']);
  });

  it('awaits an async validator and reports its failure', async () => {
    class Doc {
      @Validate(async (v: any) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return v === 'ok';
      }, { message: 'must be ok' })
      code: string;
    }
    const doc = new Doc();

    doc.code = 'ok';
    await expect(validate(doc)).resolves.toEqual([]);

    doc.code = 'wrong';
    const errors = await validate(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.constraints['custom']).toBe('must be ok');
  });

  it('awaits an async validator under each: true and keeps the index', async () => {
    class Doc {
      @Validate(async (v: any) => v === 'ok', { each: true })
      codes: string[];
    }
    const doc = new Doc();

    doc.codes = ['ok', 'ok'];
    await expect(validate(doc)).resolves.toEqual([]);

    doc.codes = ['ok', 'ok', 'bad'];
    const errors = await validate(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.constraints['custom']).toContain('failed at index 2');
  });

  it('mixes sync and async validators on one object without losing either failure', async () => {
    class Doc {
      @IsString()
      name: any;

      @Validate(async (v: any) => v > 0, { message: 'must be positive' })
      amount: number;
    }
    const doc = new Doc();
    doc.name = 123;
    doc.amount = -5;

    const flat = flattenErrors(await validate(doc));
    expect(flat['name']).toEqual(['name must be a string']);
    expect(flat['amount']).toEqual(['must be positive']);
  });

  it('prunes provisional entries for async validators that pass', async () => {
    class Doc {
      @Validate(async () => true)
      a: string;

      @Validate(async () => true)
      b: string;
    }
    await expect(validate(new Doc())).resolves.toEqual([]);
  });

  it('validateOrReject still rejects on an async failure', async () => {
    class Doc {
      @Validate(async () => false)
      code: string;
    }
    await expect(validateOrReject(new Doc())).rejects.toThrow(JsonValidationError);
  });
});

describe('write-only redaction in validation errors', () => {
  it('redacts a @JsonWriteOnly value but keeps the failure message', async () => {
    class Credentials {
      @IsString()
      email: string;

      @JsonWriteOnly()
      @IsString()
      @MinLength(12)
      password: string;
    }

    const creds = new Credentials();
    creds.email = 'ada@example.com';
    creds.password = 'hunter2';

    const errors = await validate(creds);
    const failure = errors.find(e => e.property === 'password')!;

    expect(failure.value).toBe(REDACTED);
    expect(failure.constraints['minLength']).toContain('12');
    expect(JSON.stringify(errors)).not.toContain('hunter2');
  });

  it('redacts @JsonIgnore values too', async () => {
    class Record {
      @JsonIgnore()
      @IsString()
      internalSecret: any;
    }
    const record = new Record();
    record.internalSecret = 999;

    const errors = await validate(record);
    expect(errors[0]!.value).toBe(REDACTED);
    expect(JSON.stringify(errors)).not.toContain('999');
  });

  it('leaves ordinary property values in place', async () => {
    class Doc {
      @IsString()
      name: any;
    }
    const doc = new Doc();
    doc.name = 42;

    const errors = await validate(doc);
    expect(errors[0]!.value).toBe(42);
  });

  it('keeps the secret out of a thrown JsonValidationError', async () => {
    class SignUp {
      @JsonWriteOnly()
      @IsString()
      @MinLength(12)
      password: string;
    }

    await expect(toInstance(SignUp, { password: 'short' })).rejects.toThrow(JsonValidationError);
    try {
      await toInstance(SignUp, { password: 'short' });
    } catch (error) {
      expect(String((error as JsonValidationError).toString())).not.toContain('short');
    }
  });

  it('redacts in the synchronous path as well', () => {
    class Credentials {
      @JsonWriteOnly()
      @IsString()
      @MinLength(12)
      password: string;
    }
    const creds = new Credentials();
    creds.password = 'hunter2';

    expect(validateSync(creds)[0]!.value).toBe(REDACTED);
  });

  it('does not redact a value that merely sits next to a secret', async () => {
    class Form {
      @IsIn(['a', 'b'])
      choice!: 'a' | 'b';

      @JsonWriteOnly()
      @IsString()
      token: string;
    }
    const form = new Form();
    form.choice = 'zzz' as 'a';
    form.token = 'secret-token';

    const errors = await validate(form);
    expect(errors.find(e => e.property === 'choice')!.value).toBe('zzz');
    expect(JSON.stringify(errors)).not.toContain('secret-token');
  });
});
