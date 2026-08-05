import { describe, it, expect } from 'vitest';
import {
  Equals, NotEquals, IsEmpty, IsEnum, IsInstance,
  Length, IsAlpha, IsAlphanumeric, IsNumberString, IsLowercase, IsUppercase,
  Contains, NotContains, StartsWith, EndsWith,
  IsUUID, IsJSON, IsDateString, IsSemVer, IsHexColor, IsIP,
  IsDivisibleBy, IsPort, IsLatitude, IsLongitude, IsBigInt,
  MinDate, MaxDate,
  ArrayUnique, ArrayContains, ArrayNotContains,
  ValidateIf, Allow, IsString, IsIn, IsOptional,
  validate, toInstance,
} from './index.js';

/**
 * Applies a decorator to a synthetic one-field class and reports which rules failed.
 *
 * Standard decorators are invoked as `(undefined, context)` rather than against a prototype,
 * so the context is built by hand here. Only `name` and `metadata` are read by the library;
 * the rest satisfies the shape.
 */
async function check(decorator: any, value: any): Promise<string[]> {
  const metadata = Object.create(null) as DecoratorMetadata;
  decorator(undefined, {
    kind: 'field',
    name: 'val',
    static: false,
    private: false,
    metadata,
    access: { has: () => true, get: (o: any) => o.val, set: (o: any, v: any) => { o.val = v; } },
    addInitializer: () => undefined,
  });

  class Subject {
    val: any;
  }
  (Subject as any)[Symbol.metadata] = metadata;

  const subject = new Subject();
  subject.val = value;

  const errors = await validate(subject);
  return errors.length ? Object.keys(errors[0]!.constraints) : [];
}

const passes = async (decorator: any, value: any) => expect(await check(decorator, value)).toEqual([]);
const fails = async (decorator: any, value: any) => expect((await check(decorator, value)).length).toBeGreaterThan(0);

describe('equality and presence', () => {
  it('@Equals / @NotEquals', async () => {
    await passes(Equals('x'), 'x');
    await fails(Equals('x'), 'y');
    await passes(NotEquals('x'), 'y');
    await fails(NotEquals('x'), 'x');
  });

  it('@IsEmpty', async () => {
    for (const empty of [null, undefined, '', [], {}]) await passes(IsEmpty(), empty);
    for (const filled of ['a', [1], { a: 1 }, 0]) await fails(IsEmpty(), filled);
  });

  it('@IsInstance', async () => {
    class Thing {}
    await passes(IsInstance(Thing), new Thing());
    await fails(IsInstance(Thing), {});
  });
});

describe('@IsEnum', () => {
  enum StringRole { Admin = 'admin', User = 'user' }
  enum NumericLevel { Low, High }

  it('accepts members of a string enum', async () => {
    await passes(IsEnum(StringRole), 'admin');
    await fails(IsEnum(StringRole), 'root');
  });

  it('accepts members of a numeric enum without accepting its reverse-mapped names', async () => {
    await passes(IsEnum(NumericLevel), 0);
    await passes(IsEnum(NumericLevel), 1);
    await fails(IsEnum(NumericLevel), 2);
    // 'Low' is the reverse mapping, not a legal value
    await fails(IsEnum(NumericLevel), 'Low');
  });
});

