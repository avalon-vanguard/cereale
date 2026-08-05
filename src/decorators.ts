import type {
  ClassConstructor, FieldDecorator, JsonDeserializer, JsonSerializer,
} from './interfaces.js';
import {
  addConstraint, fieldMetadata, propertyModel,
  type EachValidationOptions, type PolymorphicInfo, type ValidationArguments,
  type ValidationConstraint, type ValidationOptions, type ValidatorConstraintInterface,
} from './metadata.js';

export type {
  ValidationArguments, ValidationOptions, EachValidationOptions,
  ValidationConstraint, ValidatorConstraintInterface,
} from './metadata.js';
export type { PropertyAccess, PropertyModel, ClassModel } from './metadata.js';
export { defineRule } from './metadata.js';

/** A rule applied to the field itself. */
type One<Base> = FieldDecorator<Base | null | undefined>;
/** The same rule under `{ each: true }`, which moves it onto the elements of an array. */
type Each<Base> = FieldDecorator<readonly (Base | null | undefined)[] | null | undefined>;

/**
 * A rule that can be applied either directly to a field or, with `{ each: true }`, to the
 * elements of an array field. The two overloads are what make `@IsString({ each: true })`
 * demand a `string[]` while a bare `@IsString()` demands a `string`.
 */
interface Rule<Base> {
  (options: EachValidationOptions): Each<Base>;
  (options?: ValidationOptions): One<Base>;
}

function decorate(
  build: (property: string) => ValidationConstraint,
  options?: ValidationOptions
): FieldDecorator<unknown> {
  return ((_target: undefined, context: ClassFieldDecoratorContext) => {
    const property = String(context.name);
    addConstraint(fieldMetadata(context), property, build(property), options);
  }) as FieldDecorator<unknown>;
}

/** Declares a rule that takes no arguments of its own. */
function rule<Base>(
  name: string,
  check: (value: any, args: ValidationArguments) => boolean | Promise<boolean>,
  message: (property: string) => string
): Rule<Base> {
  return ((options?: ValidationOptions) =>
    decorate(property => ({ name, validate: check, message: message(property) }), options)) as Rule<Base>;
}

function pattern(name: string, regex: RegExp, message: (property: string) => string): Rule<string> {
  return rule<string>(name, v => typeof v === 'string' && regex.test(v), message);
}

// ============================================================================
// Mapping
// ============================================================================

/**
 * Maps this field to a different name in JSON, in both directions.
 *
 * ```ts
 * class User {
 *   @JsonProperty('first_name')
 *   firstName!: string;   // <-> {"first_name": "Ada"}
 * }
 * ```
 *
 * An explicit name always wins over the active naming strategy. Note that renaming stops the
 * original name from *mapping* to it. Under the default `unknownKeys: 'allow'` that name is
 * still copied onto the instance raw, bypassing any `@JsonType` or `@JsonDeserialize` declared
 * for the field — add `@JsonAlias` to keep older clients working, or set `unknownKeys`.
 */
export function JsonProperty(name: string): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).name = name;
  }) as FieldDecorator<unknown>;
}

/**
 * Additional names accepted for this field when reading JSON.
 *
 * Aliases are input-only — output always uses the canonical name — which makes them the tool
 * for accepting a renamed field from older clients without emitting it.
 */
export function JsonAlias(...names: string[]): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    const model = propertyModel(fieldMetadata(context), String(context.name));
    model.aliases = [...(model.aliases ?? []), ...names];
  }) as FieldDecorator<unknown>;
}

function access(value: 'none' | 'readonly' | 'writeonly'): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).access = value;
  }) as FieldDecorator<unknown>;
}

/** Excludes this field from mapping in both directions. */
export const JsonIgnore = (): FieldDecorator<unknown> => access('none');

/**
 * Serialized to JSON, but never populated from incoming JSON.
 *
 * For server-owned fields — ids, timestamps — that a client must not be able to set.
 */
export const JsonReadOnly = (): FieldDecorator<unknown> => access('readonly');

