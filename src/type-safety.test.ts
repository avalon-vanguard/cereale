import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The headline guarantee of v2 is that a rule cannot be attached to a field it does not fit.
 * That is a *compile-time* claim, so asserting it needs the compiler: each case below is
 * type-checked in isolation and must fail.
 *
 * These run the real `tsc`, so they are slower than the rest of the suite — but a guarantee
 * nobody checks is a guarantee that quietly stops holding.
 */
const TSC = resolve('node_modules/.bin/tsc');
const SRC = resolve('src/index.js').replace(/\.js$/, '');

function typeCheck(body: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cereale-types-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        // DOM supplies URL/Request, which the library's own signatures reference. A real
        // consumer has these from either DOM or @types/node.
        lib: ['ESNext', 'ESNext.Decorators', 'DOM'], strict: true,
        strictPropertyInitialization: false, noEmit: true, skipLibCheck: true,
      },
      include: ['case.ts'],
    }));
    writeFileSync(join(dir, 'case.ts'), `import {\n  IsString, IsInt, Min, MinLength, IsArray, ArrayMinSize, ArrayUnique,\n  IsDate, MinDate, IsBoolean, IsIn, IsEnum, JsonType, JsonSerialize,\n  JsonDeserialize, JsonSerializer, JsonDeserializer,\n} from ${JSON.stringify(SRC + '.js')};\n\n${body}\n`);
    try {
      execFileSync(process.execPath, [TSC, '-p', dir], { stdio: 'pipe' });
      return { ok: true, output: '' };
    } catch (error: any) {
      return { ok: false, output: String(error.stdout ?? '') + String(error.stderr ?? '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const compiles = (body: string) => {
  const result = typeCheck(body);
  if (!result.ok) throw new Error(`expected this to compile but it did not:\n${result.output}`);
};

const rejects = (body: string) => {
  const result = typeCheck(body);
  expect(result.ok, 'expected a compile error, but it compiled').toBe(false);
  return result.output;
};

describe('rules are checked against the field type', () => {
  it('accepts rules that match the field', () => {
    compiles(`
      class Ok {
        @IsString() @MinLength(2) name!: string;
        @IsInt() @Min(0) age!: number;
        @IsBoolean() active!: boolean;
        @IsDate() @MinDate(new Date(0)) when!: Date;
        @IsArray() @ArrayMinSize(1) tags!: string[];
        @IsString() nickname?: string;
        @IsString() maybe!: string | null;
      }
      void Ok;
    `);
  }, 60_000);

  it('rejects a string rule on a number field', () => {
    expect(rejects(`class Bad { @IsString() age!: number } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects a number rule on a string field', () => {
    expect(rejects(`class Bad { @Min(0) label!: string } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects an array rule on a non-array field', () => {
    expect(rejects(`class Bad { @ArrayMinSize(1) count!: number } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects a date rule on a string field', () => {
    expect(rejects(`class Bad { @MinDate(new Date(0)) when!: string } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);
});

describe('each: true moves the rule onto the elements', () => {
  it('accepts a matching array field', () => {
    compiles(`class Ok { @IsString({ each: true }) tags!: string[] } void Ok;`);
  }, 60_000);

  it('rejects each:true on a scalar field', () => {
    expect(rejects(`class Bad { @IsString({ each: true }) tag!: string } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects a bare rule on an array field', () => {
    expect(rejects(`class Bad { @IsString() tags!: string[] } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects an element-type mismatch', () => {
    expect(rejects(`class Bad { @IsString({ each: true }) nums!: number[] } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);
});

describe('nested types and converters are checked', () => {
  const shapes = `
    class Address { street!: string }
    class Money { amount!: number }
  `;

  it('accepts the matching class', () => {
    compiles(`${shapes}
      class Ok {
        @JsonType(() => Address) ship!: Address;
        @JsonType(() => Address) history!: Address[];
      }
      void Ok;`);
  }, 60_000);

  it('rejects an unrelated class', () => {
    expect(rejects(`${shapes}
      class Bad { @JsonType(() => Money) ship!: Address }
      void Bad;`)).toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects a serializer whose input does not match the field', () => {
    expect(rejects(`
      class DateToString implements JsonSerializer<Date, string> {
        serialize(v: Date) { return v.toISOString(); }
      }
      class Bad { @JsonSerialize(DateToString) name!: string }
      void Bad;`)).toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects a deserializer whose output does not match the field', () => {
    expect(rejects(`
      class StringToDate implements JsonDeserializer<string, Date> {
        deserialize(v: string) { return new Date(v); }
      }
      class Bad { @JsonDeserialize(StringToDate) name!: string }
      void Bad;`)).toMatch(/not assignable|Unable to resolve/);
  }, 60_000);
});

describe('membership rules narrow the field', () => {
  it('accepts a field typed as the allowed union', () => {
    compiles(`class Ok { @IsIn(['a', 'b']) choice!: 'a' | 'b' } void Ok;`);
  }, 60_000);

  it('rejects a field that cannot hold the allowed values', () => {
    expect(rejects(`class Bad { @IsIn(['a', 'b']) choice!: number } void Bad;`))
      .toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('rejects an enum rule on a mismatched field', () => {
    expect(rejects(`
      enum Role { Admin = 'admin' }
      class Bad { @IsEnum(Role) role!: number }
      void Bad;`)).toMatch(/not assignable|Unable to resolve/);
  }, 60_000);

  it('accepts an enum rule on the enum field', () => {
    compiles(`
      enum Role { Admin = 'admin', User = 'user' }
      class Ok { @IsEnum(Role) role!: Role }
      void Ok;`);
  }, 60_000);
});
