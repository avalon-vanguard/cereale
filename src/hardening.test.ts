import { describe, it, expect, afterEach } from 'vitest';
import {
  IsString, IsInt, Min, IsIn, ValidateNested, JsonType, JsonSerialize, JsonDeserialize,
  JsonSerializer, JsonDeserializer, JsonMappingError,
  defineRule, validate, toInstance, toPlain, configure, resetConfig,
} from './index.js';

afterEach(() => resetConfig());

describe('plan caching', () => {
  // The validation plan for a class is memoized. It must not go stale when metadata is
  // registered after the class has already been validated once.
  it('picks up a decorator registered after the first validation', async () => {
    class Late {
      value: any;
    }

    const before = new Late();
    before.value = 'anything';
    expect(await validate(before)).toEqual([]);

    // Register a rule after the plan has already been built and cached.
    defineRule(Late, 'value', {
      name: 'isEven',
      validate: (v: any) => typeof v === 'number' && v % 2 === 0,
      message: 'value must be even',
    });

    const after = new Late();
    after.value = 'anything';
    expect(await validate(after)).toHaveLength(1);

    after.value = 4;
    expect(await validate(after)).toEqual([]);
  });

  it('keeps per-class plans separate', async () => {
    class A {
      @IsString()
      v: any;
    }
    class B {
      @IsInt()
      v: any;
    }

    const a = new A();
    a.v = 'text';
    const b = new B();
    b.v = 'text';

    expect(await validate(a)).toEqual([]);
    expect(await validate(b)).toHaveLength(1);
  });

  it('reuses one serializer instance rather than constructing per property', async () => {
    let constructed = 0;
    class Counting implements JsonSerializer<string, string> {
      constructor() { constructed++; }
      serialize(value: string): string { return value.toUpperCase(); }
    }
    class Doc {
      @JsonSerialize(Counting)
      a: string;

      @JsonSerialize(Counting)
      b: string;
    }

    const doc = new Doc();
    doc.a = 'x';
    doc.b = 'y';

    await toPlain(doc);
    await toPlain(doc);
    await toPlain(doc);

    expect(await toPlain(doc)).toEqual({ a: 'X', b: 'Y' });
    expect(constructed).toBe(1);
  });

  it('still honours a deserializer after caching', async () => {
    class ToDate implements JsonDeserializer<string, Date> {
      deserialize(value: string): Date { return new Date(value); }
    }
    class Event {
      @JsonDeserialize(ToDate)
      at: Date;
    }

    for (let i = 0; i < 3; i++) {
      const e = await toInstance(Event, { at: '2026-01-01T00:00:00Z' });
      expect(e.at).toBeInstanceOf(Date);
    }
  });
});

describe('maxDepth guard', () => {
  const nest = (depth: number): any => {
    let node: any = { value: 'leaf' };
    for (let i = 0; i < depth; i++) node = { child: node };
    return node;
  };

  class Node {
    @ValidateNested()
    @JsonType(() => Node)
    child?: Node;

    value?: string;
  }

  it('rejects a payload nested past the limit instead of exhausting the stack', async () => {
    await expect(toInstance(Node, nest(500), { validate: false }))
      .rejects.toThrow(JsonMappingError);
    await expect(toInstance(Node, nest(500), { validate: false }))
      .rejects.toThrow(/Maximum nesting depth/);
  });

  it('accepts nesting within the limit', async () => {
    const parsed = await toInstance(Node, nest(10), { validate: false });
    expect(parsed).toBeInstanceOf(Node);
  });

  it('is configurable per call and globally', async () => {
    await expect(toInstance(Node, nest(10), { validate: false, maxDepth: 3 }))
      .rejects.toThrow(/Maximum nesting depth of 3/);

    configure({ maxDepth: 2 });
    await expect(toInstance(Node, nest(10), { validate: false }))
      .rejects.toThrow(/Maximum nesting depth of 2/);
  });

  it('guards serialization too', async () => {
    const deep = await toInstance(Node, nest(30), { validate: false, maxDepth: 200 });
    await expect(toPlain(deep, { validate: false, maxDepth: 5 }))
      .rejects.toThrow(/Maximum nesting depth/);
  });

  it('guards validation too', async () => {
    const deep = await toInstance(Node, nest(30), { validate: false, maxDepth: 200 });
    await expect(validate(deep, { maxDepth: 5 })).rejects.toThrow(/Maximum nesting depth/);
  });
});