/**
 * Populated from incoming JSON, but never serialized back out.
 *
 * For secrets — passwords, tokens — that you accept but must never echo. Their values are
 * also withheld from validation errors.
 */
export const JsonWriteOnly = (): FieldDecorator<unknown> => access('writeonly');

/**
 * Custom serializer for this field.
 *
 * The serializer's input type must match the field: a `JsonSerializer<Date, string>` can only
 * be attached to a `Date` field. Skipped when the value is `null`/`undefined`.
 */
export function JsonSerialize<T>(
  serializer: ClassConstructor<JsonSerializer<T, any>>
): FieldDecorator<T | null | undefined> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).serializer = serializer;
  }) as FieldDecorator<T | null | undefined>;
}

/**
 * Custom deserializer for this field.
 *
 * The deserializer's output type must match the field: a `JsonDeserializer<string, Date>` can
 * only be attached to a `Date` field.
 */
export function JsonDeserialize<R>(
  deserializer: ClassConstructor<JsonDeserializer<any, R>>
): FieldDecorator<R | null | undefined> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).deserializer = deserializer;
  }) as FieldDecorator<R | null | undefined>;
}

/**
 * Declares the class a nested field maps to, so the mapper produces real instances.
 *
 * The referenced class must match the field's declared type — `@JsonType(() => Money)` on an
 * `Address` field is a compile error. Applies element-wise to arrays.
 */
export function JsonType<T extends object>(
  typeFunction: () => ClassConstructor<T>
): FieldDecorator<T | readonly T[] | null | undefined> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).type = typeFunction;
  }) as FieldDecorator<T | readonly T[] | null | undefined>;
}

export interface PolymorphicOptions<T> {
  /**
   * What to do when the discriminator value matches no registered subtype.
   * - `keep` (default): pass the raw value through untouched.
   * - `error`: throw a `JsonMappingError` naming the unknown discriminator value.
   */
  onUnknown?: 'keep' | 'error';
  /** Subtype to use when the discriminator matches nothing. Takes precedence over `onUnknown`. */
  fallback?: ClassConstructor<T>;
}

/**
 * Selects the concrete class for a field from a discriminator property in the JSON.
 *
 * Name the base type explicitly to have the subtypes checked against it:
 *
 * ```ts
 * @JsonPolymorphic<Media>('type', [
 *   { value: Book, name: 'book' },
 *   { value: Movie, name: 'movie' },
 * ])
 * items!: Media[];
 * ```
 *
 * `NoInfer` keeps `Base` from being inferred from the first subtype — otherwise a list of
 * `[Book, Movie]` would fix `Base` to `Book` and then reject `Movie`.
 */
export function JsonPolymorphic<Base extends object = object>(
  discriminator: string,
  subTypes: { value: ClassConstructor<NoInfer<Base>>; name: string }[],
  options?: PolymorphicOptions<NoInfer<Base>>
): FieldDecorator<Base | readonly Base[] | null | undefined> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    const info: PolymorphicInfo = {
      discriminator,
      subTypes: subTypes as PolymorphicInfo['subTypes'],
      onUnknown: options?.onUnknown ?? 'keep',
      ...(options?.fallback ? { fallback: options.fallback as ClassConstructor<any> } : {}),
    };
    propertyModel(fieldMetadata(context), String(context.name)).polymorphic = info;
  }) as FieldDecorator<Base | readonly Base[] | null | undefined>;
}

// ============================================================================
// Control flow
// ============================================================================

/** Skips every other rule on this field when the value is `null` or `undefined`. */
export function IsOptional(): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).optional = true;
  }) as FieldDecorator<unknown>;
}

/**
 * Skips every rule on this field when the condition returns false.
 *
 * ```ts
 * class Payment {
 *   @IsIn(['card', 'invoice']) method!: string;
 *   @ValidateIf<Payment>(p => p.method === 'card') @IsString() cardNumber?: string;
 * }
 * ```
 */
export function ValidateIf<This>(condition: (object: This) => boolean): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name)).condition = condition as (o: any) => boolean;
  }) as FieldDecorator<unknown>;
}

