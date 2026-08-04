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

/**
 * Stands in for the value of a property that is never serialized, so that a failing password
 * does not travel inside a ValidationError into whatever logs the caller writes.
 */
export const REDACTED = '[redacted]';

// --- Internal Engine ---

interface SerializeContext {
  naming: NamingStrategyFn;
  namingKey: unknown;
  maxDepth: number;
}

interface DeserializeContext {
  naming: NamingStrategyFn;
  namingKey: unknown;
  unknownKeys: UnknownKeyPolicy;
  maxDepth: number;
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

/** Per-property serialization facts, resolved once instead of per call. */
interface OutboundProperty {
  /** The name to write in the output. */
  name: string;
  /** True for @JsonIgnore / @JsonWriteOnly — omitted from output. */
  skip: boolean;
  /** The @JsonSerialize class, if any. */
  serializer?: any;
}

const outboundCache = new WeakMap<object, { version: number; byStrategy: Map<unknown, Map<string, OutboundProperty>> }>();

/**
 * Resolves how one property is written out, memoized per (prototype, naming strategy).
 *
 * Serialization walks the runtime keys of each object, so undeclared properties turn up here
 * too; they memoize just as well, since the naming strategy is deterministic.
 */
function outboundFor(target: any, key: string, ctx: SerializeContext): OutboundProperty {
  if (!target) {
    // Null-prototype object: nothing is declared, so there is nothing to cache against.
    return { name: ctx.naming(key), skip: false };
  }

  let entry = outboundCache.get(target);
  if (!entry || entry.version !== metadataStorage.version) {
    entry = { version: metadataStorage.version, byStrategy: new Map() };
    outboundCache.set(target, entry);
  }

  let byKey = entry.byStrategy.get(ctx.namingKey);
  if (!byKey) {
    byKey = new Map();
    entry.byStrategy.set(ctx.namingKey, byKey);
  }

  let resolved = byKey.get(key);
  if (!resolved) {
    const access = accessOf(target, key);
    const serializer = metadataStorage.getMetadata(METADATA_KEYS.SERIALIZER, target, key);
    resolved = {
      name: outboundName(target, key, ctx.naming),
      // `writeonly` is accepted on input but must never be echoed back out.
      skip: access === 'none' || access === 'writeonly',
      ...(serializer ? { serializer } : {}),
    };
    byKey.set(key, resolved);
  }
  return resolved;
}

/** Per-property deserialization facts, resolved once instead of per call. */
interface InboundProperty {
  deserializer?: any;
  polymorphic?: any;
  typeFn?: () => ClassConstructor<any>;
}

interface InboundNames {
  /** JSON name -> property key, for properties this payload is allowed to set. */
  accept: Map<string, string>;
  /** property key -> the conversion metadata that applies to it. */
  props: Map<string, InboundProperty>;
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
const inboundCache = new WeakMap<object, { version: number; byStrategy: Map<unknown, InboundNames> }>();

/**
 * Builds the JSON-name -> property-key lookup used when reading a payload.
 *
 * Only names the class actually declares are accepted: the `@JsonProperty` name (or the
 * naming strategy's rendering of the property name) plus any `@JsonAlias`. Renaming a
 * property therefore stops the old name from being silently accepted — add `@JsonAlias` to
 * keep it working for older clients.
 */
function inboundNameMap(target: any, ctx: DeserializeContext): InboundNames {
  let entry = inboundCache.get(target);
  if (!entry || entry.version !== metadataStorage.version) {
    entry = { version: metadataStorage.version, byStrategy: new Map() };
    inboundCache.set(target, entry);
  }
  const cached = entry.byStrategy.get(ctx.namingKey);
  if (cached) return cached;

  const accept = new Map<string, string>();
  const blocked = new Set<string>();
  const props = new Map<string, InboundProperty>();

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

    const deserializer = metadataStorage.getMetadata(METADATA_KEYS.DESERIALIZER, target, key);
    const polymorphic = metadataStorage.getMetadata(METADATA_KEYS.POLYMORPHIC, target, key);
    const typeFn = metadataStorage.getMetadata(METADATA_KEYS.TYPE, target, key);
    if (deserializer || polymorphic || typeFn) {
      props.set(key, {
        ...(deserializer ? { deserializer } : {}),
        ...(polymorphic ? { polymorphic } : {}),
        ...(typeFn ? { typeFn } : {}),
      });
    }
  }