describe('strings', () => {
  it('@Length with and without a maximum', async () => {
    await passes(Length(2), 'ab');
    await fails(Length(3), 'ab');
    await passes(Length(2, 4), 'abc');
    await fails(Length(2, 4), 'abcde');
  });

  it('@IsAlpha / @IsAlphanumeric', async () => {
    await passes(IsAlpha(), 'abcDEF');
    await fails(IsAlpha(), 'abc1');
    await passes(IsAlphanumeric(), 'abc123');
    await fails(IsAlphanumeric(), 'abc-123');
  });

  it('@IsNumberString', async () => {
    await passes(IsNumberString(), '42');
    await passes(IsNumberString(), '-1.5');
    await fails(IsNumberString(), 'abc');
    await fails(IsNumberString(), '');
    await fails(IsNumberString(), 42);
  });

  it('@IsLowercase / @IsUppercase', async () => {
    await passes(IsLowercase(), 'abc');
    await fails(IsLowercase(), 'Abc');
    await passes(IsUppercase(), 'ABC');
    await fails(IsUppercase(), 'Abc');
  });

  it('@Contains / @NotContains / @StartsWith / @EndsWith', async () => {
    await passes(Contains('ell'), 'hello');
    await fails(Contains('xyz'), 'hello');
    await passes(NotContains('xyz'), 'hello');
    await fails(NotContains('ell'), 'hello');
    await passes(StartsWith('he'), 'hello');
    await fails(StartsWith('lo'), 'hello');
    await passes(EndsWith('lo'), 'hello');
    await fails(EndsWith('he'), 'hello');
  });
});

describe('@IsUUID', () => {
  const v4 = '9b2e4c1a-77bd-4f2e-8c33-1d9a6b0e5f21';

  it('accepts any version when unversioned', async () => {
    await passes(IsUUID(), v4);
    await passes(IsUUID(), '00000000-0000-0000-0000-000000000000'); // nil
    await fails(IsUUID(), 'not-a-uuid');
    await fails(IsUUID(), 42);
  });

  it('enforces a requested version', async () => {
    await passes(IsUUID(4), v4);
    await fails(IsUUID(1), v4);
  });
});

describe('formats', () => {
  it('@IsJSON', async () => {
    await passes(IsJSON(), '{"a":1}');
    await passes(IsJSON(), '[1,2]');
    await fails(IsJSON(), '{a:1}');
    await fails(IsJSON(), { a: 1 });
  });

  it('@IsDateString', async () => {
    await passes(IsDateString(), '2026-08-03T00:00:00Z');
    await fails(IsDateString(), 'not a date');
  });

  it('@IsSemVer', async () => {
    await passes(IsSemVer(), '1.2.3');
    await passes(IsSemVer(), '1.0.0-alpha.1+build.5');
    await fails(IsSemVer(), '1.2');
    await fails(IsSemVer(), 'v1.2.3');
  });

  it('@IsHexColor', async () => {
    await passes(IsHexColor(), '#fff');
    await passes(IsHexColor(), '#A1B2C3');
    await passes(IsHexColor(), '#A1B2C3FF');
    await fails(IsHexColor(), 'fff');
    await fails(IsHexColor(), '#ggg');
  });

  it('@IsIP', async () => {
    await passes(IsIP(4), '192.168.0.1');
    await fails(IsIP(4), '256.0.0.1');
    await fails(IsIP(4), '::1');
    await passes(IsIP(6), '::1');
    await passes(IsIP(), '10.0.0.1');
    await fails(IsIP(), 'nope');
  });
});

describe('numbers', () => {
  it('@IsDivisibleBy', async () => {
    await passes(IsDivisibleBy(5), 10);
    await fails(IsDivisibleBy(5), 11);
    await fails(IsDivisibleBy(5), '10');
  });

  it('@IsPort', async () => {
    await passes(IsPort(), 8080);
    await passes(IsPort(), '443');
    await fails(IsPort(), 70000);
    await fails(IsPort(), -1);
    await fails(IsPort(), 1.5);
  });

  it('@IsLatitude / @IsLongitude', async () => {
    await passes(IsLatitude(), 48.85);
    await fails(IsLatitude(), 91);
    await passes(IsLongitude(), 2.35);
    await fails(IsLongitude(), 181);
  });

  it('@IsBigInt', async () => {
    await passes(IsBigInt(), 10n);
    await fails(IsBigInt(), 10);
  });
});

