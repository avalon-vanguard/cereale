import { ClassConstructor } from './interfaces.js';
import { METADATA_KEYS, PropertyAccess, ValidationConstraint, ValidationArguments } from './decorators.js';
import { metadataStorage } from './metadata-storage.js';
import { NamingStrategyFn, resolveNamingStrategy } from './naming.js';
import { TransformOptions, UnknownKeyPolicy, resolveOptions } from './config.js';

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

interface SerializeContext {
  naming: NamingStrategyFn;
}

interface DeserializeContext {
  naming: NamingStrategyFn;
  namingKey: unknown;
  unknownKeys: UnknownKeyPolicy;
}

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

function accessOf(target: any, key: string): PropertyAccess {
  return (target ? metadataStorage.getMetadata(METADATA_KEYS.ACCESS, target, key) : undefined) ?? 'readwrite';
}

/** The name this property takes in JSON: an explicit @JsonProperty, else the naming strategy. */
function outboundName(target: any, key: string, naming: NamingStrategyFn): string {
  const explicit = target ? metadataStorage.getMetadata(METADATA_KEYS.NAME, target, key) : undefined;
  return explicit ?? naming(key);
}

interface InboundNames {
  /** JSON name -> property key, for properties this payload is allowed to set. */
  accept: Map<string, string>;
  /**
   * JSON names that belong to a declared property the payload may NOT set
   * (`@JsonIgnore` / `@JsonReadOnly`). They are dropped rather than treated as unknown
   * keys — otherwise the default `unknownKeys: 'allow'` policy would copy them straight
   * back onto the instance and undo the protection.
   */
  blocked: Set<string>;
}

// Name maps are derived purely from decorator metadata, which is fixed once a class is
// declared, so they are cached per (prototype, naming strategy).
const inboundCache = new WeakMap<object, Map<unknown, InboundNames>>();

/**
 * Builds the JSON-name -> property-key lookup used when reading a payload.
 *
 * Only names the class actually declares are accepted: the `@JsonProperty` name (or the
 * naming strategy's rendering of the property name) plus any `@JsonAlias`. Renaming a
 * property therefore stops the old name from being silently accepted — add `@JsonAlias` to
 * keep it working for older clients.
 */
function inboundNameMap(target: any, ctx: DeserializeContext): InboundNames {
  let byStrategy = inboundCache.get(target);
  if (!byStrategy) {
    byStrategy = new Map();
    inboundCache.set(target, byStrategy);
  }
  const cached = byStrategy.get(ctx.namingKey);
  if (cached) return cached;

  const accept = new Map<string, string>();
  const blocked = new Set<string>();

  const claim = (external: string, key: string) => {
    const owner = accept.get(external);
    if (owner && owner !== key) {
      throw new JsonMappingError(
        `Properties "${owner}" and "${key}" both map to the JSON name ${JSON.stringify(external)}. ` +
        `Give one of them a distinct @JsonProperty name.`
      );
    }
    accept.set(external, key);
  };

  for (const key of metadataStorage.getProperties(target)) {
    const names = [
      outboundName(target, key, ctx.naming),
      ...(metadataStorage.getMetadata(METADATA_KEYS.ALIASES, target, key) || []),
    ];

    const access = accessOf(target, key);
    if (access === 'none' || access === 'readonly') {
      for (const name of names) blocked.add(name);
      continue;
    }

    for (const name of names) claim(name, key);
  }

  const result = { accept, blocked };
  byStrategy.set(ctx.namingKey, result);
  return result;
}

async function serialize(obj: any, ancestors: Set<any>, ctx: SerializeContext): Promise<any> {
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
        out.push(await serialize(item, ancestors, ctx));
      }
      return out;
    }

    const target = prototypeOf(obj);

    const result: any = {};
    for (const key of Object.keys(obj)) {
      const access = accessOf(target, key);
      // `writeonly` is accepted on input but must never be echoed back out.
      if (access === 'none' || access === 'writeonly') continue;

      const value = obj[key];
      const name = outboundName(target, key, ctx.naming);

      // Custom serializers only see real values. Handing a serializer `undefined` for a
      // property that was simply never set turns an optional field into a crash.
      const serializerCls = target ? metadataStorage.getMetadata(METADATA_KEYS.SERIALIZER, target, key) : undefined;
      if (serializerCls && value !== null && value !== undefined) {
        const serializer = new serializerCls();
        result[name] = await serializer.serialize(value);
      } else {
        result[name] = await serialize(value, ancestors, ctx);
      }
    }

    return result;
  } finally {
    // Only direct ancestors count as a cycle; the same object appearing twice in
    // sibling positions (a diamond) is perfectly serializable.
    ancestors.delete(obj);
  }
}

