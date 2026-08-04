import { JsonSerializer, JsonDeserializer, ClassConstructor } from './interfaces.js';
import { metadataStorage } from './metadata-storage.js';

export const METADATA_KEYS = {
  PROPERTIES: 'cereale:properties',
  TYPE: 'cereale:type',
  VALIDATION: 'cereale:validation',
  SERIALIZER: 'cereale:serializer',
  DESERIALIZER: 'cereale:deserializer',
  POLYMORPHIC: 'cereale:polymorphic',
  IS_OPTIONAL: 'cereale:optional',
  NESTED: 'cereale:nested',
  NAME: 'cereale:name',
  ALIASES: 'cereale:aliases',
  ACCESS: 'cereale:access',
  CONDITION: 'cereale:condition',
};

/**
 * Which directions a property participates in.
 *
 * - `readwrite` (default): mapped both ways.
 * - `readonly`: written to JSON, never populated from incoming JSON (server-assigned ids).
 * - `writeonly`: populated from incoming JSON, never written back out (passwords).
 * - `none`: ignored entirely.
 */
export type PropertyAccess = 'readwrite' | 'readonly' | 'writeonly' | 'none';

export interface ValidationArguments {
  value: any;
  object: any;
  property: string;
  constraints: any[];
}

export interface ValidationOptions {
  each?: boolean;
  message?: string | ((args: ValidationArguments) => string);
}

export type ValidationConstraint = {
  name: string;
  validate: (value: any, args: ValidationArguments) => boolean | Promise<boolean>;
  message: string | ((args: ValidationArguments) => string);
  constraints?: any[];
  each?: boolean;
  /**
   * True when the message came from the user via `ValidationOptions.message`.
   * The engine only decorates default messages with the "each element in ..." prefix;
   * a message the user wrote is reported exactly as written.
   */
  hasCustomMessage?: boolean;
};

export interface ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean | Promise<boolean>;
  defaultMessage?(args: ValidationArguments): string;
}

/**
 * Helper to register a property in metadata.
 */
function registerProperty(target: any, propertyKey: string) {
  metadataStorage.registerProperty(target, propertyKey);
}

/**
 * Helper to add a validation constraint to a property.
 */
function addValidation(target: any, propertyKey: string, constraint: ValidationConstraint, options?: ValidationOptions) {
  registerProperty(target, propertyKey);
  
  if (options) {
    if (options.each) {
      constraint.each = true;
    }
    if (options.message) {
      constraint.message = options.message;
      constraint.hasCustomMessage = true;
    }
  }

  const constraints: ValidationConstraint[] = metadataStorage.getOwnMetadata(METADATA_KEYS.VALIDATION, target, propertyKey) || [];
  constraints.push(constraint);
  metadataStorage.defineMetadata(METADATA_KEYS.VALIDATION, constraints, target, propertyKey);
}

// --- Mapping Decorators ---

/**
 * @JsonProperty(name: string)
 * Maps this property to a different name in JSON, in both directions.
 *
 * ```ts
 * class User {
 *   @JsonProperty('first_name')
 *   firstName: string;   // <-> {"first_name": "Ada"}
 * }
 * ```
 *
 * An explicit name always wins over the active naming strategy.
 */
export function JsonProperty(name: string) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.NAME, name, target, propertyKey);
  };
}

/**
 * @JsonAlias(...names: string[])
 * Additional names accepted for this property when reading JSON.
 *
 * Aliases are input-only — output always uses the canonical name — which makes them the
 * tool for accepting a renamed field from older clients without emitting it.
 *
 * ```ts
 * class User {
 *   @JsonProperty('surname')
 *   @JsonAlias('last_name', 'lastName')
 *   surname: string;
 * }
 * ```
 */
export function JsonAlias(...names: string[]) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    const existing: string[] = metadataStorage.getOwnMetadata(METADATA_KEYS.ALIASES, target, propertyKey) || [];
    metadataStorage.defineMetadata(METADATA_KEYS.ALIASES, [...existing, ...names], target, propertyKey);
  };
}