/**
 * Declares a field with no rules of its own.
 *
 * Useful with `unknownKeys: 'strip'` or `'error'`, where a field has to be declared to survive
 * the payload even though nothing about its value needs checking.
 */
export function Allow(): FieldDecorator<unknown> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    propertyModel(fieldMetadata(context), String(context.name));
  }) as FieldDecorator<unknown>;
}

/**
 * Recursively validates the value of this field.
 *
 * `{ each: true }` additionally asserts that the value really is an array.
 */
export function ValidateNested(options?: ValidationOptions): FieldDecorator<object | readonly unknown[] | null | undefined> {
  return ((_t: undefined, context: ClassFieldDecoratorContext) => {
    const metadata = fieldMetadata(context);
    const property = String(context.name);
    propertyModel(metadata, property).nested = true;
    if (options?.each) {
      addConstraint(metadata, property, {
        name: 'nestedEach',
        validate: v => Array.isArray(v),
        message: `${property} must be an array`,
      });
    }
  }) as FieldDecorator<object | readonly unknown[] | null | undefined>;
}

// ============================================================================
// Type rules
// ============================================================================

export const IsString: Rule<string> = rule('isString', v => typeof v === 'string', p => `${p} must be a string`);
export const IsNumber: Rule<number> = rule('isNumber', v => typeof v === 'number' && !isNaN(v), p => `${p} must be a number`);
export const IsInt: Rule<number> = rule('isInt', v => Number.isInteger(v), p => `${p} must be an integer`);
export const IsBoolean: Rule<boolean> = rule('isBoolean', v => typeof v === 'boolean', p => `${p} must be a boolean`);
export const IsBigInt: Rule<bigint> = rule('isBigInt', v => typeof v === 'bigint', p => `${p} must be a bigint`);
export const IsDate: Rule<Date> = rule('isDate', v => v instanceof Date && !isNaN(v.getTime()), p => `${p} must be a valid Date object`);
export const IsObject: Rule<object> = rule('isObject', v => typeof v === 'object' && v !== null && !Array.isArray(v), p => `${p} must be an object`);

export const IsDefined: Rule<unknown> = rule('isDefined', v => v !== null && v !== undefined, p => `${p} should not be null or undefined`);
export const IsNotEmpty: Rule<unknown> = rule('isNotEmpty', v => v !== null && v !== undefined && v !== '', p => `${p} should not be empty`);
export const IsEmpty: Rule<unknown> = rule('isEmpty', v => {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}, p => `${p} must be empty`);

// ============================================================================
// Numbers
// ============================================================================

export function Min(min: number, options: EachValidationOptions): Each<number>;
export function Min(min: number, options?: ValidationOptions): One<number>;
export function Min(min: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'min', validate: v => typeof v === 'number' && v >= min,
    message: `${p} must be at least ${min}`, constraints: [min],
  }), options);
}

export function Max(max: number, options: EachValidationOptions): Each<number>;
export function Max(max: number, options?: ValidationOptions): One<number>;
export function Max(max: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'max', validate: v => typeof v === 'number' && v <= max,
    message: `${p} must be at most ${max}`, constraints: [max],
  }), options);
}

export const Positive: Rule<number> = rule('positive', v => typeof v === 'number' && v > 0, p => `${p} must be positive`);
export const Negative: Rule<number> = rule('negative', v => typeof v === 'number' && v < 0, p => `${p} must be negative`);

export function IsDivisibleBy(divisor: number, options: EachValidationOptions): Each<number>;
export function IsDivisibleBy(divisor: number, options?: ValidationOptions): One<number>;
export function IsDivisibleBy(divisor: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'isDivisibleBy',
    validate: v => typeof v === 'number' && Number.isFinite(v) && divisor !== 0 && v % divisor === 0,
    message: `${p} must be divisible by ${divisor}`, constraints: [divisor],
  }), options);
}

/** An integer in 0..65535. Accepts a number or a numeric string. */
export const IsPort: Rule<number | string> = rule('isPort', v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535;
}, p => `${p} must be a valid port number`);