  const result = { accept, blocked, props };
  entry.byStrategy.set(ctx.namingKey, result);
  return result;
}


/**
 * The engines below are written synchronously. Anything a user hook makes asynchronous — a
 * serializer, deserializer or validator that returns a Promise — is recorded here instead of
 * being awaited inline, and reconciled once at the end.
 *
 * This buys two things. The `*Sync` entry points can simply refuse to continue if the list is
 * non-empty, without a second copy of the traversal logic to keep in step. And the async entry
 * points stop paying for a microtask per property on the overwhelmingly common path where no
 * hook is actually asynchronous.
 */
type Deferred = Promise<unknown>[];

function isThenable(value: any): value is Promise<any> {
  return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

/** Settles any deferred work recorded during a traversal. */
async function settle(deferred: Deferred): Promise<void> {
  while (deferred.length > 0) {
    // A hook may itself queue more work (a serializer returning nested async values).
    const batch = deferred.splice(0, deferred.length);
    await Promise.all(batch);
  }
}

/**
 * Rejects a synchronous call that turned out to need asynchronous work.
 */
function refuseAsync(deferred: Deferred, operation: string, asyncName: string): void {
  if (deferred.length === 0) return;
  // Nothing will await these now; swallow rejections so they do not surface as unhandled.
  for (const promise of deferred) promise.catch(() => undefined);
  deferred.length = 0;
  throw new JsonMappingError(
    `${operation} requires every serializer, deserializer and validator to be synchronous, ` +
    `but one returned a Promise. Use ${asyncName} instead, or make the hook synchronous.`
  );
}

function serialize(obj: any, ancestors: Set<any>, ctx: SerializeContext, depth: number, deferred: Deferred): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (depth > ctx.maxDepth) {
    throw new JsonMappingError(
      `Maximum nesting depth of ${ctx.maxDepth} exceeded while serializing. ` +
      `Raise it with the maxDepth option if this structure is legitimate.`
    );
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
        out.push(serialize(item, ancestors, ctx, depth + 1, deferred));
      }
      return out;
    }

    const target = prototypeOf(obj);

    const result: any = {};
    for (const key of Object.keys(obj)) {
      const property = outboundFor(target, key, ctx);
      if (property.skip) continue;

      const value = obj[key];

      // Custom serializers only see real values. Handing a serializer `undefined` for a
      // property that was simply never set turns an optional field into a crash.
      if (property.serializer && value !== null && value !== undefined) {
        const produced = converterFor(property.serializer).serialize(value);
        if (isThenable(produced)) {
          const slot = property.name;
          // Claim the key now so the deferred write lands in declaration order rather than
          // being appended after every synchronous property.
          result[slot] = undefined;
          deferred.push(produced.then((settled: any) => { result[slot] = settled; }));
        } else {
          result[property.name] = produced;
        }
      } else {
        result[property.name] = serialize(value, ancestors, ctx, depth + 1, deferred);
      }
    }

    return result;
  } finally {
    // Only direct ancestors count as a cycle; the same object appearing twice in
    // sibling positions (a diamond) is perfectly serializable.
    ancestors.delete(obj);
  }
}