describe('dates', () => {
  it('@MinDate / @MaxDate with a fixed bound', async () => {
    const bound = new Date('2026-01-01T00:00:00Z');
    await passes(MinDate(bound), new Date('2026-06-01T00:00:00Z'));
    await fails(MinDate(bound), new Date('2025-06-01T00:00:00Z'));
    await passes(MaxDate(bound), new Date('2025-06-01T00:00:00Z'));
    await fails(MaxDate(bound), new Date('2026-06-01T00:00:00Z'));
  });

  it('@MinDate accepts a thunk so the bound moves', async () => {
    await passes(MinDate(() => new Date(Date.now() - 1000)), new Date());
    await fails(MinDate(() => new Date(Date.now() + 60_000)), new Date());
  });

  it('rejects a non-date', async () => {
    await fails(MinDate(new Date(0)), '2026-01-01');
  });
});

describe('arrays', () => {
  it('@ArrayUnique by value', async () => {
    await passes(ArrayUnique(), [1, 2, 3]);
    await fails(ArrayUnique(), [1, 2, 2]);
  });

  it('@ArrayUnique by extracted key', async () => {
    const byId = (item: any) => item.id;
    await passes(ArrayUnique(byId), [{ id: 1 }, { id: 2 }]);
    await fails(ArrayUnique(byId), [{ id: 1 }, { id: 1 }]);
  });

  it('@ArrayContains / @ArrayNotContains', async () => {
    await passes(ArrayContains(['a']), ['a', 'b']);
    await fails(ArrayContains(['c']), ['a', 'b']);
    await passes(ArrayNotContains(['c']), ['a', 'b']);
    await fails(ArrayNotContains(['a']), ['a', 'b']);
  });
});

describe('@ValidateIf', () => {
  class Payment {
    @IsIn(['card', 'invoice'])
    method!: 'card' | 'invoice';

    @ValidateIf<Payment>(o => o.method === 'card')
    @IsString()
    cardNumber?: string;
  }

  it('skips the constraint when the condition is false', async () => {
    const p = new Payment();
    p.method = 'invoice';
    expect(await validate(p)).toEqual([]);
  });

  it('applies the constraint when the condition is true', async () => {
    const p = new Payment();
    p.method = 'card';

    const errors = await validate(p);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('cardNumber');
  });

  it('passes when the condition is true and the value is valid', async () => {
    const p = new Payment();
    p.method = 'card';
    p.cardNumber = '4111111111111111';
    expect(await validate(p)).toEqual([]);
  });
});

describe('@Allow', () => {
  it('declares a property so strict unknown-key policies keep it', async () => {
    class Dto {
      @IsString()
      name: string;

      @Allow()
      metadata: unknown;
    }

    const d = await toInstance(
      Dto,
      { name: 'x', metadata: { anything: true }, stray: 1 },
      { unknownKeys: 'strip' }
    );
    expect(d.metadata).toEqual({ anything: true });
    expect((d as any).stray).toBeUndefined();
  });
});

describe('new validators cooperate with existing options', () => {
  it('honours each: true', async () => {
    class T {
      @IsUUID(4, { each: true })
      ids: string[];
    }
    const t = new T();
    t.ids = ['9b2e4c1a-77bd-4f2e-8c33-1d9a6b0e5f21'];
    expect(await validate(t)).toEqual([]);

    t.ids = ['9b2e4c1a-77bd-4f2e-8c33-1d9a6b0e5f21', 'nope'];
    expect(await validate(t)).toHaveLength(1);
  });

  it('honours @IsOptional', async () => {
    class T {
      @IsOptional()
      @IsSemVer()
      version?: string;
    }
    const t = new T();
    expect(await validate(t)).toEqual([]);

    t.version = 'bad';
    expect(await validate(t)).toHaveLength(1);
  });

  it('honours a custom message', async () => {
    class T {
      @IsPort({ message: 'give me a real port' })
      port: number;
    }
    const t = new T();
    t.port = -1;

    const errors = await validate(t);
    expect(errors[0]!.constraints['isPort']).toBe('give me a real port');
  });
});