/**
 * @JsonIgnore()
 * Excludes this property from mapping in both directions.
 */
export function JsonIgnore() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.ACCESS, 'none', target, propertyKey);
  };
}

/**
 * @JsonReadOnly()
 * Serialized to JSON, but never populated from incoming JSON.
 *
 * For server-owned fields — ids, timestamps — that a client must not be able to set.
 */
export function JsonReadOnly() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.ACCESS, 'readonly', target, propertyKey);
  };
}

/**
 * @JsonWriteOnly()
 * Populated from incoming JSON, but never serialized back out.
 *
 * For secrets — passwords, tokens — that you accept but must never echo.
 */
export function JsonWriteOnly() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.ACCESS, 'writeonly', target, propertyKey);
  };
}

/**
 * @JsonSerialize(serializer: ClassConstructor<JsonSerializer>)
 * Custom serializer decorator.
 */
export function JsonSerialize(serializer: ClassConstructor<JsonSerializer>) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.SERIALIZER, serializer, target, propertyKey);
  };
}

/**
 * @JsonDeserialize(deserializer: ClassConstructor<JsonDeserializer>)
 * Custom deserializer decorator.
 */
export function JsonDeserialize(deserializer: ClassConstructor<JsonDeserializer>) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.DESERIALIZER, deserializer, target, propertyKey);
  };
}

/**
 * @JsonType(typeFunction: () => ClassConstructor<any>)
 * Identifies the type of a property for nested object conversion.
 */
export function JsonType(typeFunction: () => ClassConstructor<any>) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.TYPE, typeFunction, target, propertyKey);
  };
}

export interface PolymorphicOptions {
  /**
   * What to do when the discriminator value matches no registered subtype.
   * - `keep` (default): pass the raw value through untouched.
   * - `error`: throw a {@link JsonMappingError} naming the unknown discriminator value.
   */
  onUnknown?: 'keep' | 'error';
  /** Subtype to use when the discriminator matches nothing. Takes precedence over `onUnknown`. */
  fallback?: ClassConstructor<any>;
}

/**
 * @JsonPolymorphic(discriminator: string, subTypes: { value: ClassConstructor<any>, name: string }[], options?: PolymorphicOptions)
 * Defines polymorphic behavior for a property.
 */
export function JsonPolymorphic(
  discriminator: string,
  subTypes: { value: ClassConstructor<any>, name: string }[],
  options?: PolymorphicOptions
) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(
      METADATA_KEYS.POLYMORPHIC,
      { discriminator, subTypes, onUnknown: options?.onUnknown ?? 'keep', fallback: options?.fallback },
      target,
      propertyKey
    );
  };
}

// --- Validation Decorators ---

/**
 * @IsOptional()
 * Marks a property as optional, skipping other validation rules if it's null or undefined.
 */
export function IsOptional() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.IS_OPTIONAL, true, target, propertyKey);
  };
}

/**
 * @IsString()
 */
export function IsString(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isString',
      validate: (v) => typeof v === 'string',
      message: `${propertyKey} must be a string`
    }, options);
  };
}

/**
 * @IsBoolean()
 */
export function IsBoolean(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isBoolean',
      validate: (v) => typeof v === 'boolean',
      message: `${propertyKey} must be a boolean`
    }, options);
  };
}

/**
 * @IsNumber()
 */
export function IsNumber(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isNumber',
      validate: (v) => typeof v === 'number' && !isNaN(v),
      message: `${propertyKey} must be a number`
    }, options);
  };
}

/**
 * @IsInt()
 */
export function IsInt(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isInt',
      validate: (v) => Number.isInteger(v),
      message: `${propertyKey} must be an integer`
    }, options);
  };
}

/**
 * @IsObject()
 */
export function IsObject(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isObject',
      validate: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
      message: `${propertyKey} must be an object`
    }, options);
  };
}

/**
 * @IsDefined()
 */
