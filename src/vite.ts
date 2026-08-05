/**
 * A Vite plugin that lowers TC39 standard decorators, for projects on Vite 8 or Vitest 4.
 *
 * Those versions transform TypeScript with oxc, which does not implement the standard
 * decorator transform yet. It does not report that: it leaves the decorator syntax in the
 * output, so `vitest` prints "0 test" next to a bare `SyntaxError`, and `vite build` reports
 * success while emitting a bundle that throws `SyntaxError` the moment anything imports it.
 *
 * Nothing here is specific to cereale — any library built on standard decorators needs it —
 * but cereale ships it because a consumer's first experience of the library should not be a
 * syntax error with no obvious cause. Delete it once oxc supports the transform.
 *
 * ```ts
 * // vite.config.ts / vitest.config.ts
 * import { standardDecorators } from 'cereale/vite';
 *
 * export default defineConfig({ plugins: [standardDecorators()] });
 * ```
 *
 * The transform is done by esbuild if it is installed, otherwise by the TypeScript compiler.
 * cereale depends on neither; one of the two is present in essentially every TypeScript
 * project, and the plugin says which to install if somehow neither is.
 */

/**
 * The shape Vite expects of a plugin, declared here rather than imported.
 *
 * `cereale/vite` must not drag `vite` into a consumer's type-checking just to describe its own
 * return value — this object is structurally assignable to Vite's `Plugin`.
 */
export interface StandardDecoratorsPlugin {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): Promise<{ code: string; map: string } | null>;
}

export interface StandardDecoratorsOptions {
  /**
   * Decides which modules to transform. Receives the resolved module id.
   *
   * The default takes `.ts`, `.mts` and `.cts` outside `node_modules`. `.tsx` is excluded
   * because lowering decorators there means also deciding what happens to the JSX, and
   * getting that wrong is worse than not handling it; pass an `include` of your own if you
   * declare decorated classes in `.tsx` files.
   */
  include?: (id: string) => boolean;
  /** ECMAScript target for the emitted code. Defaults to `es2022`, the first with class fields. */
  target?: string;
  /**
   * Which tool does the transform. `'auto'` (the default) prefers esbuild for speed and falls
   * back to the TypeScript compiler; name one explicitly to keep a build reproducible, or to
   * fail loudly rather than silently switch if the preferred one is not installed.
   */
  transformer?: 'auto' | 'esbuild' | 'typescript';
}

const DEFAULT_INCLUDE = (id: string): boolean =>
  /\.[cm]?ts(\?.*)?$/.test(id) && !id.includes('/node_modules/');

type Transformer = (code: string, id: string, target: string) => Promise<{ code: string; map: string }>;

function isMissingModule(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

async function esbuildTransformer(): Promise<Transformer | null> {
  let esbuild: typeof import('esbuild');
  try {
    esbuild = await import('esbuild');
  } catch (error) {
    if (isMissingModule(error)) return null;
    throw error;
  }
  return async (code, id, target) => {
    const result = await esbuild.transform(code, {
      loader: 'ts',
      target,
      sourcefile: id,
      sourcemap: true,
      // Standard semantics, not the legacy ones: cereale records into `context.metadata`.
      tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
    });
    return { code: result.code, map: result.map };
  };
}

async function typescriptTransformer(): Promise<Transformer | null> {
  let ts: typeof import('typescript');
  try {
    ts = await import('typescript');
  } catch (error) {
    if (isMissingModule(error)) return null;
    throw error;
  }
  // `ScriptTarget` members are spelled `ES2022`, `ESNext`; esbuild-style targets are lower
  // case. Matched case-insensitively rather than upper-casing, which would miss `ESNext`.
  const targetKey = (target: string) =>
    Object.keys(ts.ScriptTarget).find(key => key.toLowerCase() === target.toLowerCase());

  return async (code, id, target) => {
    const key = targetKey(target);
    if (key === undefined) {
      throw new Error(`cereale/vite: ${JSON.stringify(target)} is not a target the TypeScript compiler knows.`);
    }
    const result = ts.transpileModule(code, {
      fileName: id.replace(/\?.*$/, ''),
      compilerOptions: {
        target: ts.ScriptTarget[key as keyof typeof ts.ScriptTarget],
        module: ts.ModuleKind.ESNext,
        experimentalDecorators: false,
        useDefineForClassFields: true,
        sourceMap: true,
        isolatedModules: true,
      },
    });
    // tsc appends `//# sourceMappingURL=<file>.map` even though the map is handed back
    // separately. Vite would follow that comment and fail to read a file nobody wrote.
    const output = result.outputText.replace(/\r?\n?\/\/# sourceMappingURL=\S*[ \t]*$/, '');
    return { code: output, map: result.sourceMapText ?? '' };
  };
}

const FACTORIES = { esbuild: esbuildTransformer, typescript: typescriptTransformer };

// Resolution is memoized per choice: the transform hook runs once per module, and neither
// `import('esbuild')` nor `import('typescript')` is cheap enough to repeat.
const resolved = new Map<string, Promise<Transformer>>();

function resolveTransformer(choice: 'auto' | 'esbuild' | 'typescript'): Promise<Transformer> {
  let pending = resolved.get(choice);
  if (!pending) {
    pending = (async () => {
      if (choice !== 'auto') {
        const only = await FACTORIES[choice]();
        if (only) return only;
        throw new Error(
          `cereale/vite was asked to transform with ${choice}, which is not installed. ` +
          `Install it (\`npm i -D ${choice}\`) or drop the \`transformer\` option to let the ` +
          'plugin pick whichever is available.'
        );
      }
      const best = (await esbuildTransformer()) ?? (await typescriptTransformer());
      if (best) return best;
      throw new Error(
        'cereale/vite needs a transformer that understands TC39 standard decorators, and found ' +
        'neither esbuild nor typescript. Install one of them as a dev dependency: ' +
        '`npm i -D esbuild`.'
      );
    })();
    resolved.set(choice, pending);
  }
  return pending;
}

/**
 * Transforms TypeScript sources with esbuild (or tsc) before Vite's own oxc pass sees them.
 *
 * `enforce: 'pre'` is what makes this work: the hook runs ahead of Vite's transform, hands
 * back plain JavaScript, and oxc is then left with nothing it cannot parse.
 */
export function standardDecorators(options: StandardDecoratorsOptions = {}): StandardDecoratorsPlugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const target = options.target ?? 'es2022';
  const choice = options.transformer ?? 'auto';

  return {
    name: 'cereale:standard-decorators',
    enforce: 'pre',
    async transform(code: string, id: string) {
      if (!include(id)) return null;
      return (await resolveTransformer(choice))(code, id, target);
    },
  };
}
