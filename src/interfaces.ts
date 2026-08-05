/**
 * Interface for custom JSON serializers.
 *
 * @template T - The type of the value to serialize (usually a class instance or a specific field).
 * @template R - The type of the serialized value (usually a string, number, or plain object).
 */
export interface JsonSerializer<T = any, R = any> {
  /**
   * Serializes the value into a representation suitable for JSON output.
   *
   * @param value - The value to be serialized.
   * @returns The serialized value or a promise resolving to it.
   */
  serialize(value: T): R | Promise<R>;
}

/**
 * Interface for custom JSON deserializers.
 *
 * @template T - The type of the value to deserialize (usually a string or plain object from JSON).
 * @template R - The type of the deserialized value (usually a class instance or a specific field).
 */
export interface JsonDeserializer<T = any, R = any> {
  /**
   * Deserializes the value from a JSON-like representation back to its original type.
   *
   * @param value - The value to be deserialized.
   * @returns The deserialized value or a promise resolving to it.
   */
  deserialize(value: T): R | Promise<R>;
}

/**
 * Represents a class constructor function.
 *
 * @template T - The type of the instance created by this constructor.
 */
export type ClassConstructor<T> = {
  new (...args: any[]): T;
};

/**
 * A decorator that may only be applied to a field whose type is assignable to `Allowed`.
 *
 * This is what makes cereale's rules type-checked rather than merely declared. Standard
 * decorators receive a `ClassFieldDecoratorContext<This, Value>` that carries the field's
 * declared type, so applying `@IsString()` to a `number` field is a compile error rather
 * than a runtime surprise:
 *
 * ```ts
 * class User {
 *   @IsString() name!: string;   // fine
 *   @IsString() age!: number;    // Type 'number' is not assignable to type 'string'
 * }
 * ```
 *
 * `null` and `undefined` are included in the `Allowed` union of every built-in rule so
 * optional fields (`nickname?: string`) still accept the rule that describes them.
 */
export type FieldDecorator<Allowed> = <This, Value extends Allowed>(
  target: undefined,
  context: ClassFieldDecoratorContext<This, Value>
) => void;

/** A field holding a string, or nothing. */
export type StringField = string | null | undefined;
/** A field holding a number, or nothing. */
export type NumberField = number | null | undefined;
/** A field holding a boolean, or nothing. */
export type BooleanField = boolean | null | undefined;
/** A field holding a bigint, or nothing. */
export type BigIntField = bigint | null | undefined;
/** A field holding a Date, or nothing. */
export type DateField = Date | null | undefined;
/** A field holding an array, or nothing. */
export type ArrayField = readonly unknown[] | null | undefined;

/** The element type of an array field, used by rules that run per element. */
export type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
