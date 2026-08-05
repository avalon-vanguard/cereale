import { describe, it, expect } from 'vitest';
import {
  IsString, JsonIgnore, JsonSerialize, JsonSerializer, JsonMappingError,
  toPlain, toPlainSync, defineRule, modelOf, validateSync,
} from './index.js';

/**
 * Before 0.3.0 every case in this file produced `{}` (or index-keyed noise, or a bigint that
 * made the caller's own `JSON.stringify` throw somewhere unrelated) with nothing logged and
 * no error raised. A mapping layer that loses data quietly is worse than one that stops.
 */
describe('values JSON cannot carry', () => {
  class Basket {
    // Typed loosely on purpose: the point is what happens at runtime, and the decorators are
    // deliberately absent so nothing is claiming to handle these.
    items: any;
  }

  const withItems = (items: unknown) => Object.assign(new Basket(), { items });

  const cases: [string, unknown, RegExp][] = [
    ['a Map', new Map([['a', 1]]), /is a Map/],
    ['a Set', new Set([1, 2]), /is a Set/],
    ['a WeakMap', new WeakMap(), /is a WeakMap/],
    ['a WeakSet', new WeakSet(), /is a WeakSet/],
    ['a Promise', Promise.resolve(1), /is a Promise/],
    ['a RegExp', /abc/g, /is a RegExp/],
    ['an Error', new Error('boom'), /is an Error/],
    ['a TypeError', new TypeError('boom'), /is an Error/],
    ['an ArrayBuffer', new ArrayBuffer(8), /is an ArrayBuffer/],
    ['a DataView', new DataView(new ArrayBuffer(8)), /is a DataView/],
    ['a Uint8Array', new Uint8Array([1, 2, 3]), /is a Uint8Array/],
    ['a Float64Array', new Float64Array([1.5]), /is a Float64Array/],
    ['a bigint', 10n, /is a bigint/],
    ['a symbol', Symbol('x'), /is a symbol/],
    ['a function', () => 1, /is a function/],
  ];

  for (const [label, value, expected] of cases) {
    it(`refuses ${label}`, () => {
      expect(() => toPlainSync(withItems(value), { validate: false })).toThrow(JsonMappingError);
      expect(() => toPlainSync(withItems(value), { validate: false })).toThrow(expected);
    });
  }

  it('names the property in the message and points at the way out', () => {
    expect(() => toPlainSync(withItems(new Map()), { validate: false }))
      .toThrow(/items is a Map.*@JsonSerialize\(\).*@JsonIgnore\(\)/s);
  });

  it('names the full path through nested objects and arrays', () => {
    class Line { tags: any }
    class Order { lines: any }
    const order = Object.assign(new Order(), {
      lines: [Object.assign(new Line(), { tags: [] }), Object.assign(new Line(), { tags: [new Set(['a'])] })],
    });

    expect(() => toPlainSync(order, { validate: false })).toThrow(/lines\[1\]\.tags\[0\] is a Set/);
  });

  it('reports the root when the offending value is the argument itself', () => {
    expect(() => toPlainSync(new Map(), { validate: false })).toThrow(/the value passed in is a Map/);
  });

  it('still allows the built-ins that do map cleanly', () => {
    class Fine {
      when = new Date('2024-01-01T00:00:00.000Z');
      list = [1, 'two', true, null];
      nested = { deep: { deeper: [{ ok: true }] } };
      empty = {};
    }

    expect(toPlainSync(new Fine(), { validate: false })).toEqual({
      when: '2024-01-01T00:00:00.000Z',
      list: [1, 'two', true, null],
      nested: { deep: { deeper: [{ ok: true }] } },
      empty: {},
    });
  });

  it('accepts a Map once a serializer converts it', () => {
    class TagsSerializer implements JsonSerializer<Map<string, number>, Record<string, number>> {
      serialize(value: Map<string, number>) { return Object.fromEntries(value); }
    }

    class Post {
      @JsonSerialize(TagsSerializer)
      tags!: Map<string, number>;
    }

    const post = new Post();
    post.tags = new Map([['a', 1], ['b', 2]]);
    expect(toPlainSync(post, { validate: false })).toEqual({ tags: { a: 1, b: 2 } });
  });

  it('accepts a Map once the property is ignored', () => {
    class Cache {
      @IsString() name = 'x';
      @JsonIgnore() entries = new Map([['a', 1]]);
    }

    expect(toPlainSync(new Cache(), { validate: false })).toEqual({ name: 'x' });
  });

  it('refuses a serializer that hands back something unrepresentable', () => {
    class BadSerializer implements JsonSerializer<string, unknown> {
      serialize() { return new Set(['still a Set']); }
    }

    class Thing {
      @JsonSerialize(BadSerializer)
      label!: string;
    }

    const thing = new Thing();
    thing.label = 'x';
    expect(() => toPlainSync(thing, { validate: false })).toThrow(/label is a Set/);
  });

  it('refuses an async serializer that resolves to something unrepresentable', async () => {
    class SlowBadSerializer implements JsonSerializer<string, unknown> {
      async serialize() { return new Map([['a', 1]]); }
    }

    class Thing {
      @JsonSerialize(SlowBadSerializer)
      label!: string;
    }

    const thing = new Thing();
    thing.label = 'x';
    await expect(toPlain(thing, { validate: false })).rejects.toThrow(/label is a Map/);
  });
});

describe('serialization error paths', () => {
  it('names where the cycle was found', () => {
    class Node { name = 'root'; child: any = null; parent: any = null }
    const root = new Node();
    const child = new Node();
    child.name = 'child';
    child.parent = root;
    root.child = child;

    expect(() => toPlainSync(root, { validate: false })).toThrow(/at child\.parent/);
  });

  it('names where the depth limit was hit', () => {
    class Deep { next: any = null }
    const root = new Deep();
    let tip = root;
    for (let i = 0; i < 5; i++) {
      tip.next = new Deep();
      tip = tip.next;
    }

    expect(() => toPlainSync(root, { validate: false, maxDepth: 3 }))
      .toThrow(/exceeded while serializing at next\.next\.next/);
  });
});

describe('defineRule', () => {
  // `??=` on an inherited static symbol property finds the base class's metadata object and
  // never creates an own one, so the rule lands on the base and every sibling inherits it.
  it('does not write a subclass rule into its base class', () => {
    class Base {
      @IsString() name!: string;
    }
    class Sub extends Base { extra!: string }
    class Sibling extends Base { }

    defineRule(Sub, 'extra', {
      name: 'isShouty',
      validate: (v: any) => typeof v === 'string' && v === v.toUpperCase(),
      message: 'extra must be upper case',
    });

    expect(Object.keys(modelOf(Sub)).sort()).toEqual(['extra', 'name']);
    expect(Object.keys(modelOf(Base))).toEqual(['name']);
    expect(Object.keys(modelOf(Sibling))).toEqual(['name']);

    const sibling = Object.assign(new Sibling(), { name: 'ok' });
    expect(validateSync(sibling)).toEqual([]);
  });
});