export const IsLatitude: Rule<number> = rule('isLatitude', v => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90, p => `${p} must be a latitude between -90 and 90`);
export const IsLongitude: Rule<number> = rule('isLongitude', v => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180, p => `${p} must be a longitude between -180 and 180`);

// ============================================================================
// Strings
// ============================================================================

export function MinLength(min: number, options: EachValidationOptions): Each<string>;
export function MinLength(min: number, options?: ValidationOptions): One<string>;
export function MinLength(min: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'minLength', validate: v => typeof v === 'string' && v.length >= min,
    message: `${p} must be longer than or equal to ${min} characters`, constraints: [min],
  }), options);
}

export function MaxLength(max: number, options: EachValidationOptions): Each<string>;
export function MaxLength(max: number, options?: ValidationOptions): One<string>;
export function MaxLength(max: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'maxLength', validate: v => typeof v === 'string' && v.length <= max,
    message: `${p} must be shorter than or equal to ${max} characters`, constraints: [max],
  }), options);
}

export function Length(min: number, max?: number, options?: ValidationOptions): One<string>;
export function Length(min: number, max: number | undefined, options: EachValidationOptions): Each<string>;
export function Length(min: number, max?: number, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'length',
    validate: v => typeof v === 'string' && v.length >= min && (max === undefined || v.length <= max),
    message: max === undefined
      ? `${p} must be at least ${min} characters`
      : `${p} must be between ${min} and ${max} characters`,
    constraints: max === undefined ? [min] : [min, max],
  }), options);
}

export const Email: Rule<string> = pattern('isEmail', /^[^\s@]+@[^\s@]+\.[^\s@]+$/, p => `${p} must be a valid email`);
export const IsAlpha: Rule<string> = pattern('isAlpha', /^[A-Za-z]+$/, p => `${p} must contain only letters`);
export const IsAlphanumeric: Rule<string> = pattern('isAlphanumeric', /^[A-Za-z0-9]+$/, p => `${p} must contain only letters and numbers`);
export const IsSemVer: Rule<string> = pattern('isSemVer', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/, p => `${p} must be a valid semantic version`);
export const IsHexColor: Rule<string> = pattern('isHexColor', /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, p => `${p} must be a hex color`);

export const IsLowercase: Rule<string> = rule('isLowercase', v => typeof v === 'string' && v === v.toLowerCase(), p => `${p} must be lowercase`);
export const IsUppercase: Rule<string> = rule('isUppercase', v => typeof v === 'string' && v === v.toUpperCase(), p => `${p} must be uppercase`);
export const IsNumberString: Rule<string> = rule('isNumberString', v => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)), p => `${p} must be a number string`);
export const IsDateString: Rule<string> = rule('isDateString', v => typeof v === 'string' && !isNaN(Date.parse(v)), p => `${p} must be a valid ISO 8601 date string`);
export const IsJSON: Rule<string> = rule('isJson', v => {
  if (typeof v !== 'string') return false;
  try { JSON.parse(v); return true; } catch { return false; }
}, p => `${p} must be a JSON string`);

export const IsUrl: Rule<string> = rule('isUrl', v => {
  try { new URL(v as string); return true; } catch { return false; }
}, p => `${p} must be a valid URL`);

