export class MetadataStorage {
  private static instance: MetadataStorage;
  
  // Maps a prototype to its property names
  private properties = new WeakMap<any, string[]>();
  
  // Maps a prototype and property name to its metadata
  // Map<Prototype, Map<PropertyKey, Map<MetadataKey, Value>>>
  private propertyMetadata = new WeakMap<any, Map<string, Map<string, any>>>();
  
  // Maps a prototype to its class-level metadata
  private classMetadata = new WeakMap<any, Map<string, any>>();

  private constructor() {}

  static getInstance(): MetadataStorage {
    if (!MetadataStorage.instance) {
      MetadataStorage.instance = new MetadataStorage();
    }
    return MetadataStorage.instance;
  }

  /**
   * Defines metadata for a specific property on a target.
   */
  defineMetadata(key: string, value: any, target: any, propertyKey?: string) {
    if (propertyKey) {
      let targetMap = this.propertyMetadata.get(target);
      if (!targetMap) {
        targetMap = new Map();
        this.propertyMetadata.set(target, targetMap);
      }
      
      let propertyMap = targetMap.get(propertyKey);
      if (!propertyMap) {
        propertyMap = new Map();
        targetMap.set(propertyKey, propertyMap);
      }
      
      propertyMap.set(key, value);
    } else {
      let targetMap = this.classMetadata.get(target);
      if (!targetMap) {
        targetMap = new Map();
        this.classMetadata.set(target, targetMap);
      }
      targetMap.set(key, value);
    }
  }

  /**
   * Gets metadata for a specific property on a target, including from the prototype chain.
   */
  getMetadata(key: string, target: any, propertyKey?: string): any {
    let current = target;
    while (current) {
      const value = this.getOwnMetadata(key, current, propertyKey);
      if (value !== undefined) {
        return value;
      }
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  }

  /**
   * Gets metadata defined directly on the target.
   */
  getOwnMetadata(key: string, target: any, propertyKey?: string): any {
    if (propertyKey) {
      return this.propertyMetadata.get(target)?.get(propertyKey)?.get(key);
    } else {
      return this.classMetadata.get(target)?.get(key);
    }
  }

  /**
   * Registers a property for a target.
   */
  registerProperty(target: any, propertyKey: string) {
    let props = this.properties.get(target);
    if (!props) {
      props = [];
      this.properties.set(target, props);
    }
    if (!props.includes(propertyKey)) {
      props.push(propertyKey);
    }
  }

  /**
   * Gets all registered properties for a target, including from the prototype chain.
   */
  getProperties(target: any): string[] {
    const allProps = new Set<string>();
    let current = target;
    while (current) {
      const props = this.properties.get(current);
      if (props) {
        props.forEach(p => allProps.add(p));
      }
      current = Object.getPrototypeOf(current);
    }
    return Array.from(allProps);
  }
}

export const metadataStorage = MetadataStorage.getInstance();
