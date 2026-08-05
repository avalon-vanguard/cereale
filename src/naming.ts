/**
 * Translates a class property name into the name used in JSON.
 *
 * Applied only to properties that do not carry an explicit `@JsonProperty`, which always wins.
 */
export type NamingStrategyFn = (propertyKey: string) => string;

/**
 * A built-in strategy name, or your own function.
 *
 * The built-ins assume property names are written in the TypeScript convention (camelCase)
 * and convert away from it.
 */
export type NamingStrategy =
  | 'identity'
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'SCREAMING_SNAKE_CASE'
  | 'kebab-case'
  | NamingStrategyFn;

/**
 * Splits an identifier into lowercase words.
 *
 * Handles the two boundaries that matter in practice: a lowercase-or-digit followed by an
 * uppercase (`firstName`), and an acronym running into a new word (`parseHTTPResponse`,
 * where the split belongs before `Response`, not inside `HTTP`). Existing separators are
 * treated as boundaries too, so an already-converted name survives a second pass unchanged.
 */
function words(propertyKey: string): string[] {
  return propertyKey
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(word => word.toLowerCase());
}

const capitalize = (word: string): string => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word);

const BUILT_INS: Record<Exclude<NamingStrategy, NamingStrategyFn>, NamingStrategyFn> = {
  identity: (key) => key,
  camelCase: (key) => {
    const parts = words(key);
    if (parts.length === 0) return key;
    return parts[0] + parts.slice(1).map(capitalize).join('');
  },
  PascalCase: (key) => words(key).map(capitalize).join('') || key,
  snake_case: (key) => words(key).join('_') || key,
  SCREAMING_SNAKE_CASE: (key) => words(key).join('_').toUpperCase() || key,
  'kebab-case': (key) => words(key).join('-') || key,
};

/**
 * Resolves a {@link NamingStrategy} to the function that implements it.
 *
 * @throws Error when given a name that is not one of the built-in strategies.
 */
export function resolveNamingStrategy(strategy: NamingStrategy | undefined): NamingStrategyFn {
  if (!strategy) return BUILT_INS.identity;
  if (typeof strategy === 'function') return strategy;

  const builtIn = BUILT_INS[strategy];
  if (!builtIn) {
    throw new Error(
      `Unknown naming strategy ${JSON.stringify(strategy)}. ` +
      `Use one of: ${Object.keys(BUILT_INS).join(', ')}, or pass your own function.`
    );
  }
  return builtIn;
}