export function IsDefined(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isDefined',
      validate: (v) => v !== null && v !== undefined,
      message: `${propertyKey} should not be null or undefined`
    }, options);
  };
}

/**
 * @IsNotEmpty()
 */
export function IsNotEmpty(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isNotEmpty',
      validate: (v) => v !== null && v !== undefined && v !== '',
      message: `${propertyKey} should not be empty`
    }, options);
  };
}

/**
 * @Min(value: number)
 */
export function Min(min: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'min',
      validate: (v) => typeof v === 'number' && v >= min,
      message: `${propertyKey} must be at least ${min}`,
      constraints: [min]
    }, options);
  };
}

/**
 * @Max(value: number)
 */
export function Max(max: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'max',
      validate: (v) => typeof v === 'number' && v <= max,
      message: `${propertyKey} must be at most ${max}`,
      constraints: [max]
    }, options);
  };
}

/**
 * @Positive()
 */
export function Positive(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'positive',
      validate: (v) => typeof v === 'number' && v > 0,
      message: `${propertyKey} must be positive`
    }, options);
  };
}

/**
 * @Negative()
 */
export function Negative(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'negative',
      validate: (v) => typeof v === 'number' && v < 0,
      message: `${propertyKey} must be negative`
    }, options);
  };
}

/**
 * @MinLength(value: number)
 */
export function MinLength(min: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'minLength',
      validate: (v) => typeof v === 'string' && v.length >= min,
      message: `${propertyKey} must be longer than or equal to ${min} characters`,
      constraints: [min]
    }, options);
  };
}

/**
 * @MaxLength(value: number)
 */
export function MaxLength(max: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'maxLength',
      validate: (v) => typeof v === 'string' && v.length <= max,
      message: `${propertyKey} must be shorter than or equal to ${max} characters`,
      constraints: [max]
    }, options);
  };
}

/**
 * @Email()
 */
export function Email(options?: ValidationOptions) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isEmail',
      validate: (v) => typeof v === 'string' && emailRegex.test(v),
      message: `${propertyKey} must be a valid email`
    }, options);
  };
}

/**
 * @IsUrl()
 */
export function IsUrl(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isUrl',
      validate: (v) => {
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
      message: `${propertyKey} must be a valid URL`
    }, options);
  };
}

/**
 * @Matches(pattern: RegExp)
 */
export function Matches(pattern: RegExp, options?: ValidationOptions) {
  // A `g` or `y` flag makes RegExp.prototype.test stateful: it advances lastIndex on a
  // match and resumes from there on the next call, so validating the same value twice
  // yields different answers. Validation must be a pure predicate, so drop those flags.
  const stateless = pattern.flags.includes('g') || pattern.flags.includes('y')
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
    : pattern;
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'matches',
      validate: (v) => typeof v === 'string' && stateless.test(v),
      message: `${propertyKey} must match ${pattern} regular expression`,
      constraints: [pattern]
    }, options);
  };
}

/**
 * @IsArray()
 */
export function IsArray(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isArray',
      validate: (v) => Array.isArray(v),
      message: `${propertyKey} must be an array`
    }, options);
  };
}

/**
 * @ArrayMinSize(value: number)
 */
export function ArrayMinSize(min: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayMinSize',
      validate: (v) => Array.isArray(v) && v.length >= min,
      message: `${propertyKey} must contain at least ${min} elements`,
      constraints: [min]
    }, options);
  };
}

/**
 * @ArrayMaxSize(value: number)
 */
export function ArrayMaxSize(max: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayMaxSize',
      validate: (v) => Array.isArray(v) && v.length <= max,
      message: `${propertyKey} must contain at most ${max} elements`,
      constraints: [max]
    }, options);
  };
}

/**
 * @ArrayNotEmpty()
 */
export function ArrayNotEmpty(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayNotEmpty',
      validate: (v) => Array.isArray(v) && v.length > 0,
      message: `${propertyKey} should not be empty`
    }, options);
  };
}

/**
 * @IsIn(values: any[])
 */