async function deserialize<T>(clazz: ClassConstructor<T>, plain: any, ctx: DeserializeContext): Promise<T> {
  if (plain === null || plain === undefined) return plain;

  if (Array.isArray(plain)) {
    const results = await Promise.all(plain.map(item => deserialize(clazz, item, ctx)));
    return results as any;
  }

  if (typeof plain !== 'object') return plain;

  const instance = new clazz();
  const target = clazz.prototype;
  const inbound = inboundNameMap(target, ctx);

  for (const incoming of Object.keys(plain)) {
    if (FORBIDDEN_KEYS.has(incoming)) continue;

    // A declared property the payload is not allowed to set. Ignoring it is deliberate:
    // rejecting the whole request because a client echoed back a server-owned id is worse
    // than quietly refusing to honour it.
    if (inbound.blocked.has(incoming)) continue;

    const key = inbound.accept.get(incoming);
    if (key === undefined) {
      // Not a declared property under the active naming strategy.
      if (ctx.unknownKeys === 'strip') continue;
      if (ctx.unknownKeys === 'error') {
        throw new JsonMappingError(
          `Unknown property ${JSON.stringify(incoming)} for ${clazz.name}. ` +
          `Allowed: ${[...inbound.accept.keys()].map(k => JSON.stringify(k)).join(', ') || '(none declared)'}.`
        );
      }
      instance[incoming as keyof T] = plain[incoming];
      continue;
    }

    const value = plain[incoming];

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
        if (subTypeInfo) return deserialize(subTypeInfo.value, item, ctx);
        if (fallback) return deserialize(fallback, item, ctx);
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
      instance[key as keyof T] = await deserialize(type, value, ctx);
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

function serializeContext(options?: TransformOptions): SerializeContext {
  const resolved = resolveOptions(options);
  return { naming: resolveNamingStrategy(resolved.namingStrategy) };
}

function deserializeContext(options?: TransformOptions): DeserializeContext {
  const resolved = resolveOptions(options);
  return {
    naming: resolveNamingStrategy(resolved.namingStrategy),
    namingKey: resolved.namingStrategy,
    unknownKeys: resolved.unknownKeys,
  };
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
 * Validates an object and throws {@link JsonValidationError} if it fails.
 *
 * The counterpart to {@link validate} for callers who want an exception rather than an
 * array they have to remember to check.
 */
export async function validateOrReject(obj: any): Promise<void> {
  const errors = await validate(obj);
  if (errors.length > 0) {
    throw new JsonValidationError('Validation failed', errors);
  }
}

/**
 * Converts a class instance to a plain object.
 *
 * Validates first and throws {@link JsonValidationError} on failure, unless
 * `{ validate: false }` is passed.
 *
 * @param obj The class instance to transform
 * @param options Per-call transform options
 * @returns Plain object
 */
export async function toPlain<T>(obj: T, options?: TransformOptions): Promise<any> {
  if (obj === null || obj === undefined) return obj;

  if (resolveOptions(options).validate) {
    const errors = await validate(obj);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during serialization', errors);
    }
  }

  return serialize(obj, new Set(), serializeContext(options));
}

/**
 * Converts a class instance to a JSON string.
 * @param obj The class instance to transform
 * @param options Per-call transform options
 * @returns JSON string
 */
export async function toJson<T>(obj: T, options?: TransformOptions): Promise<string> {
  const plain = await toPlain(obj, options);
  return JSON.stringify(plain);
}

/**
 * Converts a plain object to a class instance.
 *
 * Validates the result and throws {@link JsonValidationError} on failure, unless
 * `{ validate: false }` is passed.
 *
 * @param clazz The class constructor
 * @param plain The plain object to transform
 * @param options Per-call transform options
 * @returns Class instance
 */
export async function toInstance<T>(clazz: ClassConstructor<T>, plain: any, options?: TransformOptions): Promise<T> {
  const instance = await deserialize(clazz, plain, deserializeContext(options));

  if (resolveOptions(options).validate) {
    const errors = await validate(instance);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during deserialization', errors);
    }
  }

  return instance;
}

/**
 * Converts an array of plain objects to an array of class instances.
 *
 * `toInstance` also accepts arrays at runtime, but its return type says `T`. Use this when
 * the payload is a collection so the static type matches what you actually get back.
 *
 * @param clazz The class constructor
 * @param plain The array of plain objects to transform
 * @param options Per-call transform options
 * @returns Array of class instances
 */
export async function toInstanceArray<T>(
  clazz: ClassConstructor<T>,
  plain: any[],
  options?: TransformOptions
): Promise<T[]> {
  if (!Array.isArray(plain)) {
    throw new JsonMappingError(`Expected an array to map to ${clazz.name}[], received ${typeof plain}.`);
  }
  return (await toInstance(clazz, plain, options)) as unknown as T[];
}

/**
 * Parses a JSON string to a class instance.
 * @param clazz The class constructor
 * @param json JSON string
 * @param options Per-call transform options
 * @returns Class instance
 */
export async function fromJson<T>(clazz: ClassConstructor<T>, json: string, options?: TransformOptions): Promise<T> {
  return toInstance(clazz, parseJson(json), options);
}

/**
 * Parses a JSON string containing an array into class instances.
 * @param clazz The class constructor
 * @param json JSON string holding an array
 * @param options Per-call transform options
 * @returns Array of class instances
 */
export async function fromJsonArray<T>(
  clazz: ClassConstructor<T>,
  json: string,
  options?: TransformOptions
): Promise<T[]> {
  return toInstanceArray(clazz, parseJson(json), options);
}

function parseJson(json: string): any {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new JsonMappingError(
      `Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Helper for Fetch-based frameworks (Next.js, Hono, etc.)
 * Extracts JSON from a Request and transforms it to a class instance.
 * @param clazz The class constructor
 * @param request Web Request object
 * @param options Per-call transform options
 * @returns Class instance
 */
export async function fromRequest<T>(
  clazz: ClassConstructor<T>,
  request: Request,
  options?: TransformOptions
): Promise<T> {
  let plain: any;
  try {
    plain = await request.json();
  } catch (error) {
    throw new JsonMappingError(
      `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return toInstance(clazz, plain, options);
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
  static validateOrReject = validateOrReject;
}