function deserialize<T>(clazz: ClassConstructor<T>, plain: any, ctx: DeserializeContext, depth: number, deferred: Deferred): T {
  if (plain === null || plain === undefined) return plain;

  if (depth > ctx.maxDepth) {
    throw new JsonMappingError(
      `Maximum nesting depth of ${ctx.maxDepth} exceeded while deserializing. ` +
      `Raise it with the maxDepth option if this structure is legitimate.`
    );
  }

  if (Array.isArray(plain)) {
    return plain.map(item => deserialize(clazz, item, ctx, depth + 1, deferred)) as any;
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

    const property = inbound.props.get(key);

    // Custom Deserializer
    if (property?.deserializer) {
      const produced = converterFor(property.deserializer).deserialize(value);
      if (isThenable(produced)) {
        const slot = key as keyof T;
        // Claim the key now so property order matches the synchronous path.
        instance[slot] = undefined as any;
        deferred.push(produced.then((settled: any) => { instance[slot] = settled; }));
      } else {
        instance[key as keyof T] = produced;
      }
      continue;
    }

    // Polymorphic
    const poly = property?.polymorphic;
    if (poly && value !== null && value !== undefined) {
      const { discriminator, subTypes, onUnknown, fallback } = poly;

      const resolve = (item: any): any => {
        if (item === null || item === undefined || typeof item !== 'object') return item;
        const subTypeInfo = subTypes.find((s: any) => item[discriminator] === s.name);
        if (subTypeInfo) return deserialize(subTypeInfo.value, item, ctx, depth + 1, deferred);
        if (fallback) return deserialize(fallback, item, ctx, depth + 1, deferred);
        if (onUnknown === 'error') {
          throw new JsonMappingError(
            `Unknown discriminator value ${JSON.stringify(item[discriminator])} for property ` +
            `"${key}". Known values: ${subTypes.map((s: any) => JSON.stringify(s.name)).join(', ')}.`
          );
        }
        // Preserve the raw value. Dropping it silently loses data the caller sent.
        return item;
      };

      instance[key as keyof T] = Array.isArray(value) ? value.map(resolve) as any : resolve(value);
      continue;
    }

    // Nested Type
    const typeFn = property?.typeFn;
    if (typeFn && value !== null && value !== undefined) {
      const type = typeFn();
      instance[key as keyof T] = deserialize(type, value, ctx, depth + 1, deferred);
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
 * Everything the validator needs to know about one property, resolved once.
 */
interface PropertyPlan {
  key: string;
  constraints: ValidationConstraint[];
  isOptional: boolean;
  isNested: boolean;
  /** True for properties that never leave the process (@JsonWriteOnly / @JsonIgnore). */
  redact: boolean;
  condition?: (object: any) => boolean;
}

interface CachedPlan {
  version: number;
  plan: PropertyPlan[];
}

// Resolving a class's validation rules means walking its prototype chain several times per
// property, per call — which profiling showed to be roughly half of all validation time,
// recomputing an answer that cannot change. The result is memoized per prototype and
// invalidated by MetadataStorage's version counter, so metadata registered late still works.
const planCache = new WeakMap<object, CachedPlan>();

function validationPlan(target: any): PropertyPlan[] {
  const cached = planCache.get(target);
  if (cached && cached.version === metadataStorage.version) {
    return cached.plan;
  }

  const plan: PropertyPlan[] = [];
  for (const key of metadataStorage.getProperties(target)) {
    const condition = metadataStorage.getMetadata(METADATA_KEYS.CONDITION, target, key);
    const access = accessOf(target, key);
    plan.push({
      key,
      constraints: collectConstraints(target, key),
      isOptional: !!metadataStorage.getMetadata(METADATA_KEYS.IS_OPTIONAL, target, key),
      isNested: !!metadataStorage.getMetadata(METADATA_KEYS.NESTED, target, key),
      redact: access === 'writeonly' || access === 'none',
      ...(condition ? { condition } : {}),
    });
  }

  planCache.set(target, { version: metadataStorage.version, plan });
  return plan;
}

// Serializers and deserializers are stateless by contract, so one instance per class is
// enough. Constructing a fresh one for every property of every object was pure waste.
const converterCache = new WeakMap<object, any>();

function converterFor(clazz: any): any {
  let instance = converterCache.get(clazz);
  if (!instance) {
    instance = new clazz();
    converterCache.set(clazz, instance);
  }
  return instance;
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


interface EachOutcome {
  ok: boolean;
  /** Index of the element that failed, or -1. */
  index: number;
}

/** Builds the reported message, applying the `each` decoration only to library defaults. */
function messageFor(constraint: ValidationConstraint, args: ValidationArguments, failedIndex: number): string {
  let message = typeof constraint.message === 'function' ? constraint.message(args) : constraint.message;
  if (constraint.each && !constraint.hasCustomMessage) {
    message = failedIndex >= 0
      ? `each element in ${message} (failed at index ${failedIndex})`
      : `each element in ${message}`;
  }
  return message;
}

/**
 * Runs an `each: true` constraint over an array, staying synchronous until a validator
 * actually returns a Promise and only then continuing asynchronously.
 */
function evaluateEach(constraint: ValidationConstraint, items: any[], args: ValidationArguments): EachOutcome | Promise<EachOutcome> {
  for (let i = 0; i < items.length; i++) {
    args.value = items[i];
    const result = constraint.validate(items[i], args);
    if (isThenable(result)) {
      const base = { object: args.object, property: args.property, constraints: args.constraints };
      const tail = finishEach(constraint, items, i, result, base);
      args.value = items;
      return tail;
    }
    if (!result) {
      args.value = items;
      return { ok: false, index: i };
    }
  }
  args.value = items;
  return { ok: true, index: -1 };
}

async function finishEach(
  constraint: ValidationConstraint,
  items: any[],
  startIndex: number,
  firstResult: Promise<boolean>,
  base: Omit<ValidationArguments, 'value'>
): Promise<EachOutcome> {
  if (!(await firstResult)) return { ok: false, index: startIndex };
  for (let i = startIndex + 1; i < items.length; i++) {
    if (!(await constraint.validate(items[i], { ...base, value: items[i] }))) {
      return { ok: false, index: i };
    }
  }
  return { ok: true, index: -1 };
}

/**
 * Drops entries that ended up with nothing to report.
 *
 * With an asynchronous validator the verdict is not known while the tree is being built, so
 * candidate entries are created up front and pruned once everything has settled.
 */
function pruneErrors(errors: ValidationError[]): ValidationError[] {
  const kept: ValidationError[] = [];
  for (const error of errors) {
    const children = error.children ? pruneErrors(error.children) : undefined;
    if (children && children.length > 0) {
      error.children = children;
    } else {
      delete error.children;
    }
    if (Object.keys(error.constraints).length > 0 || error.children) {
      kept.push(error);
    }
  }
  return kept;
}

function validateInternal(obj: any, ancestors: Set<any>, depth: number, maxDepth: number, deferred: Deferred): ValidationError[] {
  const errors: ValidationError[] = [];
  if (obj === null || obj === undefined || typeof obj !== 'object') return errors;

  if (depth > maxDepth) {
    throw new JsonMappingError(
      `Maximum nesting depth of ${maxDepth} exceeded while validating. ` +
      `Raise it with the maxDepth option if this structure is legitimate.`
    );
  }

  // A cycle has already been validated further up the stack; re-entering it would never
  // terminate. Diamonds are still validated on each distinct path.
  if (ancestors.has(obj)) return errors;
  ancestors.add(obj);

  try {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const childErrors = validateInternal(obj[i], ancestors, depth + 1, maxDepth, deferred);
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

    for (const property of validationPlan(target)) {
      const key = property.key;
      const value = obj[key];

      // Handle @ValidateIf — a false condition takes the property out of validation entirely.
      if (property.condition && !property.condition(obj)) {
        continue;
      }

      // Handle IsOptional
      if (property.isOptional && (value === null || value === undefined)) {
        continue;
      }

      const propertyErrors: ValidationError = {
        property: key,
        // A property that never leaves the process — a @JsonWriteOnly password, say — must
        // not have its value copied into an error object that is about to be logged.
        value: property.redact ? REDACTED : value,
        constraints: {}
      };

      const validationArgs: ValidationArguments = {
        value: value,
        object: obj,
        property: key,
        constraints: []
      };

      let awaited = false;

      for (const constraint of property.constraints) {
        validationArgs.constraints = constraint.constraints || [];

        const outcome: EachOutcome | Promise<EachOutcome> = constraint.each && Array.isArray(value)
          // Report which element failed. Previously the index was discarded, so a bad entry
          // in a 200-item array produced a message that could not locate it.
          ? evaluateEach(constraint, value, validationArgs)
          : (() => {
              const result = constraint.validate(value, validationArgs);
              return isThenable(result)
                ? result.then((ok: boolean) => ({ ok, index: -1 }))
                : { ok: result as boolean, index: -1 };
            })();

        if (isThenable(outcome)) {
          awaited = true;
          // The shared args object is reused as the loop advances, so snapshot what the
          // message will need before handing control back.
          const snapshot: ValidationArguments = {
            value: value,
            object: obj,
            property: key,
            constraints: constraint.constraints || []
          };
          deferred.push(outcome.then(({ ok, index }: EachOutcome) => {
            if (ok) return;
            if (index >= 0) snapshot.value = value[index];
            recordFailure(propertyErrors.constraints, constraint.name, messageFor(constraint, snapshot, index));
          }));
          continue;
        }

        if (!outcome.ok) {
          if (outcome.index >= 0) validationArgs.value = value[outcome.index];
          const message = messageFor(constraint, validationArgs, outcome.index);
          validationArgs.value = value;
          recordFailure(propertyErrors.constraints, constraint.name, message);
        }
      }

      // Recursive validation
      if (property.isNested && value !== null && value !== undefined) {
        const nestedErrors = validateInternal(value, ancestors, depth + 1, maxDepth, deferred);
        if (nestedErrors.length > 0) {
          propertyErrors.children = nestedErrors;
        }
      }

      // `awaited` entries are kept provisionally: their verdict is not known yet, and
      // pruneErrors() drops the ones that turn out to be clean.
      if (awaited || Object.keys(propertyErrors.constraints).length > 0 || propertyErrors.children) {
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
  return {
    naming: resolveNamingStrategy(resolved.namingStrategy),
    namingKey: resolved.namingStrategy,
    maxDepth: resolved.maxDepth,
  };
}

function deserializeContext(options?: TransformOptions): DeserializeContext {
  const resolved = resolveOptions(options);
  return {
    naming: resolveNamingStrategy(resolved.namingStrategy),
    namingKey: resolved.namingStrategy,
    unknownKeys: resolved.unknownKeys,
    maxDepth: resolved.maxDepth,
  };
}

// --- Public API Functions ---

/**
 * Validates a class instance or object against its decorators.
 *
 * @param obj The object to validate
 * @param options Per-call options (currently `maxDepth`)
 * @returns Array of validation errors
 */
export async function validate(obj: any, options?: TransformOptions): Promise<ValidationError[]> {
  const deferred: Deferred = [];
  const errors = validateInternal(obj, new Set(), 0, resolveOptions(options).maxDepth, deferred);
  if (deferred.length === 0) return errors;
  await settle(deferred);
  return pruneErrors(errors);
}

/**
 * Synchronous {@link validate}.
 *
 * @throws JsonMappingError if any validator returns a Promise.
 */
export function validateSync(obj: any, options?: TransformOptions): ValidationError[] {
  const deferred: Deferred = [];
  const errors = validateInternal(obj, new Set(), 0, resolveOptions(options).maxDepth, deferred);
  refuseAsync(deferred, 'validateSync()', 'validate()');
  return errors;
}

/**
 * Validates an object and throws {@link JsonValidationError} if it fails.
 *
 * The counterpart to {@link validate} for callers who want an exception rather than an
 * array they have to remember to check.
 */
export async function validateOrReject(obj: any, options?: TransformOptions): Promise<void> {
  const errors = await validate(obj, options);
  if (errors.length > 0) {
    throw new JsonValidationError('Validation failed', errors);
  }
}

/** Synchronous {@link validateOrReject}. */
export function validateOrRejectSync(obj: any, options?: TransformOptions): void {
  const errors = validateSync(obj, options);
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
    const errors = await validate(obj, options);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during serialization', errors);
    }
  }

  const deferred: Deferred = [];
  const plain = serialize(obj, new Set(), serializeContext(options), 0, deferred);
  await settle(deferred);
  return plain;
}

/**
 * Synchronous {@link toPlain}.
 *
 * @throws JsonMappingError if any serializer or validator returns a Promise.
 */
export function toPlainSync<T>(obj: T, options?: TransformOptions): any {
  if (obj === null || obj === undefined) return obj;

  if (resolveOptions(options).validate) {
    const errors = validateSync(obj, options);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during serialization', errors);
    }
  }

  const deferred: Deferred = [];
  const plain = serialize(obj, new Set(), serializeContext(options), 0, deferred);
  refuseAsync(deferred, 'toPlainSync()', 'toPlain()');
  return plain;
}

/**
 * Converts a class instance to a JSON string.
 * @param obj The class instance to transform
 * @param options Per-call transform options
 * @returns JSON string
 */
export async function toJson<T>(obj: T, options?: TransformOptions): Promise<string> {
  return JSON.stringify(await toPlain(obj, options));
}

/** Synchronous {@link toJson}. */
export function toJsonSync<T>(obj: T, options?: TransformOptions): string {
  return JSON.stringify(toPlainSync(obj, options));
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
  const deferred: Deferred = [];
  const instance = deserialize(clazz, plain, deserializeContext(options), 0, deferred);
  await settle(deferred);

  if (resolveOptions(options).validate) {
    const errors = await validate(instance, options);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during deserialization', errors);
    }
  }

  return instance;
}

/**
 * Synchronous {@link toInstance}.
 *
 * @throws JsonMappingError if any deserializer or validator returns a Promise.
 */
export function toInstanceSync<T>(clazz: ClassConstructor<T>, plain: any, options?: TransformOptions): T {
  const deferred: Deferred = [];
  const instance = deserialize(clazz, plain, deserializeContext(options), 0, deferred);
  refuseAsync(deferred, 'toInstanceSync()', 'toInstance()');

  if (resolveOptions(options).validate) {
    const errors = validateSync(instance, options);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during deserialization', errors);
    }
  }

  return instance;
}

function requireArray<T>(clazz: ClassConstructor<T>, plain: any): void {
  if (!Array.isArray(plain)) {
    throw new JsonMappingError(`Expected an array to map to ${clazz.name}[], received ${typeof plain}.`);
  }
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
  requireArray(clazz, plain);
  return (await toInstance(clazz, plain, options)) as unknown as T[];
}

/** Synchronous {@link toInstanceArray}. */
export function toInstanceArraySync<T>(
  clazz: ClassConstructor<T>,
  plain: any[],
  options?: TransformOptions
): T[] {
  requireArray(clazz, plain);
  return toInstanceSync(clazz, plain, options) as unknown as T[];
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

/** Synchronous {@link fromJson}. */
export function fromJsonSync<T>(clazz: ClassConstructor<T>, json: string, options?: TransformOptions): T {
  return toInstanceSync(clazz, parseJson(json), options);
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

/** Synchronous {@link fromJsonArray}. */
export function fromJsonArraySync<T>(
  clazz: ClassConstructor<T>,
  json: string,
  options?: TransformOptions
): T[] {
  return toInstanceArraySync(clazz, parseJson(json), options);
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
 *
 * There is no synchronous counterpart: reading a Request body is inherently asynchronous.
 *
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