export function Matches(regex: RegExp, options: EachValidationOptions): Each<string>;
export function Matches(regex: RegExp, options?: ValidationOptions): One<string>;
export function Matches(regex: RegExp, options?: ValidationOptions): unknown {
  // A `g` or `y` flag makes RegExp.test stateful: it advances lastIndex on a match and
  // resumes from there next time, so validating the same value twice gives different
  // answers. Validation must be a pure predicate, so those flags are dropped.
  const stateless = regex.flags.includes('g') || regex.flags.includes('y')
    ? new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''))
    : regex;
  return decorate(p => ({
    name: 'matches', validate: v => typeof v === 'string' && stateless.test(v),
    message: `${p} must match ${regex} regular expression`, constraints: [regex],
  }), options);
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export function IsUUID(version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | undefined, options: EachValidationOptions): Each<string>;
export function IsUUID(version?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, options?: ValidationOptions): One<string>;
export function IsUUID(version?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, options?: ValidationOptions): unknown {
  const regex = version
    ? new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i')
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return decorate(p => ({
    name: 'isUuid',
    validate: v => {
      if (typeof v !== 'string') return false;
      if (!version && (v.toLowerCase() === NIL_UUID || v.toLowerCase() === MAX_UUID)) return true;
      return regex.test(v);
    },
    message: `${p} must be a valid UUID${version ? ` (version ${version})` : ''}`,
    ...(version ? { constraints: [version] } : {}),
  }), options);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIPv6 = (value: string): boolean => {
  try {
    return new URL(`http://[${value}]`).hostname === `[${value.toLowerCase()}]`
      || (/^[0-9a-f:.]+$/i.test(value) && value.includes(':'));
  } catch { return false; }
};

export function IsIP(version: 4 | 6 | undefined, options: EachValidationOptions): Each<string>;
export function IsIP(version?: 4 | 6, options?: ValidationOptions): One<string>;
export function IsIP(version?: 4 | 6, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'isIp',
    validate: v => {
      if (typeof v !== 'string') return false;
      if (version === 4) return IPV4.test(v);
      if (version === 6) return isIPv6(v);
      return IPV4.test(v) || isIPv6(v);
    },
    message: `${p} must be a valid IP${version ? `v${version}` : ''} address`,
    ...(version ? { constraints: [version] } : {}),
  }), options);
}

function affix(name: string, test: (value: string, seed: string) => boolean, describe: (p: string, seed: string) => string) {
  function decorator(seed: string, options: EachValidationOptions): Each<string>;
  function decorator(seed: string, options?: ValidationOptions): One<string>;
  function decorator(seed: string, options?: ValidationOptions): unknown {
    return decorate(p => ({
      name, validate: v => typeof v === 'string' && test(v, seed),
      message: describe(p, seed), constraints: [seed],
    }), options);
  }
  return decorator;
}

export const Contains = affix('contains', (v, s) => v.includes(s), (p, s) => `${p} must contain ${JSON.stringify(s)}`);
export const NotContains = affix('notContains', (v, s) => !v.includes(s), (p, s) => `${p} must not contain ${JSON.stringify(s)}`);
export const StartsWith = affix('startsWith', (v, s) => v.startsWith(s), (p, s) => `${p} must start with ${JSON.stringify(s)}`);
export const EndsWith = affix('endsWith', (v, s) => v.endsWith(s), (p, s) => `${p} must end with ${JSON.stringify(s)}`);

// ============================================================================
// Equality and membership
// ============================================================================

export function Equals<T>(comparison: T, options: EachValidationOptions): Each<T>;
export function Equals<T>(comparison: T, options?: ValidationOptions): One<T>;
export function Equals<T>(comparison: T, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'equals', validate: v => v === comparison,
    message: `${p} must be equal to ${JSON.stringify(comparison)}`, constraints: [comparison],
  }), options);
}

export function NotEquals<T>(comparison: T, options: EachValidationOptions): Each<T>;
export function NotEquals<T>(comparison: T, options?: ValidationOptions): One<T>;
export function NotEquals<T>(comparison: T, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'notEquals', validate: v => v !== comparison,
    message: `${p} must not be equal to ${JSON.stringify(comparison)}`, constraints: [comparison],
  }), options);
}

/**
 * Restricts the field to one of the listed values.
 *
 * The field's type must accept those values, so `@IsIn(['a', 'b']) role!: number` is a
 * compile error.
 */
export function IsIn<const T extends readonly unknown[]>(values: T, options: EachValidationOptions): Each<T[number]>;
export function IsIn<const T extends readonly unknown[]>(values: T, options?: ValidationOptions): One<T[number]>;
export function IsIn<const T extends readonly unknown[]>(values: T, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'isIn', validate: v => values.includes(v),
    message: `${p} must be one of the following values: ${values.join(', ')}`, constraints: [values],
  }), options);
}

