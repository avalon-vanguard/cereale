import { ClassConstructor } from './interfaces.js';
import { METADATA_KEYS, ValidationConstraint, ValidationArguments } from './decorators.js';
import { metadataStorage } from './metadata-storage.js';

export interface ValidationError {
  property: string;
  value: any;
  constraints: { [key: string]: string };
  children?: ValidationError[];
}

export class JsonValidationError extends Error {
  constructor(message: string, public errors: ValidationError[]) {
    super(message);
    this.name = 'JsonValidationError';
  }

  override toString() {
    return `${this.message}: ${JSON.stringify(this.errors, null, 2)}`;
  }
}

/**
 * Thrown when a value cannot be mapped at all — as opposed to mapping fine but failing
 * validation, which raises {@link JsonValidationError}.
 */
export class JsonMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonMappingError';
  }
}

/**
 * Keys that must never be copied from untrusted input onto an instance. Assigning
 * `__proto__` swaps an object's prototype, and `constructor` / `prototype` are the usual
 * next steps in a pollution chain. This library exists to parse request bodies, so the
 * transform layer drops them rather than trusting callers to sanitise first.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- Internal Engine ---

/**
 * Resolves the metadata lookup target for a value.
 *
 * `Object.getPrototypeOf` rather than `obj.constructor.prototype`: the latter throws on
 * null-prototype objects (which have no `constructor`) and lies for instances whose
 * `constructor` property has been overwritten.
 */
function prototypeOf(obj: any): any {
  return Object.getPrototypeOf(obj) ?? undefined;
}

async function serialize(obj: any, ancestors: Set<any>): Promise<any> {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (ancestors.has(obj)) {
    throw new JsonMappingError(
      'Circular reference detected during serialization. Break the cycle with @JsonIgnore() ' +
      'on the back-reference, or supply a @JsonSerialize() serializer for that property.'
    );
  }

  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out: any[] = [];
      for (const item of obj) {
        out.push(await serialize(item, ancestors));
      }
      return out;
    }

    const target = prototypeOf(obj);

    const result: any = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];

      // Custom serializers only see real values. Handing a serializer `undefined` for a
      // property that was simply never set turns an optional field into a crash.
      const serializerCls = target ? metadataStorage.getMetadata(METADATA_KEYS.SERIALIZER, target, key) : undefined;
      if (serializerCls && value !== null && value !== undefined) {
        const serializer = new serializerCls();
        result[key] = await serializer.serialize(value);
      } else {
        result[key] = await serialize(value, ancestors);
      }
    }

    return result;
  } finally {
    // Only direct ancestors count as a cycle; the same object appearing twice in
    // sibling positions (a diamond) is perfectly serializable.
    ancestors.delete(obj);
  }
}

async function deserialize<T>(clazz: ClassConstructor<T>, plain: any): Promise<T> {
  if (plain === null || plain === undefined) return plain;

  if (Array.isArray(plain)) {
    const results = await Promise.all(plain.map(item => deserialize(clazz, item)));
    return results as any;
  }

  if (typeof plain !== 'object') return plain;

  const instance = new clazz();
  const target = clazz.prototype;

  // Copy all properties from plain to instance
  for (const key of Object.keys(plain)) {
    if (FORBIDDEN_KEYS.has(key)) continue;

    const value = plain[key];

    // Custom Deserializer
    const deserializerCls = metadataStorage.getMetadata(METADATA_KEYS.DESERIALIZER, target, key);
    if (deserializerCls) {
      const deserializer = new deserializerCls();
      instance[key as keyof T] = await deserializer.deserialize(value);
      continue;
    }

    // Polymorphic
    const poly = metadataStorage.getMetadata(METADATA_KEYS.POLYMORPHIC, target, key);
    if (poly && value !== null && value !== undefined) {
      const { discriminator, subTypes, onUnknown, fallback } = poly;

      const resolve = async (item: any): Promise<any> => {
        if (item === null || item === undefined || typeof item !== 'object') return item;
        const subTypeInfo = subTypes.find((s: any) => item[discriminator] === s.name);
        if (subTypeInfo) return deserialize(subTypeInfo.value, item);
        if (fallback) return deserialize(fallback, item);
        if (onUnknown === 'error') {
          throw new JsonMappingError(
            `Unknown discriminator value ${JSON.stringify(item[discriminator])} for property ` +
            `"${key}". Known values: ${subTypes.map((s: any) => JSON.stringify(s.name)).join(', ')}.`
          );
        }
        // Preserve the raw value. Dropping it silently loses data the caller sent.
        return item;
      };

      instance[key as keyof T] = Array.isArray(value)
        ? (await Promise.all(value.map(resolve))) as any
        : await resolve(value);
      continue;
    }

    // Nested Type
    const typeFn = metadataStorage.getMetadata(METADATA_KEYS.TYPE, target, key);
    if (typeFn && value !== null && value !== undefined) {
      const type = typeFn();
      instance[key as keyof T] = await deserialize(type, value);
      continue;
    }

    instance[key as keyof T] = value;
  }

  return instance;
}