export function IsIn(values: any[], options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isIn',
      validate: (v) => values.includes(v),
      message: `${propertyKey} must be one of the following values: ${values.join(', ')}`,
      constraints: [values]
    }, options);
  };
}

/**
 * @IsNotIn(values: any[])
 */
export function IsNotIn(values: any[], options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isNotIn',
      validate: (v) => !values.includes(v),
      message: `${propertyKey} must not be one of the following values: ${values.join(', ')}`,
      constraints: [values]
    }, options);
  };
}

/**
 * @IsDate()
 */
export function IsDate(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isDate',
      validate: (v) => v instanceof Date && !isNaN(v.getTime()),
      message: `${propertyKey} must be a valid Date object`
    }, options);
  };
}

// --- Equality and presence ---

/**
 * @Equals(comparison: any)
 */
export function Equals(comparison: any, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'equals',
      validate: (v) => v === comparison,
      message: `${propertyKey} must be equal to ${JSON.stringify(comparison)}`,
      constraints: [comparison]
    }, options);
  };
}

/**
 * @NotEquals(comparison: any)
 */
export function NotEquals(comparison: any, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'notEquals',
      validate: (v) => v !== comparison,
      message: `${propertyKey} must not be equal to ${JSON.stringify(comparison)}`,
      constraints: [comparison]
    }, options);
  };
}

/**
 * @IsEmpty()
 * Passes for null, undefined, '', [] and {} — the mirror of `@IsNotEmpty`.
 */
export function IsEmpty(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isEmpty',
      validate: (v) => {
        if (v === null || v === undefined || v === '') return true;
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'object') return Object.keys(v).length === 0;
        return false;
      },
      message: `${propertyKey} must be empty`
    }, options);
  };
}

/**
 * @IsEnum(entity: object)
 * Checks the value is a member of a TypeScript enum (string or numeric).
 */
export function IsEnum(entity: Record<string, any>, options?: ValidationOptions) {
  // A numeric enum compiles to a two-way map ({ A: 0, '0': 'A' }), so the reverse-mapped
  // names have to be filtered out or 'A' would validate as a legal value.
  const values = Object.keys(entity)
    .filter(key => typeof entity[entity[key]] !== 'number')
    .map(key => entity[key]);

  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isEnum',
      validate: (v) => values.includes(v),
      message: `${propertyKey} must be one of the following values: ${values.join(', ')}`,
      constraints: [values]
    }, options);
  };
}

/**
 * @IsInstance(target: ClassConstructor)
 */
export function IsInstance(clazz: ClassConstructor<any>, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isInstance',
      validate: (v) => v instanceof clazz,
      message: `${propertyKey} must be an instance of ${clazz.name}`,
      constraints: [clazz]
    }, options);
  };
}

// --- Strings ---

/**
 * @Length(min: number, max?: number)
 */
export function Length(min: number, max?: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'length',
      validate: (v) => typeof v === 'string' && v.length >= min && (max === undefined || v.length <= max),
      message: max === undefined
        ? `${propertyKey} must be at least ${min} characters`
        : `${propertyKey} must be between ${min} and ${max} characters`,
      constraints: max === undefined ? [min] : [min, max]
    }, options);
  };
}

function stringPattern(name: string, regex: RegExp, describe: (property: string) => string) {
  return (options?: ValidationOptions) => (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name,
      validate: (v) => typeof v === 'string' && regex.test(v),
      message: describe(propertyKey)
    }, options);
  };
}

/** @IsAlpha() — letters only. */
export const IsAlpha = stringPattern('isAlpha', /^[A-Za-z]+$/, p => `${p} must contain only letters`);

/** @IsAlphanumeric() — letters and digits only. */
export const IsAlphanumeric = stringPattern(
  'isAlphanumeric', /^[A-Za-z0-9]+$/, p => `${p} must contain only letters and numbers`
);

/** @IsNumberString() — a string that parses as a finite number. */
export function IsNumberString(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isNumberString',
      validate: (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)),
      message: `${propertyKey} must be a number string`
    }, options);
  };
}

