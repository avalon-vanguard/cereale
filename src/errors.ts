import type { ValidationError } from './utils.js';

/**
 * Flattens the nested {@link ValidationError} tree into a flat map of dotted paths to
 * messages — the shape you actually want when turning a failure into an HTTP 400 body.
 *
 * ```ts
 * flattenErrors(errors);
 * // {
 * //   "name":            ["name must be a string"],
 * //   "items[0].qty":    ["qty must be at least 1"]
 * // }
 * ```
 */
export function flattenErrors(errors: ValidationError[]): Record<string, string[]> {
  const flat: Record<string, string[]> = {};

  const walk = (nodes: ValidationError[], prefix: string) => {
    for (const node of nodes) {
      // Array indices read as `items[0]`, named properties as `order.total`.
      const path = node.property.startsWith('[')
        ? `${prefix}${node.property}`
        : prefix ? `${prefix}.${node.property}` : node.property;

      const messages = Object.values(node.constraints);
      if (messages.length > 0) {
        (flat[path] ??= []).push(...messages);
      }

      if (node.children?.length) {
        walk(node.children, path);
      }
    }
  };

  walk(errors, '');
  return flat;
}

/**
 * Renders the error tree as human-readable lines, one per failed rule.
 *
 * Intended for logs and CLI output; use {@link flattenErrors} when the destination is JSON.
 */
export function formatErrors(errors: ValidationError[]): string {
  const flat = flattenErrors(errors);
  return Object.entries(flat)
    .flatMap(([path, messages]) => messages.map(message => `${path}: ${message}`))
    .join('\n');
}

/**
 * Collects every message in the tree, discarding paths.
 */
export function collectErrorMessages(errors: ValidationError[]): string[] {
  return Object.values(flattenErrors(errors)).flat();
}
