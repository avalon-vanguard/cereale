export class MetadataStorage {
  private static instance: MetadataStorage;

  /**
   * Bumped whenever any metadata is written.
   *
   * Decorators run at class-definition time, so in practice this stops changing once the
   * application has loaded. Derived structures (see the validation plan cache in utils.ts)
   * record the version they were built from and rebuild if it moves, which keeps caching
   * safe even for metadata registered late through `registerDecorator`.
   */
  private _version = 0;

  get version(): number {
    return this._version;
  }

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
    this._version++;
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
   * Collects a metadata value from every level of the prototype chain that defines one.
   *
   * Unlike {@link getMetadata}, which stops at the first (most derived) match, this returns
   * every value found, ordered from the BASE class down to the most derived one. It exists
   * for metadata that must accumulate across an inheritance chain rather than be overridden —
   * validation constraints in particular, where a subclass re-decorating an inherited property
   * must add to the base class's rules instead of silently replacing them.
   */
  getMetadataChain(key: string, target: any, propertyKey?: string): any[] {
    const chain: any[] = [];
    let current = target;
    while (current) {
      const value = this.getOwnMetadata(key, current, propertyKey);
      if (value !== undefined) {
        // Walking derived -> base, so prepend to end up base-first.
        chain.unshift(value);
      }
      current = Object.getPrototypeOf(current);
    }
    return chain;
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
    this._version++;
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