/** @IsLowercase() */
export function IsLowercase(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isLowercase',
      validate: (v) => typeof v === 'string' && v === v.toLowerCase(),
      message: `${propertyKey} must be lowercase`
    }, options);
  };
}

/** @IsUppercase() */
export function IsUppercase(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isUppercase',
      validate: (v) => typeof v === 'string' && v === v.toUpperCase(),
      message: `${propertyKey} must be uppercase`
    }, options);
  };
}

/** @Contains(seed: string) */
export function Contains(seed: string, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'contains',
      validate: (v) => typeof v === 'string' && v.includes(seed),
      message: `${propertyKey} must contain ${JSON.stringify(seed)}`,
      constraints: [seed]
    }, options);
  };
}

/** @NotContains(seed: string) */
export function NotContains(seed: string, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'notContains',
      validate: (v) => typeof v === 'string' && !v.includes(seed),
      message: `${propertyKey} must not contain ${JSON.stringify(seed)}`,
      constraints: [seed]
    }, options);
  };
}

/** @StartsWith(prefix: string) */
export function StartsWith(prefix: string, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'startsWith',
      validate: (v) => typeof v === 'string' && v.startsWith(prefix),
      message: `${propertyKey} must start with ${JSON.stringify(prefix)}`,
      constraints: [prefix]
    }, options);
  };
}

/** @EndsWith(suffix: string) */
export function EndsWith(suffix: string, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'endsWith',
      validate: (v) => typeof v === 'string' && v.endsWith(suffix),
      message: `${propertyKey} must end with ${JSON.stringify(suffix)}`,
      constraints: [suffix]
    }, options);
  };
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * @IsUUID(version?: 1|2|3|4|5|6|7|8)
 * Without a version, accepts any RFC 9562 UUID plus the nil and max UUIDs.
 */
export function IsUUID(version?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, options?: ValidationOptions) {
  const pattern = version
    ? new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i')
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isUuid',
      validate: (v) => {
        if (typeof v !== 'string') return false;
        if (!version && (v.toLowerCase() === NIL_UUID || v.toLowerCase() === MAX_UUID)) return true;
        return pattern.test(v);
      },
      message: `${propertyKey} must be a valid UUID${version ? ` (version ${version})` : ''}`,
      ...(version ? { constraints: [version] } : {})
    }, options);
  };
}

/** @IsJSON() — a string that JSON.parse accepts. */
export function IsJSON(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isJson',
      validate: (v) => {
        if (typeof v !== 'string') return false;
        try {
          JSON.parse(v);
          return true;
        } catch {
          return false;
        }
      },
      message: `${propertyKey} must be a JSON string`
    }, options);
  };
}

/** @IsDateString() — an ISO-8601 string that parses to a real date. */
export function IsDateString(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isDateString',
      validate: (v) => typeof v === 'string' && !isNaN(Date.parse(v)),
      message: `${propertyKey} must be a valid ISO 8601 date string`
    }, options);
  };
}

/** @IsSemVer() */
export const IsSemVer = stringPattern(
  'isSemVer',
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  p => `${p} must be a valid semantic version`
);

/** @IsHexColor() — #rgb, #rrggbb or #rrggbbaa. */
export const IsHexColor = stringPattern(
  'isHexColor', /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, p => `${p} must be a hex color`
);

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * @IsIP(version?: 4 | 6)
 */
export function IsIP(version?: 4 | 6, options?: ValidationOptions) {
  const isV6 = (v: string) => {
    // Node's URL parser is the most reliable IPv6 validator available without a dependency.
    try {
      return new URL(`http://[${v}]`).hostname === `[${v.toLowerCase()}]` || /^[0-9a-f:.]+$/i.test(v) && v.includes(':');
    } catch {
      return false;
    }
  };

  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isIp',
      validate: (v) => {
        if (typeof v !== 'string') return false;
        if (version === 4) return IPV4.test(v);
        if (version === 6) return isV6(v);
        return IPV4.test(v) || isV6(v);
      },
      message: `${propertyKey} must be a valid IP${version ? `v${version}` : ''} address`,
      ...(version ? { constraints: [version] } : {})
    }, options);
  };
}

