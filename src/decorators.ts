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
};

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
    }
  }
  
  const constraints: ValidationConstraint[] = metadataStorage.getOwnMetadata(METADATA_KEYS.VALIDATION, target, propertyKey) || [];
  constraints.push(constraint);
  metadataStorage.defineMetadata(METADATA_KEYS.VALIDATION, constraints, target, propertyKey);
}

// --- Mapping Decorators ---

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

/**
 * @JsonPolymorphic(discriminator: string, subTypes: { value: ClassConstructor<any>, name: string }[])
 * Defines polymorphic behavior for a property.
 */
export function JsonPolymorphic(discriminator: string, subTypes: { value: ClassConstructor<any>, name: string }[]) {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    metadataStorage.defineMetadata(METADATA_KEYS.POLYMORPHIC, { discriminator, subTypes }, target, propertyKey);
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
  return (target: any, propertyKey: string) => {
    addValidation(target, propertyKey, {
      name: 'matches',
      validate: (v) => typeof v === 'string' && pattern.test(v),
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

/**
 * @ValidateNested()
 */
export function ValidateNested() {
  return (target: any, propertyKey: string) => {
    registerProperty(target, propertyKey);
    // This is a marker for recursive validation
    metadataStorage.defineMetadata('cereale:nested', true, target, propertyKey);
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