export function IsNotIn<const T extends readonly unknown[]>(values: T, options: EachValidationOptions): Each<unknown>;
export function IsNotIn<const T extends readonly unknown[]>(values: T, options?: ValidationOptions): One<unknown>;
export function IsNotIn<const T extends readonly unknown[]>(values: T, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'isNotIn', validate: v => !values.includes(v),
    message: `${p} must not be one of the following values: ${values.join(', ')}`, constraints: [values],
  }), options);
}

/**
 * Restricts the field to the members of a TypeScript enum.
 *
 * The field's type must be the enum, so `@IsEnum(Role) status!: number` is a compile error
 * when `Role` is a string enum.
 */
export function IsEnum<E extends Record<string, string | number>>(entity: E, options: EachValidationOptions): Each<E[keyof E]>;
export function IsEnum<E extends Record<string, string | number>>(entity: E, options?: ValidationOptions): One<E[keyof E]>;
export function IsEnum<E extends Record<string, string | number>>(entity: E, options?: ValidationOptions): unknown {
  // A numeric enum compiles to a two-way map ({ A: 0, '0': 'A' }), so the reverse-mapped
  // names must be filtered out or 'A' would validate as a legal value.
  const values = Object.keys(entity)
    .filter(key => typeof entity[entity[key] as unknown as string] !== 'number')
    .map(key => entity[key]);
  return decorate(p => ({
    name: 'isEnum', validate: v => values.includes(v as E[keyof E]),
    message: `${p} must be one of the following values: ${values.join(', ')}`, constraints: [values],
  }), options);
}

export function IsInstance<T extends object>(clazz: ClassConstructor<T>, options: EachValidationOptions): Each<T>;
export function IsInstance<T extends object>(clazz: ClassConstructor<T>, options?: ValidationOptions): One<T>;
export function IsInstance<T extends object>(clazz: ClassConstructor<T>, options?: ValidationOptions): unknown {
  return decorate(p => ({
    name: 'isInstance', validate: v => v instanceof clazz,
    message: `${p} must be an instance of ${clazz.name}`, constraints: [clazz],
  }), options);
}

// ============================================================================
// Arrays
// ============================================================================

type ArrayRule = FieldDecorator<readonly unknown[] | null | undefined>;

function arrayRule(
  name: string,
  check: (value: readonly unknown[]) => boolean,
  message: (property: string) => string,
  constraints?: any[]
): (options?: ValidationOptions) => ArrayRule {
  return (options?: ValidationOptions) => decorate(p => ({
    name, validate: v => Array.isArray(v) && check(v), message: message(p),
    ...(constraints ? { constraints } : {}),
  }), options) as ArrayRule;
}

export const IsArray = (options?: ValidationOptions): ArrayRule =>
  decorate(p => ({ name: 'isArray', validate: v => Array.isArray(v), message: `${p} must be an array` }), options) as ArrayRule;

export const ArrayNotEmpty = (options?: ValidationOptions): ArrayRule =>
  arrayRule('arrayNotEmpty', v => v.length > 0, p => `${p} should not be empty`)(options);

export const ArrayMinSize = (min: number, options?: ValidationOptions): ArrayRule =>
  arrayRule('arrayMinSize', v => v.length >= min, p => `${p} must contain at least ${min} elements`, [min])(options);

export const ArrayMaxSize = (max: number, options?: ValidationOptions): ArrayRule =>
  arrayRule('arrayMaxSize', v => v.length <= max, p => `${p} must contain at most ${max} elements`, [max])(options);

/** Pass an extractor to deduplicate objects by a key rather than by reference. */
export function ArrayUnique<T>(
  identifier?: (item: T) => unknown,
  options?: ValidationOptions
): FieldDecorator<readonly T[] | null | undefined> {
  return arrayRule('arrayUnique', v => {
    const keys = identifier ? (v as readonly T[]).map(identifier) : v;
    return new Set(keys).size === keys.length;
  }, p => `${p} must not contain duplicate values`)(options) as FieldDecorator<readonly T[] | null | undefined>;
}