// --- Numbers ---

/** @IsDivisibleBy(divisor: number) */
export function IsDivisibleBy(divisor: number, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isDivisibleBy',
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && divisor !== 0 && v % divisor === 0,
      message: `${propertyKey} must be divisible by ${divisor}`,
      constraints: [divisor]
    }, options);
  };
}

/** @IsPort() — an integer in 0..65535, as a number or a numeric string. */
export function IsPort(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isPort',
      validate: (v) => {
        const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535;
      },
      message: `${propertyKey} must be a valid port number`
    }, options);
  };
}

/** @IsLatitude() */
export function IsLatitude(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isLatitude',
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90,
      message: `${propertyKey} must be a latitude between -90 and 90`
    }, options);
  };
}

/** @IsLongitude() */
export function IsLongitude(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isLongitude',
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180,
      message: `${propertyKey} must be a longitude between -180 and 180`
    }, options);
  };
}

/** @IsBigInt() */
export function IsBigInt(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'isBigInt',
      validate: (v) => typeof v === 'bigint',
      message: `${propertyKey} must be a bigint`
    }, options);
  };
}

// --- Dates ---

type DateBound = Date | (() => Date);

const boundOf = (bound: DateBound): Date => (typeof bound === 'function' ? bound() : bound);

/**
 * @MinDate(date: Date | (() => Date))
 * Accepts a thunk so a moving boundary — "not in the past" — is evaluated per validation
 * rather than frozen when the class was declared.
 */
export function MinDate(min: DateBound, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'minDate',
      validate: (v) => v instanceof Date && !isNaN(v.getTime()) && v.getTime() >= boundOf(min).getTime(),
      message: (args) => `${args.property} must not be earlier than ${boundOf(min).toISOString()}`,
      constraints: [min]
    }, options);
  };
}

/**
 * @MaxDate(date: Date | (() => Date))
 */
export function MaxDate(max: DateBound, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'maxDate',
      validate: (v) => v instanceof Date && !isNaN(v.getTime()) && v.getTime() <= boundOf(max).getTime(),
      message: (args) => `${args.property} must not be later than ${boundOf(max).toISOString()}`,
      constraints: [max]
    }, options);
  };
}

// --- Arrays ---

/**
 * @ArrayUnique(identifier?: (item: any) => any)
 * Pass an extractor to deduplicate objects by a key rather than by reference.
 */
export function ArrayUnique(identifier?: (item: any) => any, options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayUnique',
      validate: (v) => {
        if (!Array.isArray(v)) return false;
        const keys = identifier ? v.map(identifier) : v;
        return new Set(keys).size === keys.length;
      },
      message: `${propertyKey} must not contain duplicate values`
    }, options);
  };
}

/** @ArrayContains(values: any[]) — the array must contain every listed value. */
export function ArrayContains(values: any[], options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayContains',
      validate: (v) => Array.isArray(v) && values.every(value => v.includes(value)),
      message: `${propertyKey} must contain the following values: ${values.join(', ')}`,
      constraints: [values]
    }, options);
  };
}

/** @ArrayNotContains(values: any[]) — the array must contain none of the listed values. */
export function ArrayNotContains(values: any[], options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'arrayNotContains',
      validate: (v) => Array.isArray(v) && values.every(value => !v.includes(value)),
      message: `${propertyKey} must not contain any of the following values: ${values.join(', ')}`,
      constraints: [values]
    }, options);
  };
}

// --- Control flow ---

/**
 * @ValidateIf(condition: (object: any) => boolean)
 * Skips every constraint on this property when the condition returns false.
 *
 * ```ts
 * class Payment {
 *   @IsIn(['card', 'invoice'])
 *   method: string;
 *
 *   @ValidateIf(o => o.method === 'card')
 *   @IsString()
 *   cardNumber?: string;
 * }
 * ```
 */
