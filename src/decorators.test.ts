import { describe, it, expect } from 'vitest';
import { 
  IsNumber, 
  IsObject, 
  IsDefined, 
  IsNotEmpty, 
  Positive, 
  Negative, 
  IsUrl,
  Max,
  Matches, 
  ArrayMinSize, 
  ArrayMaxSize, 
  IsNotIn, 
  Validate, 
  registerDecorator,
  JsonType,
  JsonPolymorphic,
  JsonMapper,
  JsonValidationError,
  ValidationArguments,
  ValidatorConstraintInterface,
  IsString
} from './index.js';

describe('Additional Decorators', () => {
  describe('IsNumber', () => {
    class Test {
      @IsNumber()
      val: any;
    }
    it('should validate numbers', async () => {
      const t = new Test();
      t.val = 123;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = '123';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.val = NaN;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('IsObject', () => {
    class Test {
      @IsObject()
      val: any;
    }
    it('should validate objects', async () => {
      const t = new Test();
      t.val = { a: 1 };
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 123;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.val = null;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.val = [];
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('IsDefined', () => {
    class Test {
      @IsDefined()
      val: any;
    }
    it('should validate defined values', async () => {
      const t = new Test();
      t.val = 0;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = null;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.val = undefined;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('IsNotEmpty', () => {
    class Test {
      @IsNotEmpty()
      val: any;
    }
    it('should validate non-empty values', async () => {
      const t = new Test();
      t.val = 'abc';
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = '';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.val = null;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('Positive and Negative', () => {
    class Test {
      @Positive()
      pos: number;
      @Negative()
      neg: number;
    }
    it('should validate positive and negative numbers', async () => {
      const t = new Test();
      t.pos = 5;
      t.neg = -5;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.pos = -1;
      t.neg = 1;
      expect(await JsonMapper.validate(t)).toHaveLength(2);
      const errors = await JsonMapper.validate(t);
      expect(errors.find(e => e.property === 'pos')).toBeDefined();
    });
  });

  describe('Matches', () => {
    class Test {
      @Matches(/^[a-z]+$/)
      val: string;
      @Max(10)
      num: number;
    }
    it('should validate regex matches and Max', async () => {
      const t = new Test();
      t.val = 'abc';
      t.num = 5;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = '123';
      t.num = 15;
      expect(await JsonMapper.validate(t)).toHaveLength(2);
    });
  });

  describe('IsUrl invalid', () => {
    class Test {
      @IsUrl()
      url: string;
    }
    it('should fail on invalid URL', async () => {
      const t = new Test();
      t.url = 'not-a-url';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('JsonValidationError and toPlain error', () => {
    it('should have a working toString on JsonValidationError', () => {
      const err = new JsonValidationError('fail', [{ property: 'x', value: 1, constraints: { c: 'm' } }]);
      expect(err.toString()).toContain('fail');
      expect(err.toString()).toContain('x');
    });

    it('should throw during serialization if invalid', async () => {
      class Test {
        @IsString()
        val: any;
      }
      const t = new Test();
      t.val = 123;
      await expect(JsonMapper.toPlain(t)).rejects.toThrow(JsonValidationError);
    });
  });

  describe('Array Size', () => {
    class Test {
      @ArrayMinSize(2)
      @ArrayMaxSize(4)
      vals: any[];
    }
    it('should validate array size', async () => {
      const t = new Test();
      t.vals = [1, 2];
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.vals = [1];
      expect(await JsonMapper.validate(t)).toHaveLength(1);
      t.vals = [1, 2, 3, 4, 5];
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('IsNotIn', () => {
    class Test {
      @IsNotIn(['black', 'white'])
      color: string;
    }
    it('should validate value is NOT in list', async () => {
      const t = new Test();
      t.color = 'red';
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.color = 'black';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('JsonType', () => {
    class Child {
      @IsString()
      name: string;
    }
    class Parent {
      @JsonType(() => Child)
      child: Child;
    }
    it('should deserialize nested type using JsonType', async () => {
      const plain = { child: { name: 'Junior' } };
      const parent = await JsonMapper.toInstance(Parent, plain);
      expect(parent.child).toBeInstanceOf(Child);
      expect(parent.child.name).toBe('Junior');
    });
  });

  describe('Custom Validate', () => {
    it('should use functional validator', async () => {
      class Test {
        @Validate((v) => v === 'secret')
        val: string;
      }
      const t = new Test();
      t.val = 'secret';
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 'wrong';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });

    it('should use class-based validator', async () => {
      class CustomValidator implements ValidatorConstraintInterface {
        validate(value: any) {
          return value === 'correct';
        }
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be correct`;
        }
      }
      class Test {
        @Validate(CustomValidator)
        val: string;
      }
      const t = new Test();
      t.val = 'correct';
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 'wrong';
      const errors = await JsonMapper.validate(t);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints['CustomValidator']).toBe('val must be correct');
    });
  });

  describe('registerDecorator', () => {
    it('should register a custom decorator with functional validator', async () => {
      function IsEven() {
        return function (object: any, propertyName: string) {
          registerDecorator({
            name: 'isEven',
            target: object.constructor,
            propertyName: propertyName,
            validator: (value: any) => typeof value === 'number' && value % 2 === 0,
          });
        };
      }

      class Test {
        @IsEven()
        val: number;
      }

      const t = new Test();
      t.val = 2;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 3;
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });

    it('should register a custom decorator with class validator', async () => {
      class MyValidator implements ValidatorConstraintInterface {
        validate(v: any) { return v === 'ok'; }
      }
      function IsOk() {
        return function (object: any, propertyName: string) {
          registerDecorator({
            name: 'isOk',
            target: object.constructor,
            propertyName: propertyName,
            validator: MyValidator,
          });
        };
      }
      class Test {
        @IsOk() val: string;
      }
      const t = new Test();
      t.val = 'ok';
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 'not ok';
      expect(await JsonMapper.validate(t)).toHaveLength(1);
    });
  });

  describe('Validate with constraints and options', () => {
    it('should handle constraints and options', async () => {
      class Test {
        @Validate((v, a) => v === a.constraints[0], [10], { message: 'must be ten' })
        val: number;
      }
      const t = new Test();
      t.val = 10;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 5;
      const errors = await JsonMapper.validate(t);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints['custom']).toBe('must be ten');
    });

    it('should handle options as second argument', async () => {
      class Test {
        @Validate((v) => v === 1, { message: 'must be one' })
        val: number;
      }
      const t = new Test();
      t.val = 1;
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.val = 2;
      const errors = await JsonMapper.validate(t);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints['custom']).toBe('must be one');
    });
  });

  describe('JsonMapper extra cases', () => {
    it('should serialize Date with default toISOString', async () => {
      class Test {
        date: Date;
      }
      const t = new Test();
      t.date = new Date("2026-01-01T00:00:00Z");
      const plain = await JsonMapper.toPlain(t);
      expect(plain.date).toBe(t.date.toISOString());
    });

    it('should deserialize top-level array', async () => {
      class Item {
        @IsString()
        name: string;
      }
      const json = '[{"name": "a"}, {"name": "b"}]';
      const items = await JsonMapper.fromJson(Item, json);
      expect(Array.isArray(items)).toBe(true);
      expect(items[0]).toBeInstanceOf(Item);
      expect(items[0].name).toBe('a');
    });

    it('should handle single polymorphic object', async () => {
      abstract class Animal {
        @IsString() type: string;
      }
      class Dog extends Animal {
        type = 'dog';
        @IsString() breed: string;
      }
      class Test {
        @JsonPolymorphic('type', [{ value: Dog, name: 'dog' }])
        pet: Animal;
      }
      const plain = { pet: { type: 'dog', breed: 'Labrador' } };
      const t = await JsonMapper.toInstance(Test, plain);
      expect(t.pet).toBeInstanceOf(Dog);
      expect((t.pet as Dog).breed).toBe('Labrador');
    });
  });

  describe('ValidationOptions each', () => {
    class Test {
      @IsString({ each: true })
      tags: string[];
    }
    it('should validate each element in array', async () => {
      const t = new Test();
      t.tags = ['a', 'b'];
      expect(await JsonMapper.validate(t)).toHaveLength(0);
      t.tags = ['a', 1 as any];
      const errors = await JsonMapper.validate(t);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints['isString']).toContain('each element');
    });
  });
});