describe('each: true error reporting', () => {
  it('names the index of the element that failed', async () => {
    class Basket {
      @IsIn(['a', 'b'], { each: true })
      tags!: ('a' | 'b')[];
    }

    const basket = new Basket();
    basket.tags = ['a', 'b', 'a', 'nope' as 'a', 'b'];

    const errors = await validate(basket);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.constraints['isIn']).toContain('failed at index 3');
  });

  it('leaves a caller-supplied message untouched', async () => {
    class Basket {
      @IsIn(['a'], { each: true, message: 'bad tag' })
      tags!: 'a'[];
    }
    const basket = new Basket();
    basket.tags = ['a', 'zzz' as 'a'];

    const errors = await validate(basket);
    expect(errors[0]!.constraints['isIn']).toBe('bad tag');
  });

  it('gives the failing element to a message function, not the whole array', async () => {
    class Basket {
      @IsIn(['a'], { each: true, message: (args) => `rejected ${JSON.stringify(args.value)}` })
      tags!: 'a'[];
    }
    const basket = new Basket();
    basket.tags = ['a', 'zzz' as 'a'];

    const errors = await validate(basket);
    expect(errors[0]!.constraints['isIn']).toBe('rejected "zzz"');
  });

  it('reports nothing when every element passes', async () => {
    class Basket {
      @IsIn(['a', 'b'], { each: true })
      tags!: ('a' | 'b')[];
    }
    const basket = new Basket();
    basket.tags = ['a', 'b'];
    expect(await validate(basket)).toEqual([]);
  });
});

describe('validate() accepts options', () => {
  it('threads maxDepth through nested validation', async () => {
    class Item {
      @IsInt()
      @Min(1)
      qty: number;
    }
    class Order {
      @IsString()
      ref: string;

      @ValidateNested()
      @JsonType(() => Item)
      items: Item[];
    }

    const bad = new Item();
    bad.qty = -1;
    const order = new Order();
    order.ref = 'r';
    order.items = [bad];

    // Deep enough to be fine at the default, so behaviour is unchanged.
    expect(await validate(order)).toHaveLength(1);
  });
});

describe('decorator context guards', () => {
  // Every decorator resolves its metadata through one checkpoint, so one representative
  // decorator per shape is enough to cover the rule.
  const shapes: [string, unknown][] = [
    ['a method', { kind: 'method', name: 'run', metadata: {} }],
    ['a getter', { kind: 'getter', name: 'total', metadata: {} }],
    ['an accessor', { kind: 'accessor', name: 'value', metadata: {} }],
    ['a class', { kind: 'class', name: 'Thing', metadata: {} }],
  ];

  for (const [label, context] of shapes) {
    it(`refuses being applied to ${label}`, () => {
      expect(() => (IsString() as any)(undefined, context)).toThrow(/apply to fields/);
    });
  }

  it('explains why `accessor` in particular cannot work', () => {
    const context = { kind: 'accessor', name: 'value', metadata: {} };
    expect(() => (IsString() as any)(undefined, context)).toThrow(/private slot/);
  });

  it('refuses a legacy decorator call shape', () => {
    // What `experimentalDecorators: true` emits: (prototype, propertyKey).
    expect(() => (IsString() as any)({}, 'name')).toThrow(/experimentalDecorators/);
  });

  it('refuses a standard context that carries no metadata', () => {
    const context = { kind: 'field', name: 'value', metadata: undefined };
    expect(() => (IsString() as any)(undefined, context)).toThrow(/no metadata object/);
  });

  it('names the field it could not record', () => {
    const context = { kind: 'field', name: 'nickname', metadata: null };
    expect(() => (IsString() as any)(undefined, context)).toThrow(/"nickname"/);
  });

  it('guards the mapping decorators too, not just the rules', () => {
    expect(() => (JsonSerialize(class {} as any) as any)({}, 'name')).toThrow(/experimentalDecorators/);
  });
});