export function ValidateIf(condition: (object: any) => boolean) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.CONDITION, condition, target, propertyKey);
  };
}

/**
 * @Allow()
 * Declares a property with no constraints of its own.
 *
 * Useful with `unknownKeys: 'strip'` or `'error'`, where a property has to be declared to
 * survive the payload even though nothing about its value needs checking.
 */
export function Allow() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
  };
}

/**
 * @ValidateNested(options?: ValidationOptions)
 * Recursively validates the value of this property.
 *
 * `{ each: true }` documents that the property holds a collection; nested validation
 * already recurses into arrays, but passing `each` additionally asserts that the value
 * really is an array.
 */
export function ValidateNested(options?: ValidationOptions) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    // This is a marker for recursive validation
    metadataStorage.defineMetadata(METADATA_KEYS.NESTED, true, target, propertyKey);

    if (options?.each) {
      addValidation(target, propertyKey, {
        name: 'nestedEach',
        validate: (v) => Array.isArray(v),
        message: `${propertyKey} must be an array`
      });
    }
  };
}

/**
 * Custom validation decorator that uses a validator class or function.
 */
export function Validate(
  validator: ClassConstructor<ValidatorConstraintInterface> | ((value: any, args: ValidationArguments) => boolean | Promise<boolean>),
  constraintsOrOptions?: any[] | ValidationOptions,
  options?: ValidationOptions
) {
  return (target: any, propertyKey: string) => {
    let constraints: any[] = [];
    let validationOptions: ValidationOptions | undefined;

    if (Array.isArray(constraintsOrOptions)) {
      constraints = constraintsOrOptions;
      validationOptions = options;
    } else if (typeof constraintsOrOptions === 'object') {
      validationOptions = constraintsOrOptions;
    }

    if (typeof validator === 'function' && !validator.prototype?.validate) {
      // Functional validator
      addValidation(target, propertyKey, {
        name: 'custom',
        validate: validator as (value: any, args: ValidationArguments) => boolean,
        message: (args) => `${args.property} is invalid`,
        constraints
      }, validationOptions);
    } else {
      // Class validator
      const constraintInstance = new (validator as ClassConstructor<ValidatorConstraintInterface>)();
      addValidation(target, propertyKey, {
        name: (validator as any).name,
        validate: (v, a) => constraintInstance.validate(v, a),
        message: (a) => constraintInstance.defaultMessage ? constraintInstance.defaultMessage(a) : `${a.property} is invalid`,
        constraints
      }, validationOptions);
    }
  };
}

/**
 * Helper to register a custom decorator.
 */
export function registerDecorator(options: {
  name: string;
  target: any;
  propertyName: string;
  options?: ValidationOptions;
  constraints?: any[];
  validator: ValidatorConstraintInterface | ClassConstructor<ValidatorConstraintInterface> | ((value: any, args: ValidationArguments) => boolean | Promise<boolean>);
}) {
  const { name, target, propertyName, options: validationOptions, constraints, validator } = options;
  
  let validationConstraint: ValidationConstraint;
  
  if (typeof validator === 'function' && !validator.prototype?.validate) {
    validationConstraint = {
      name,
      validate: validator as (value: any, args: ValidationArguments) => boolean,
      message: (args) => `${args.property} is invalid`,
      ...(constraints ? { constraints } : {})
    };
  } else {
    const constraintInstance = typeof validator === 'function' 
      ? new (validator as ClassConstructor<ValidatorConstraintInterface>)() 
      : validator as ValidatorConstraintInterface;
      
    validationConstraint = {
      name,
      validate: (v, a) => constraintInstance.validate(v, a),
      message: (a) => constraintInstance.defaultMessage ? constraintInstance.defaultMessage(a) : `${a.property} is invalid`,
      ...(constraints ? { constraints } : {})
    };
  }
  
  addValidation(target.prototype, propertyName, validationConstraint, validationOptions);
}
