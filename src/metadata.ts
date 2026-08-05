import type { ClassConstructor } from './interfaces.js';

/**
 * The key decorator metadata is stored under.
 *
 * Resolved into a binding rather than read as `Symbol.metadata` at each use. If the well-known
 * symbol is absent, `Symbol.metadata` evaluates to `undefined` and `clazz[undefined]` quietly
 * reads a property literally named "undefined" — `modelOf` would return an empty model and
 * every object would validate clean. Silent success is the worst failure mode a validation
 * library can have, so the fallback is baked into the value the code actually uses.
 *
 * `Symbol.for` matches what the decorator transforms emit (esbuild's `__knownSymbol` uses the
 * same fallback), and keeps the key identical across duplicate copies of the library, which
 * the dual ESM/CJS build can otherwise produce.
 */
const METADATA_KEY: symbol = (Symbol as { metadata?: symbol }).metadata ?? Symbol.for('Symbol.metadata');

// Also installed globally, because a consumer's own compiler emit may read `Symbol.metadata`
// directly. package.json marks this module as having side effects so it survives bundling.
((Symbol as { metadata?: symbol }).metadata as symbol | undefined) ??= METADATA_KEY;

export interface ValidationArguments {
  value: any;
  object: any;
  property: string;
  constraints: any[];
}

export interface ValidationOptions {
  /** Apply the rule to each element of an array rather than to the array itself. */
  each?: boolean;
  /** Replaces the built-in message. Reported verbatim — the engine never decorates it. */
  message?: string | ((args: ValidationArguments) => string);
}

/** Narrowed form used by the `each: true` decorator overloads. */
export interface EachValidationOptions extends ValidationOptions {
  each: true;
}

export type ValidationConstraint = {
  name: string;
  validate: (value: any, args: ValidationArguments) => boolean | Promise<boolean>;
  message: string | ((args: ValidationArguments) => string);
  constraints?: any[];
  each?: boolean;
  /**
   * True when the message came from the caller. The engine only decorates its own default
   * wording with the "each element in ..." prefix.
   */
  hasCustomMessage?: boolean;
};

export interface ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean | Promise<boolean>;
  defaultMessage?(args: ValidationArguments): string;
}

/**
 * Which directions a property participates in.
 *
 * - `readwrite` (default): mapped both ways.
 * - `readonly`: written to JSON, never populated from incoming JSON (server-assigned ids).
 * - `writeonly`: populated from incoming JSON, never written back out (passwords).
 * - `none`: ignored entirely.
 */
export type PropertyAccess = 'readwrite' | 'readonly' | 'writeonly' | 'none';

export interface PolymorphicInfo {
  discriminator: string;
  subTypes: { value: ClassConstructor<any>; name: string }[];
  onUnknown: 'keep' | 'error';
  fallback?: ClassConstructor<any>;
}

/** Everything cereale knows about one field. */
export interface PropertyModel {
  constraints: ValidationConstraint[];
  optional?: boolean;
  nested?: boolean;
  condition?: (object: any) => boolean;
  /** Explicit JSON name from `@JsonProperty`. */
  name?: string;
  aliases?: string[];
  access?: PropertyAccess;
  serializer?: ClassConstructor<any>;
  deserializer?: ClassConstructor<any>;
  type?: () => ClassConstructor<any>;
  polymorphic?: PolymorphicInfo;
}

export type ClassModel = Record<string, PropertyModel>;

const MODEL = Symbol.for('cereale.model');

/**
 * Bumped whenever a model is written. Derived structures (the plans in engine.ts) record the
 * version they were built from and rebuild if it moves, so programmatic registration after a
 * class has already been used stays correct.
 */
let version = 0;

export function modelVersion(): number {
  return version;
}

/**
 * Returns the model owned by this class, creating it if necessary.
 *
 * `context.metadata` inherits from the base class's metadata through the prototype chain, so
 * a subclass starts out seeing everything its base declared. Writing requires an own copy —
 * otherwise a subclass would mutate its parent — and the inherited entries are deep-copied so
 * that a subclass re-decorating an inherited field *adds to* the base's rules instead of
 * replacing them. That inheritance-merging behaviour is structural here; the previous
 * WeakMap-based storage had to reconstruct it by walking prototypes on every read.
 */
function ownModel(metadata: DecoratorMetadata): ClassModel {
  if (!Object.hasOwn(metadata, MODEL)) {
    const inherited = (metadata as Record<symbol, ClassModel | undefined>)[MODEL];
    const own: ClassModel = {};
    for (const [key, property] of Object.entries(inherited ?? {})) {
      own[key] = { ...property, constraints: [...property.constraints] };
    }
    (metadata as Record<symbol, ClassModel>)[MODEL] = own;
  }
  return (metadata as Record<symbol, ClassModel>)[MODEL]!;
}

/** Returns (creating if needed) the model entry for one field. */
export function propertyModel(metadata: DecoratorMetadata, property: string): PropertyModel {
  version++;
  const model = ownModel(metadata);
  return (model[property] ??= { constraints: [] });
}

/** Appends a validation rule to a field, honouring `each` and a caller-supplied message. */
export function addConstraint(
  metadata: DecoratorMetadata,
  property: string,
  constraint: ValidationConstraint,
  options?: ValidationOptions
): void {
  if (options?.each) constraint.each = true;
  if (options?.message) {
    constraint.message = options.message;
    constraint.hasCustomMessage = true;
  }
  propertyModel(metadata, property).constraints.push(constraint);
}

/** Reads the model declared on a class. Returns an empty model for undecorated classes. */
export function modelOf(clazz: unknown): ClassModel {
  if (typeof clazz !== 'function') return {};
  const metadata = (clazz as unknown as Record<symbol, DecoratorMetadata | undefined>)[METADATA_KEY];
  return (metadata as Record<symbol, ClassModel> | undefined)?.[MODEL] ?? {};
}

/**
 * Reads the model that applies to an instance.
 *
 * Guarded rather than reading `obj.constructor` directly: null-prototype objects have no
 * constructor, and an instance whose `constructor` property has been overwritten would lie.
 */
export function modelOfInstance(obj: object): ClassModel {
  const prototype = Object.getPrototypeOf(obj);
  if (!prototype) return {};
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return modelOf(descriptor?.value);
}

/**
 * Registers a rule on a class from outside a decorator.
 *
 * The escape hatch for rules that cannot be expressed at the declaration site — built from
 * configuration, say. Prefer decorators, which are type-checked against the field.
 */
export function defineRule<T>(
  clazz: ClassConstructor<T>,
  property: keyof T & string,
  constraint: ValidationConstraint,
  options?: ValidationOptions
): void {
  const holder = clazz as unknown as Record<symbol, DecoratorMetadata | undefined>;
  holder[METADATA_KEY] ??= Object.create(null) as DecoratorMetadata;
  addConstraint(holder[METADATA_KEY]!, property, constraint, options);
}
