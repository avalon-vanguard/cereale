import { describe, it, expect, afterEach } from 'vitest';
import {
  IsString, IsInt, IsOptional, ValidateNested, Min,
  JsonProperty, JsonAlias, JsonIgnore, JsonReadOnly, JsonWriteOnly, JsonType,
  JsonMappingError, JsonValidationError,
  toPlain, toJson, toInstance, fromJson, validate, validateOrReject,
  configure, resetConfig, getConfig,
  flattenErrors, formatErrors, collectErrorMessages,
  resolveNamingStrategy,
} from './index.js';

afterEach(() => resetConfig());

describe('@JsonProperty', () => {
  class User {
    @JsonProperty('first_name')
    @IsString()
    firstName: string;

    @JsonProperty('last_name')
    @IsString()
    lastName: string;
  }

  it('renames on the way out', async () => {
    const u = new User();
    u.firstName = 'Ada';
    u.lastName = 'Lovelace';

    await expect(toPlain(u)).resolves.toEqual({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  it('renames on the way in', async () => {
    const u = await fromJson(User, '{"first_name":"Ada","last_name":"Lovelace"}');
    expect(u.firstName).toBe('Ada');
    expect(u.lastName).toBe('Lovelace');
  });

  it('round-trips', async () => {
    const json = '{"first_name":"Ada","last_name":"Lovelace"}';
    expect(await toJson(await fromJson(User, json))).toBe(json);
  });

  it('no longer accepts the raw property name once renamed', async () => {
    const u = await toInstance(
      User,
      { firstName: 'Ada', last_name: 'L' },
      { unknownKeys: 'strip', validate: false }
    );
    expect(u.firstName).toBeUndefined();
    expect(u.lastName).toBe('L');
  });

  it('rejects two properties claiming the same JSON name', async () => {
    class Clash {
      @JsonProperty('name')
      a: string;

      @JsonProperty('name')
      b: string;
    }

    await expect(toInstance(Clash, { name: 'x' })).rejects.toThrow(JsonMappingError);
    await expect(toInstance(Clash, { name: 'x' })).rejects.toThrow(/both map to the JSON name/);
  });
});

describe('@JsonAlias', () => {
  class Person {
    @JsonProperty('surname')
    @JsonAlias('last_name', 'lastName')
    @IsString()
    surname: string;
  }

  it('accepts every alias on input', async () => {
    for (const key of ['surname', 'last_name', 'lastName']) {
      const p = await toInstance(Person, { [key]: 'Hopper' });
      expect(p.surname).toBe('Hopper');
    }
  });

  it('never emits an alias on output', async () => {
    const p = new Person();
    p.surname = 'Hopper';
    await expect(toPlain(p)).resolves.toEqual({ surname: 'Hopper' });
  });
});

describe('access control decorators', () => {
  it('@JsonIgnore drops the property in both directions', async () => {
    class Secretive {
      @IsString()
      name: string;

      @JsonIgnore()
      internalNote: string;
    }

    const s = new Secretive();
    s.name = 'x';
    s.internalNote = 'do not leak';
    await expect(toPlain(s)).resolves.toEqual({ name: 'x' });

    const parsed = await toInstance(Secretive, { name: 'x', internalNote: 'injected' });
    expect(parsed.internalNote).toBeUndefined();
  });

  it('@JsonWriteOnly accepts input but never echoes it back', async () => {
    class Credentials {
      @IsString()
      email: string;

      @JsonWriteOnly()
      @IsString()
      password: string;
    }

    const c = await toInstance(Credentials, { email: 'a@b.com', password: 'hunter2' });
    expect(c.password).toBe('hunter2');
    await expect(toPlain(c)).resolves.toEqual({ email: 'a@b.com' });
  });

  it('@JsonReadOnly is emitted but cannot be set by a client', async () => {
    class Record {
      @JsonReadOnly()
      id: number;

      @IsString()
      title: string;
    }

    const r = await toInstance(Record, { id: 999, title: 'hello' });
    expect(r.id).toBeUndefined();

    r.id = 1;
    await expect(toPlain(r)).resolves.toEqual({ id: 1, title: 'hello' });
  });

  it('@JsonReadOnly is not resurrected by the default unknownKeys policy', async () => {
    class Record {
      @JsonProperty('identifier')
      @JsonReadOnly()
      id: number;

      @IsString()
      title: string;
    }

    const r = await toInstance(Record, { identifier: 999, title: 't' }, { unknownKeys: 'allow' });
    expect(r.id).toBeUndefined();
    expect((r as any).identifier).toBeUndefined();
  });
});

describe('naming strategies', () => {
  class Account {
    @IsString()
    accountHolderName: string;

    @IsInt()
    balanceInCents: number;
  }

  it('snake_case both ways', async () => {
    const a = new Account();
    a.accountHolderName = 'Ada';
    a.balanceInCents = 100;

    const plain = await toPlain(a, { namingStrategy: 'snake_case' });
    expect(plain).toEqual({ account_holder_name: 'Ada', balance_in_cents: 100 });

    const back = await toInstance(Account, plain, { namingStrategy: 'snake_case' });
    expect(back.accountHolderName).toBe('Ada');
    expect(back.balanceInCents).toBe(100);
  });

  it('kebab-case, SCREAMING_SNAKE_CASE and PascalCase', async () => {
    const a = new Account();
    a.accountHolderName = 'Ada';
    a.balanceInCents = 1;

    await expect(toPlain(a, { namingStrategy: 'kebab-case' }))
      .resolves.toEqual({ 'account-holder-name': 'Ada', 'balance-in-cents': 1 });
    await expect(toPlain(a, { namingStrategy: 'SCREAMING_SNAKE_CASE' }))
      .resolves.toEqual({ ACCOUNT_HOLDER_NAME: 'Ada', BALANCE_IN_CENTS: 1 });
    await expect(toPlain(a, { namingStrategy: 'PascalCase' }))
      .resolves.toEqual({ AccountHolderName: 'Ada', BalanceInCents: 1 });
  });

  it('accepts a custom function', async () => {
    const a = new Account();
    a.accountHolderName = 'Ada';
    a.balanceInCents = 1;

    await expect(toPlain(a, { namingStrategy: (k) => `x_${k}` }))
      .resolves.toEqual({ x_accountHolderName: 'Ada', x_balanceInCents: 1 });
  });

  it('@JsonProperty wins over the naming strategy', async () => {
    class Mixed {
      @JsonProperty('EXPLICIT')
      someField: string;

      otherField: string;
    }
    const m = new Mixed();
    m.someField = 'a';
    m.otherField = 'b';

    await expect(toPlain(m, { namingStrategy: 'snake_case' }))
      .resolves.toEqual({ EXPLICIT: 'a', other_field: 'b' });
  });

  it('splits acronyms the way a reader expects', () => {
    const snake = resolveNamingStrategy('snake_case');
    expect(snake('parseHTTPResponse')).toBe('parse_http_response');
    expect(snake('firstName')).toBe('first_name');
    expect(snake('id')).toBe('id');
    expect(snake('already_snake')).toBe('already_snake');

    const camel = resolveNamingStrategy('camelCase');
    expect(camel('first_name')).toBe('firstName');
  });

  it('rejects an unknown strategy name', () => {
    expect(() => resolveNamingStrategy('shouty' as any)).toThrow(/Unknown naming strategy/);
  });

  it('applies to nested objects too', async () => {
    class Inner {
      @IsString()
      innerValue: string;
    }
    class Outer {
      @ValidateNested()
      @JsonType(() => Inner)
      outerChild: Inner;
    }

    const parsed = await toInstance(
      Outer,
      { outer_child: { inner_value: 'v' } },
      { namingStrategy: 'snake_case' }
    );
    expect(parsed.outerChild).toBeInstanceOf(Inner);
    expect(parsed.outerChild.innerValue).toBe('v');
  });
});

describe('configure()', () => {
  class Account {
    @IsString()
    accountHolderName: string;
  }

  it('sets a library-wide default', async () => {
    configure({ namingStrategy: 'snake_case' });

    const a = new Account();
    a.accountHolderName = 'Ada';
    await expect(toPlain(a)).resolves.toEqual({ account_holder_name: 'Ada' });
    expect(getConfig().namingStrategy).toBe('snake_case');
  });

  it('is overridden by per-call options', async () => {
    configure({ namingStrategy: 'snake_case' });

    const a = new Account();
    a.accountHolderName = 'Ada';
    await expect(toPlain(a, { namingStrategy: 'kebab-case' }))
      .resolves.toEqual({ 'account-holder-name': 'Ada' });
  });

  it('resetConfig() restores the defaults', async () => {
    configure({ namingStrategy: 'snake_case', unknownKeys: 'error', validate: false });
    resetConfig();
    expect(getConfig()).toEqual({
      namingStrategy: 'identity',
      unknownKeys: 'allow',
      validate: true,
      maxDepth: 64,
    });
  });
});

describe('unknownKeys policy', () => {
  class Dto {
    @IsString()
    known: string;
  }

  it('allow (default) copies unknown keys through', async () => {
    const d = await toInstance(Dto, { known: 'a', extra: 'b' });
    expect((d as any).extra).toBe('b');
  });

  it('strip drops them', async () => {
    const d = await toInstance(Dto, { known: 'a', extra: 'b' }, { unknownKeys: 'strip' });
    expect((d as any).extra).toBeUndefined();
    expect(d.known).toBe('a');
  });

  it('error rejects the payload and names the offending key', async () => {
    await expect(toInstance(Dto, { known: 'a', extra: 'b' }, { unknownKeys: 'error' }))
      .rejects.toThrow(/Unknown property "extra"/);
  });

  it('never lets __proto__ through, whatever the policy', async () => {
    for (const unknownKeys of ['allow', 'strip', 'error'] as const) {
      const d = await toInstance(Dto, JSON.parse('{"known":"a","__proto__":{"x":1}}'), { unknownKeys });
      expect(Object.getPrototypeOf(d)).toBe(Dto.prototype);
      expect(({} as any).x).toBeUndefined();
    }
  });
});

describe('validate option', () => {
  class Strict {
    @IsString()
    name: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    age?: number;
  }

  it('throws by default', async () => {
    await expect(toInstance(Strict, { name: 123 })).rejects.toThrow(JsonValidationError);
  });

  it('maps without validating when told to', async () => {
    const s = await toInstance(Strict, { name: 123 }, { validate: false });
    expect(s).toBeInstanceOf(Strict);
    expect(s.name).toBe(123 as any);
  });

  it('skips validation on the way out too', async () => {
    const s = new Strict();
    s.name = 123 as any;
    await expect(toPlain(s, { validate: false })).resolves.toEqual({ name: 123 });
  });

  it('validateOrReject throws, validate returns', async () => {
    const s = new Strict();
    s.name = 123 as any;

    await expect(validateOrReject(s)).rejects.toThrow(JsonValidationError);
    await expect(validate(s)).resolves.toHaveLength(1);
  });
});

describe('error helpers', () => {
  class Item {
    @IsInt()
    @Min(1)
    qty: number;
  }
  class Order {
    @IsString()
    reference: string;

    @ValidateNested()
    @JsonType(() => Item)
    items: Item[];
  }

  const buildFailing = () => {
    const bad = new Item();
    bad.qty = -5;
    const o = new Order();
    o.reference = 42 as any;
    o.items = [bad];
    return o;
  };

  it('flattenErrors produces dotted paths with array indices', async () => {
    const errors = await validate(buildFailing());
    const flat = flattenErrors(errors);

    expect(flat['reference']).toEqual(['reference must be a string']);
    expect(flat['items[0].qty']).toEqual(['qty must be at least 1']);
  });

  it('formatErrors renders one line per failure', async () => {
    const errors = await validate(buildFailing());
    const text = formatErrors(errors);

    expect(text).toContain('reference: reference must be a string');
    expect(text).toContain('items[0].qty: qty must be at least 1');
  });

  it('collectErrorMessages returns just the messages', async () => {
    const messages = collectErrorMessages(await validate(buildFailing()));
    expect(messages).toHaveLength(2);
    expect(messages).toContain('qty must be at least 1');
  });

  it('returns an empty result for a valid object', async () => {
    const o = new Order();
    o.reference = 'ok';
    o.items = [];
    expect(flattenErrors(await validate(o))).toEqual({});
    expect(formatErrors(await validate(o))).toBe('');
  });
});

describe('a realistic API payload', () => {
  it('maps a snake_case request and answers without the secret', async () => {
    class SignUp {
      @JsonReadOnly()
      id: number;

      @JsonProperty('email_address')
      @IsString()
      email: string;

      @JsonWriteOnly()
      @IsString()
      password: string;

      @IsString()
      displayName: string;
    }

    const body = JSON.stringify({
      id: 999,                       // client must not be able to set this
      email_address: 'ada@example.com',
      password: 'hunter2',
      display_name: 'Ada',
    });

    const signUp = await fromJson(SignUp, body, { namingStrategy: 'snake_case' });
    expect(signUp.id).toBeUndefined();
    expect(signUp.email).toBe('ada@example.com');
    expect(signUp.password).toBe('hunter2');
    expect(signUp.displayName).toBe('Ada');

    signUp.id = 1;
    const response = await toJson(signUp, { namingStrategy: 'snake_case' });
    expect(JSON.parse(response)).toEqual({
      id: 1,
      email_address: 'ada@example.com',
      display_name: 'Ada',
    });
    expect(response).not.toContain('hunter2');
  });
});
