import { ClassConstructor } from './interfaces';
import { METADATA_KEYS, ValidationConstraint, ValidationArguments } from './decorators';
import { metadataStorage } from './metadata-storage';

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

export class JsonMapper {
  /**
   * Converts a class instance to a plain object with validation.
   */
  static async toPlain<T>(obj: T): Promise<any> {
    if (obj === null || obj === undefined) return obj;
    
    // Validate first
    const errors = await this.validate(obj);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during serialization', errors);
    }

    return this.serialize(obj);
  }

  /**
   * Converts a class instance to a JSON string with validation.
   */
  static async toJson<T>(obj: T): Promise<string> {
    const plain = await this.toPlain(obj);
    return JSON.stringify(plain);
  }

  /**
   * Converts a plain object to a class instance with validation.
   */
  static async toInstance<T>(clazz: ClassConstructor<T>, plain: any): Promise<T> {
    const instance = this.deserialize(clazz, plain);
    
    const errors = await this.validate(instance);
    if (errors.length > 0) {
      throw new JsonValidationError('Validation failed during deserialization', errors);
    }
    
    return instance;
  }

  /**
   * Parses a JSON string to a class instance with validation.
   */
  static async fromJson<T>(clazz: ClassConstructor<T>, json: string): Promise<T> {
    const plain = JSON.parse(json);
    return this.toInstance(clazz, plain);
  }

  // --- Internal Engine ---

  private static serialize(obj: any): any {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.serialize(item));
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    const target = obj.constructor.prototype;
    
    // If no properties are registered with decorators, we might want to serialize everything
    // But for a "lightweight lib" based on decorators, we only serialize registered properties?
    // Actually, usually we serialize everything and only apply special logic to registered ones.
    // Let's take all keys of the object.
    const result: any = {};
    const allKeys = Object.keys(obj);
    
    for (const key of allKeys) {
      const value = obj[key];
      
      // Check for custom serializer
      const serializerCls = metadataStorage.getMetadata(METADATA_KEYS.SERIALIZER, target, key);
      if (serializerCls) {
        const serializer = new serializerCls();
        result[key] = serializer.serialize(value);
      } else {
        result[key] = this.serialize(value);
      }
    }

    return result;
  }

  private static deserialize<T>(clazz: ClassConstructor<T>, plain: any): T {
    if (plain === null || plain === undefined) return plain;
    
    if (Array.isArray(plain)) {
      return plain.map(item => this.deserialize(clazz, item)) as any;
    }

    const instance = new clazz();
    const target = clazz.prototype;

    // Copy all properties from plain to instance
    for (const key of Object.keys(plain)) {
      let value = plain[key];

      // Custom Deserializer
      const deserializerCls = metadataStorage.getMetadata(METADATA_KEYS.DESERIALIZER, target, key);
      if (deserializerCls) {
        const deserializer = new deserializerCls();
        instance[key as keyof T] = deserializer.deserialize(value);
        continue;
      }

      // Polymorphic
      const poly = metadataStorage.getMetadata(METADATA_KEYS.POLYMORPHIC, target, key);
      if (poly && value !== null && value !== undefined) {
        const { discriminator, subTypes } = poly;
        if (Array.isArray(value)) {
          instance[key as keyof T] = value.map(item => {
            const subTypeInfo = subTypes.find((s: any) => item[discriminator] === s.name);
            return subTypeInfo ? this.deserialize(subTypeInfo.value, item) : item;
          }) as any;
        } else {
          const subTypeInfo = subTypes.find((s: any) => value[discriminator] === s.name);
          if (subTypeInfo) {
            instance[key as keyof T] = this.deserialize(subTypeInfo.value, value);
            continue;
          }
        }
        continue;
      }

      // Nested Type
      const typeFn = metadataStorage.getMetadata(METADATA_KEYS.TYPE, target, key);
      if (typeFn && value !== null && value !== undefined) {
        const type = typeFn();
        instance[key as keyof T] = this.deserialize(type, value);
        continue;
      }

      instance[key as keyof T] = value;
    }

    return instance;
  }

  static async validate(obj: any): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    if (obj === null || obj === undefined || typeof obj !== 'object') return errors;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const childErrors = await this.validate(obj[i]);
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
      const isNested = metadataStorage.getMetadata('optimus:nested', target, key);
      if (isNested && value !== null && value !== undefined) {
        const nestedErrors = await this.validate(value);
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
}
