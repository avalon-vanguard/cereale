import { NamingStrategy } from './naming.js';

/**
 * How an incoming key that maps to no known property should be treated.
 *
 * - `allow` (default): copy it onto the instance untouched, preserving the previous behaviour.
 * - `strip`: drop it, so instances only ever carry declared properties.
 * - `error`: reject the payload with a {@link JsonMappingError}.
 */
export type UnknownKeyPolicy = 'allow' | 'strip' | 'error';

export interface TransformOptions {
  /**
   * Validate the result and throw {@link JsonValidationError} on failure.
   *
   * Defaults to `true`, matching the behaviour of every previous release. Set it to `false`
   * to map without validating — useful when you want to inspect a partially-valid payload,
   * or when validation happens elsewhere in your stack.
   */
  validate?: boolean;

  /**
   * Naming convention used on the JSON side for properties without an explicit
   * `@JsonProperty`. Defaults to `identity` (property names are used as-is).
   */
  namingStrategy?: NamingStrategy;

  /** What to do with incoming keys that match no declared property. Deserialization only. */
  unknownKeys?: UnknownKeyPolicy;

  /**
   * Maximum nesting depth before a {@link JsonMappingError} is raised. Defaults to 64.
   *
   * All three engines recurse, so a hostile payload nested thousands of levels deep would
   * otherwise exhaust the call stack. Raise it if you legitimately model deep trees.
   */
  maxDepth?: number;
}

/** Options that can be set once for the whole application via {@link configure}. */
export type GlobalOptions = Pick<TransformOptions, 'namingStrategy' | 'unknownKeys' | 'validate' | 'maxDepth'>;

const DEFAULTS: Required<GlobalOptions> = {
  namingStrategy: 'identity',
  unknownKeys: 'allow',
  validate: true,
  maxDepth: 64,
};

let globalOptions: Required<GlobalOptions> = { ...DEFAULTS };

/**
 * Sets library-wide defaults, so an application that consistently speaks `snake_case` does
 * not have to repeat itself at every call site.
 *
 * ```ts
 * configure({ namingStrategy: 'snake_case', unknownKeys: 'strip' });
 * ```
 *
 * Per-call options always take precedence over these.
 */
export function configure(options: GlobalOptions): void {
  globalOptions = { ...globalOptions, ...options };
}

/** Returns the current library-wide defaults. */
export function getConfig(): Required<GlobalOptions> {
  return { ...globalOptions };
}

/** Restores the library-wide defaults to their original values. */
export function resetConfig(): void {
  globalOptions = { ...DEFAULTS };
}

/** Merges per-call options over the library-wide defaults. */
export function resolveOptions(options?: TransformOptions): Required<GlobalOptions> {
  if (!options) return globalOptions;
  return {
    namingStrategy: options.namingStrategy ?? globalOptions.namingStrategy,
    unknownKeys: options.unknownKeys ?? globalOptions.unknownKeys,
    validate: options.validate ?? globalOptions.validate,
    maxDepth: options.maxDepth ?? globalOptions.maxDepth,
  };
}
