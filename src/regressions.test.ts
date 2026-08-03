import { describe, it, expect } from 'vitest';
import {
  IsString, IsInt, Min, MinLength, Matches, IsIn, ValidateNested, JsonType,
  JsonPolymorphic, JsonSerialize, JsonSerializer, JsonMappingError,
  toInstance, toInstanceArray, toPlain, toJson, fromJson, fromJsonArray, fromRequest, validate,
} from './index.js';

/**
 * Each block here pins down a defect that the engine used to have. The comment above the
 * block describes the old, wrong behaviour.
 */
describe('regressions', () => {
  describe('inheritance', () => {
    // Was: a subclass re-decorating an inherited property registered its constraints on its
    // own prototype, and the engine read only the nearest set — so every rule the base class
    // declared was silently dropped.
    it('merges validation constraints across the prototype chain', async () => {
      class Base {
        @MinLength(5)
        name: string;
      }
      class Sub extends Base {
        @IsString()
        declare name: string;
      }

      const s = new Sub();
      s.name = 'ab'; // satisfies Sub's @IsString, violates Base's @MinLength(5)

      const errors = await validate(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.constraints).toHaveProperty('minLength');
    });

    it('enforces base constraints that the subclass never restates', async () => {
      abstract class Media {
        @IsString()
        title: string;
      }
      class Book extends Media {
        @IsString()
        author: string;
      }

      const b = new Book();
      b.title = 42 as any;
      b.author = 'Fitzgerald';

      const errors = await validate(b);
      expect(errors.map(e => e.property)).toContain('title');
    });

    it('does not report an identical inherited rule twice', async () => {
      class Base {
        @IsString()
        type: string;
      }
      class Sub extends Base {
        @IsString()
        declare type: string;
      }

      const s = new Sub();
      s.type = 1 as any;

      const errors = await validate(s);
      expect(errors).toHaveLength(1);
      expect(Object.keys(errors[0]!.constraints)).toEqual(['isString']);
    });
  });

  describe('cycles', () => {
    // Was: serialize() recursed forever on a cycle, exhausting an 8 GB heap and killing the
    // process. A clear error beats an OOM.
    it('reports a circular reference instead of exhausting the heap', async () => {
      class Node {
        @IsString()
        name: string;
        next?: any;
      }
      const a = new Node();
      a.name = 'a';
      a.next = a;

      await expect(toPlain(a)).rejects.toThrow(JsonMappingError);
      await expect(toPlain(a)).rejects.toThrow(/Circular reference/);
    });

    it('still serializes a diamond, where one object is referenced twice', async () => {
      class Leaf {
        @IsString()
        id: string;
      }
      class Holder {
        left: Leaf;
        right: Leaf;
      }

      const shared = new Leaf();
      shared.id = 'shared';
      const h = new Holder();
      h.left = shared;
      h.right = shared;

      const plain = await toPlain(h);
      expect(plain).toEqual({ left: { id: 'shared' }, right: { id: 'shared' } });
    });

    it('terminates when validating a cyclic @ValidateNested graph', async () => {
      class Person {
        @IsString()
        name: string;

        @ValidateNested()
        friend?: Person;
      }

      const a = new Person();
      a.name = 'a';
      const b = new Person();
      b.name = 'b';
      a.friend = b;
      b.friend = a;

      await expect(validate(a)).resolves.toEqual([]);
    });
  });

  describe('messages', () => {
    // Was: the "each element in ..." prefix was glued onto every message, including ones the
    // caller wrote, producing "each element in tags must all be strings".
    it('reports a caller-supplied message verbatim under each:true', async () => {
      class T {
        @IsString({ each: true, message: 'tags must all be strings' })
        tags: any[];
      }
      const t = new T();
      t.tags = [1];

      const errors = await validate(t);
      expect(errors[0]!.constraints['isString']).toBe('tags must all be strings');
    });

    it('still prefixes the library default message under each:true', async () => {
      class T {
        @IsString({ each: true })
        tags: any[];
      }
      const t = new T();
      t.tags = [1];

      const errors = await validate(t);
      expect(errors[0]!.constraints['isString']).toContain('each element in');
    });

    // Was: two constraints sharing a name overwrote each other in the error record, so only
    // the last failure was ever reported.
    it('keeps every failure when two rules share a name', async () => {
      class T {
        @Min(10)
        @Min(5)
        n: number;
      }
      const t = new T();
      t.n = 1;

      const errors = await validate(t);
      const messages = Object.values(errors[0]!.constraints);
      expect(messages).toHaveLength(2);
      expect(messages).toEqual(expect.arrayContaining([
        'n must be at least 5',
        'n must be at least 10',
      ]));
    });
  });

  describe('@Matches', () => {
    // Was: a /g regex kept its lastIndex between calls, so validating the same value twice
    // gave different answers — the second call spuriously failed.
    it('is stateless when the pattern carries a g flag', async () => {
      class T {
        @Matches(/^[a-z]+$/g)
        v: string;
      }
      const t = new T();
      t.v = 'abc';

      expect(await validate(t)).toHaveLength(0);
      expect(await validate(t)).toHaveLength(0);
      expect(await validate(t)).toHaveLength(0);
    });

    it('is stateless when the pattern carries a y flag', async () => {
      class T {
        @Matches(/^[a-z]+$/y)
        v: string;
      }
      const t = new T();
      t.v = 'abc';

      expect(await validate(t)).toHaveLength(0);
      expect(await validate(t)).toHaveLength(0);
    });
  });

  describe('@JsonPolymorphic', () => {
    abstract class Animal {
      @IsString()
      type: string;
    }
    class Dog extends Animal {
      @IsString()
      breed: string;
    }

    // Was: when the discriminator matched no subtype, the single-object branch fell through
    // without assigning anything, so the property came back `undefined` and the caller's data
    // vanished without a word.
    it('keeps the raw value when the discriminator matches nothing', async () => {
      class Holder {
        @JsonPolymorphic('type', [{ value: Dog, name: 'dog' }])
        pet: Animal;
      }

      const h = await toInstance(Holder, { pet: { type: 'cat', sound: 'meow' } });
      expect(h.pet).toBeDefined();
      expect(h.pet).toEqual({ type: 'cat', sound: 'meow' });
    });

    it('can be told to reject an unknown discriminator instead', async () => {
      class Holder {
        @JsonPolymorphic('type', [{ value: Dog, name: 'dog' }], { onUnknown: 'error' })
        pet: Animal;
      }

      await expect(toInstance(Holder, { pet: { type: 'cat' } })).rejects.toThrow(JsonMappingError);
      await expect(toInstance(Holder, { pet: { type: 'cat' } })).rejects.toThrow(/Unknown discriminator/);
    });

    it('can fall back to a default subtype', async () => {
      class Unknown extends Animal {
        @IsString()
        override type = 'unknown';
      }
      class Holder {
        @JsonPolymorphic('type', [{ value: Dog, name: 'dog' }], { fallback: Unknown })
        pet: Animal;
      }

      const h = await toInstance(Holder, { pet: { type: 'cat' } });
      expect(h.pet).toBeInstanceOf(Unknown);
    });

    it('keeps unmatched entries inside an array', async () => {
      class Holder {
        @JsonPolymorphic('type', [{ value: Dog, name: 'dog' }])
        pets: Animal[];
      }

      const h = await toInstance(Holder, {
        pets: [{ type: 'dog', breed: 'Lab' }, { type: 'cat', sound: 'meow' }],
      });
      expect(h.pets[0]).toBeInstanceOf(Dog);
      expect(h.pets[1]).toEqual({ type: 'cat', sound: 'meow' });
    });
  });

  describe('prototype handling', () => {
    // Was: serialize() read `obj.constructor.prototype`, which throws for an object created
    // with a null prototype because it has no `constructor`.
    it('serializes a null-prototype object', async () => {
      const o = Object.create(null);
      o.a = 1;
      o.b = { c: 2 };

      await expect(toPlain(o)).resolves.toEqual({ a: 1, b: { c: 2 } });
    });

    // Was: `__proto__` arriving in a JSON body was copied straight onto the instance, which
    // swaps the instance's prototype and detaches it from its own class.
    it('drops __proto__ from untrusted input', async () => {
      class Dto {
        @IsString()
        name: string;
      }

      const malicious = JSON.parse('{"name":"x","__proto__":{"polluted":"yes"}}');
      const dto = await toInstance(Dto, malicious);

      expect(dto).toBeInstanceOf(Dto);
      expect(Object.getPrototypeOf(dto)).toBe(Dto.prototype);
      expect(({} as any).polluted).toBeUndefined();
    });

    it('drops constructor and prototype keys from untrusted input', async () => {
      class Dto {
        @IsString()
        name: string;
      }

      const dto = await toInstance(Dto, JSON.parse('{"name":"x","constructor":1,"prototype":2}'));
      expect(dto.constructor).toBe(Dto);
      expect((dto as any).prototype).toBeUndefined();
    });
  });

  describe('custom serializers', () => {
    // Was: a @JsonSerialize serializer was invoked even when the property was null or
    // undefined, so any serializer that touched the value crashed on an unset optional field.
    it('is skipped for an unset optional property', async () => {
      class IsoDate implements JsonSerializer<Date, string> {
        serialize(value: Date): string {
          return value.toISOString();
        }
      }
      class T {
        @JsonSerialize(IsoDate)
        when?: Date | undefined;

        @IsString()
        other: string;
      }

      const t = new T();
      t.other = 'x';
      t.when = undefined;

      await expect(toPlain(t)).resolves.toEqual({ when: undefined, other: 'x' });
    });

    it('still runs for a property that has a value', async () => {
      class IsoDate implements JsonSerializer<Date, string> {
        serialize(value: Date): string {
          return value.toISOString().slice(0, 10);
        }
      }
      class T {
        @JsonSerialize(IsoDate)
        when: Date;
      }

      const t = new T();
      t.when = new Date('1925-04-10T00:00:00Z');

      await expect(toJson(t)).resolves.toBe('{"when":"1925-04-10"}');
    });
  });

  describe('array entry points', () => {
    class Item {
      @IsString()
      name: string;
    }

    // Was: `toInstance`/`fromJson` accepted arrays at runtime but typed the result as `T`,
    // so consumers had to cast to reach the elements.
    it('toInstanceArray returns a correctly typed array', async () => {
      const items = await toInstanceArray(Item, [{ name: 'a' }, { name: 'b' }]);
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(Item);
      expect(items[0]!.name).toBe('a');
    });

    it('fromJsonArray parses and validates a JSON array', async () => {
      const items = await fromJsonArray(Item, '[{"name":"a"}]');
      expect(items[0]!.name).toBe('a');
    });

    it('toInstanceArray rejects a non-array payload', async () => {
      await expect(toInstanceArray(Item, {} as any)).rejects.toThrow(JsonMappingError);
    });

    it('fromJson still accepts an array for backwards compatibility', async () => {
      const items = (await fromJson(Item, '[{"name":"a"}]')) as unknown as Item[];
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('fromRequest', () => {
    it('reports a non-JSON body as a mapping error', async () => {
      class Dto {
        @IsString()
        name: string;
      }
      const request = new Request('https://example.com', { method: 'POST', body: 'not json' });

      await expect(fromRequest(Dto, request)).rejects.toThrow(JsonMappingError);
      await expect(
        fromRequest(Dto, new Request('https://example.com', { method: 'POST', body: '' }))
      ).rejects.toThrow(/not valid JSON/);
    });
  });

  describe('@ValidateNested', () => {
    it('accepts the documented { each: true } option', async () => {
      class Item {
        @IsInt()
        @Min(1)
        qty: number;
      }
      class Order {
        @ValidateNested({ each: true })
        @JsonType(() => Item)
        items: Item[];
      }

      const bad = new Item();
      bad.qty = -5;
      const o = new Order();
      o.items = [bad];

      const errors = await validate(o);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.children?.[0]?.children?.[0]?.property).toBe('qty');
    });

    it('{ each: true } asserts the value really is an array', async () => {
      class Item {
        @IsInt()
        qty: number;
      }
      class Order {
        @ValidateNested({ each: true })
        items: Item[];
      }

      const o = new Order();
      o.items = 'nope' as any;

      const errors = await validate(o);
      expect(errors[0]!.constraints).toHaveProperty('nestedEach');
    });
  });

  describe('@IsIn with each:true', () => {
    it('rejects a non-array value rather than passing it through', async () => {
      class T {
        @IsIn(['a', 'b'], { each: true })
        tags: any;
      }
      const t = new T();
      t.tags = 'not-allowed';

      expect(await validate(t)).toHaveLength(1);
    });
  });
});