export function ArrayContains<T>(values: readonly T[], options?: ValidationOptions): FieldDecorator<readonly T[] | null | undefined> {
  return arrayRule('arrayContains', v => values.every(value => v.includes(value)),
    p => `${p} must contain the following values: ${values.join(', ')}`, [values])(options) as FieldDecorator<readonly T[] | null | undefined>;
}

export function ArrayNotContains<T>(values: readonly T[], options?: ValidationOptions): FieldDecorator<readonly T[] | null | undefined> {
  return arrayRule('arrayNotContains', v => values.every(value => !v.includes(value)),
    p => `${p} must not contain any of the following values: ${values.join(', ')}`, [values])(options) as FieldDecorator<readonly T[] | null | undefined>;
}

// ============================================================================
// Dates
// ============================================================================

type DateBound = Date | (() => Date);
const boundOf = (bound: DateBound): Date => (typeof bound === 'function' ? bound() : bound);

/**
 * Accepts a thunk so a moving boundary — "not in the past" — is evaluated per validation
 * rather than frozen when the class was declared.
 */
export function MinDate(min: DateBound, options: EachValidationOptions): Each<Date>;
export function MinDate(min: DateBound, options?: ValidationOptions): One<Date>;
export function MinDate(min: DateBound, options?: ValidationOptions): unknown {
  return decorate(() => ({
    name: 'minDate',
    validate: v => v instanceof Date && !isNaN(v.getTime()) && v.getTime() >= boundOf(min).getTime(),
    message: args => `${args.property} must not be earlier than ${boundOf(min).toISOString()}`,
    constraints: [min],
  }), options);
}

export function MaxDate(max: DateBound, options: EachValidationOptions): Each<Date>;
export function MaxDate(max: DateBound, options?: ValidationOptions): One<Date>;
export function MaxDate(max: DateBound, options?: ValidationOptions): unknown {
  return decorate(() => ({
    name: 'maxDate',
    validate: v => v instanceof Date && !isNaN(v.getTime()) && v.getTime() <= boundOf(max).getTime(),
    message: args => `${args.property} must not be later than ${boundOf(max).toISOString()}`,
    constraints: [max],
  }), options);
}

// ============================================================================
// Custom rules
// ============================================================================

/**
 * Applies a custom validator, as a class implementing {@link ValidatorConstraintInterface} or
 * a plain predicate.
 *
 * Constrain the field type by annotating the predicate's parameter:
 * `@Validate((v: string) => v.startsWith('x'))` will only attach to a `string` field.
 */
export function Validate<T = unknown>(
  validator: ClassConstructor<ValidatorConstraintInterface> | ((value: T, args: ValidationArguments) => boolean | Promise<boolean>),
  constraintsOrOptions?: any[] | ValidationOptions,
  maybeOptions?: ValidationOptions
): FieldDecorator<T | null | undefined> {
  const constraints = Array.isArray(constraintsOrOptions) ? constraintsOrOptions : [];
  const options = Array.isArray(constraintsOrOptions) ? maybeOptions : constraintsOrOptions;

  const isPlainFunction = typeof validator === 'function' && !(validator as any).prototype?.validate;

  if (isPlainFunction) {
    const predicate = validator as (value: T, args: ValidationArguments) => boolean | Promise<boolean>;
    return decorate(() => ({
      name: 'custom',
      validate: (v, a) => predicate(v as T, a),
      message: args => `${args.property} is invalid`,
      constraints,
    }), options) as FieldDecorator<T | null | undefined>;
  }

  const instance = new (validator as ClassConstructor<ValidatorConstraintInterface>)();
  return decorate(() => ({
    name: (validator as ClassConstructor<ValidatorConstraintInterface>).name,
    validate: (v, a) => instance.validate(v, a),
    message: args => (instance.defaultMessage ? instance.defaultMessage(args) : `${args.property} is invalid`),
    constraints,
  }), options) as FieldDecorator<T | null | undefined>;
}
