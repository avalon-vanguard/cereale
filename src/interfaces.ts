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