/**
 * Collects the validation constraints that apply to a property, merged across the whole
 * prototype chain.
 *
 * A subclass that re-decorates an inherited property registers its constraints against its
 * own prototype. Reading only the nearest set would silently drop everything the base class
 * declared, so the chain is flattened base-first. Constraints that are genuinely identical
 * (same rule, same fixed message) are collapsed so that re-stating `@IsString()` on an
 * override does not report the same failure twice; anything with a computed message — custom
 * validators in particular — is always kept.
 */
function collectConstraints(target: any, key: string): ValidationConstraint[] {
  const levels: ValidationConstraint[][] = metadataStorage.getMetadataChain(METADATA_KEYS.VALIDATION, target, key);
  const merged: ValidationConstraint[] = [];
  const seen = new Set<string>();

  for (const level of levels) {
    for (const constraint of level) {
      if (typeof constraint.message === 'string') {
        const identity = `${constraint.name}|${String(constraint.constraints)}|${constraint.message}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
      }
      merged.push(constraint);
    }
  }

  return merged;
}

/**
 * Records a failure without letting a later constraint overwrite an earlier one that happens
 * to share a name (two `@Min` rules, or a rule inherited and re-declared).
 */
function recordFailure(constraints: { [key: string]: string }, name: string, message: string) {
  if (!(name in constraints)) {
    constraints[name] = message;
    return;
  }
  let suffix = 2;
  while (`${name}_${suffix}` in constraints) suffix++;
  constraints[`${name}_${suffix}`] = message;
}

async function validateInternal(obj: any, ancestors: Set<any>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  if (obj === null || obj === undefined || typeof obj !== 'object') return errors;

  // A cycle has already been validated further up the stack; re-entering it would never
  // terminate. Diamonds are still validated on each distinct path.
  if (ancestors.has(obj)) return errors;
  ancestors.add(obj);

  try {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const childErrors = await validateInternal(obj[i], ancestors);
        if (childErrors.length > 0) {
          errors.push({
            property: `[${i}]`,
            value: obj[i],
            constraints: {},
            children: childErrors
          });
        }
      }
      return errors;
    }

    const target = prototypeOf(obj);
    if (!target) return errors;

    const properties: string[] = metadataStorage.getProperties(target);

    for (const key of properties) {
      const value = obj[key];
      const propertyErrors: ValidationError = {
        property: key,
        value: value,
        constraints: {}
      };

      // Handle IsOptional
      const isOptional = metadataStorage.getMetadata(METADATA_KEYS.IS_OPTIONAL, target, key);
      const isNullOrUndefined = value === null || value === undefined;

      if (isOptional && isNullOrUndefined) {
        continue;
      }

      // Check validation constraints
      const constraints = collectConstraints(target, key);
      const validationArgs: ValidationArguments = {
        value: value,
        object: obj,
        property: key,
        constraints: []
      };

      for (const constraint of constraints) {
        validationArgs.constraints = constraint.constraints || [];

        let isValid = true;
        if (constraint.each && Array.isArray(value)) {
          for (const item of value) {
            const itemArgs = { ...validationArgs, value: item };
            if (!(await constraint.validate(item, itemArgs))) {
              isValid = false;
              break;
            }
          }
        } else {
          isValid = await constraint.validate(value, validationArgs);
        }

        if (!isValid) {
          let message = typeof constraint.message === 'function'
            ? constraint.message(validationArgs)
            : constraint.message;

          // Only decorate the library's own default wording. A message the caller wrote
          // is reported verbatim — prefixing it produced sentences like
          // "each element in tags must all be strings".
          if (constraint.each && !constraint.hasCustomMessage) {
            message = `each element in ${message}`;
          }

          recordFailure(propertyErrors.constraints, constraint.name, message);
        }
      }

      // Recursive validation
      const isNested = metadataStorage.getMetadata(METADATA_KEYS.NESTED, target, key);
      if (isNested && value !== null && value !== undefined) {
        const nestedErrors = await validateInternal(value, ancestors);
        if (nestedErrors.length > 0) {
          propertyErrors.children = nestedErrors;
        }
      }

      if (Object.keys(propertyErrors.constraints).length > 0 || propertyErrors.children) {
        errors.push(propertyErrors);
      }
    }

    return errors;
  } finally {
    ancestors.delete(obj);
  }
}

// --- Public API Functions ---

/**
 * Validates a class instance or object against its decorators.
 * @param obj The object to validate
 * @returns Array of validation errors
 */
export async function validate(obj: any): Promise<ValidationError[]> {
  return validateInternal(obj, new Set());
}

/**
 * Converts a class instance to a plain object with validation.
 * @param obj The class instance to transform
 * @returns Plain object
 */
export async function toPlain<T>(obj: T): Promise<any> {
  if (obj === null || obj === undefined) return obj;

  const errors = await validate(obj);
  if (errors.length > 0) {
    throw new JsonValidationError('Validation failed during serialization', errors);
  }

  return serialize(obj, new Set());
}

/**
 * Converts a class instance to a JSON string with validation.
 * @param obj The class instance to transform
 * @returns JSON string
 */
export async function toJson<T>(obj: T): Promise<string> {
  const plain = await toPlain(obj);
  return JSON.stringify(plain);
}

/**
 * Converts a plain object to a class instance with validation.
 * @param clazz The class constructor
 * @param plain The plain object to transform
 * @returns Validated class instance
 */
export async function toInstance<T>(clazz: ClassConstructor<T>, plain: any): Promise<T> {
  const instance = await deserialize(clazz, plain);

  const errors = await validate(instance);
  if (errors.length > 0) {
    throw new JsonValidationError('Validation failed during deserialization', errors);
  }

  return instance;
}

/**
 * Converts an array of plain objects to an array of class instances with validation.
 *
 * `toInstance` also accepts arrays at runtime, but its return type says `T`. Use this when
 * the payload is a collection so the static type matches what you actually get back.
 *
 * @param clazz The class constructor
 * @param plain The array of plain objects to transform
 * @returns Validated array of class instances
 */
export async function toInstanceArray<T>(clazz: ClassConstructor<T>, plain: any[]): Promise<T[]> {
  if (!Array.isArray(plain)) {
    throw new JsonMappingError(`Expected an array to map to ${clazz.name}[], received ${typeof plain}.`);
  }
  return (await toInstance(clazz, plain)) as unknown as T[];
}

/**
 * Parses a JSON string to a class instance with validation.
 * @param clazz The class constructor
 * @param json JSON string
 * @returns Validated class instance
 */
export async function fromJson<T>(clazz: ClassConstructor<T>, json: string): Promise<T> {
  const plain = JSON.parse(json);
  return toInstance(clazz, plain);
}

/**
 * Parses a JSON string containing an array into validated class instances.
 * @param clazz The class constructor
 * @param json JSON string holding an array
 * @returns Validated array of class instances
 */
export async function fromJsonArray<T>(clazz: ClassConstructor<T>, json: string): Promise<T[]> {
  return toInstanceArray(clazz, JSON.parse(json));
}

/**
 * Helper for Fetch-based frameworks (Next.js, Hono, etc.)
 * Extracts JSON from a Request and transforms it to a validated instance.
 * @param clazz The class constructor
 * @param request Web Request object
 * @returns Validated class instance
 */
export async function fromRequest<T>(clazz: ClassConstructor<T>, request: Request): Promise<T> {
  let plain: any;
  try {
    plain = await request.json();
  } catch (error) {
    throw new JsonMappingError(
      `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return toInstance(clazz, plain);
}

/**
 * @deprecated Use standalone functions like toPlain, toInstance, etc.
 */
export class JsonMapper {
  static toPlain = toPlain;
  static toJson = toJson;
  static toInstance = toInstance;
  static toInstanceArray = toInstanceArray;
  static fromJson = fromJson;
  static fromJsonArray = fromJsonArray;
  static fromRequest = fromRequest;
  static validate = validate;
}
