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

// --- Internal Engine ---

async function serialize(obj: any): Promise<any> {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => serialize(item)));
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  const target = obj.constructor.prototype;
  
  const result: any = {};
  const allKeys = Object.keys(obj);
  
  for (const key of allKeys) {
    const value = obj[key];
    
    // Check for custom serializer
    const serializerCls = metadataStorage.getMetadata(METADATA_KEYS.SERIALIZER, target, key);
    if (serializerCls) {
      const serializer = new serializerCls();
      result[key] = await serializer.serialize(value);
    } else {
      result[key] = await serialize(value);
    }
  }

  return result;
}

async function deserialize<T>(clazz: ClassConstructor<T>, plain: any): Promise<T> {
  if (plain === null || plain === undefined) return plain;
  
  if (Array.isArray(plain)) {
    const results = await Promise.all(plain.map(item => deserialize(clazz, item)));
    return results as any;
  }

  const instance = new clazz();
  const target = clazz.prototype;

  // Copy all properties from plain to instance
  for (const key of Object.keys(plain)) {
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
      const { discriminator, subTypes } = poly;
      if (Array.isArray(value)) {
        instance[key as keyof T] = await Promise.all(value.map(async item => {
          const subTypeInfo = subTypes.find((s: any) => item[discriminator] === s.name);
          return subTypeInfo ? deserialize(subTypeInfo.value, item) : item;
        })) as any;
      } else {
        const subTypeInfo = subTypes.find((s: any) => value[discriminator] === s.name);
        if (subTypeInfo) {
          instance[key as keyof T] = await deserialize(subTypeInfo.value, value);
          continue;
        }
      }
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

// --- Public API Functions ---

/**
 * Validates a class instance or object against its decorators.
 * @param obj The object to validate
 * @returns Array of validation errors
 */
export async function validate(obj: any): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  if (obj === null || obj === undefined || typeof obj !== 'object') return errors;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childErrors = await validate(obj[i]);
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

  const target = Object.getPrototypeOf(obj);
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
    const constraints: ValidationConstraint[] = metadataStorage.getMetadata(METADATA_KEYS.VALIDATION, target, key) || [];
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
        
        if (constraint.each) {
          message = `each element in ${message}`;
        }
        
        propertyErrors.constraints[constraint.name] = message;
      }
    }

    // Recursive validation
    const isNested = metadataStorage.getMetadata('cereale:nested', target, key);
    if (isNested && value !== null && value !== undefined) {
      const nestedErrors = await validate(value);
      if (nestedErrors.length > 0) {
        propertyErrors.children = nestedErrors;
      }
    }

    if (Object.keys(propertyErrors.constraints).length > 0 || propertyErrors.children) {
      errors.push(propertyErrors);
    }
  }

  return errors;
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

  return serialize(obj);
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
 * Helper for Fetch-based frameworks (Next.js, Hono, etc.)
 * Extracts JSON from a Request and transforms it to a validated instance.
 * @param clazz The class constructor
 * @param request Web Request object
 * @returns Validated class instance
 */
export async function fromRequest<T>(clazz: ClassConstructor<T>, request: Request): Promise<T> {
  const plain = await request.json();
  return toInstance(clazz, plain);
}

/**
 * @deprecated Use standalone functions like toPlain, toInstance, etc.
 */
export class JsonMapper {
  static toPlain = toPlain;
  static toJson = toJson;
  static toInstance = toInstance;
  static fromJson = fromJson;
  static fromRequest = fromRequest;
  static validate = validate;
}
