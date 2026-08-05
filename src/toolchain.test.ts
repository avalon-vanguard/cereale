import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { transform } from 'esbuild';
import { transform as swcTransform } from '@swc/core';

import { IsString, modelOf } from './index.js';
import { standardDecorators } from './vite.js';

/**
 * The support matrix in the README, executed.
 *
 * cereale reads `context.metadata`, which only exists if the compiler emitted TC39 standard
 * decorators — so which compiler a consumer uses, and how it is configured, decides whether
 * the library works at all. Claiming that in prose is not worth much; each row below actually
 * compiles a decorated class with the tool in question and checks the metadata arrived.
 *
 * The one row that cannot run here is oxc, the transformer Vite 8 and Vitest 4 use, because it
 * ships inside a native binary with no standalone transform API. Its behaviour is why
 * `cereale/vite` exists, and the plugin is covered further down.
 */
const PROBE = `
const Rule = globalThis.__cerealeProbeRule;

export class Probe {
  @Rule() name;
}
`;

/** Compiler options a consumer needs for cereale to work. */
const STANDARD = { experimentalDecorators: false, useDefineForClassFields: true };
/** What most existing TypeScript projects still have, because class-validator required it. */
const LEGACY = { experimentalDecorators: true, useDefineForClassFields: false };

const emit = {
  tsc(source: string, options: typeof STANDARD): string {
    return ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        ...options,
      },
    }).outputText;
  },
  async esbuild(source: string, options: typeof STANDARD): Promise<string> {
    const result = await transform(source, {
      loader: 'ts',
      target: 'es2022',
      tsconfigRaw: { compilerOptions: options },
    });
    return result.code;
  },
  async swc(source: string, options: typeof STANDARD): Promise<string> {
    const result = await swcTransform(source, {
      filename: 'probe.ts',
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        target: 'es2022',
        // swc spells the choice as a proposal date rather than a boolean.
        transform: { decoratorVersion: options.experimentalDecorators ? '2021-12' : '2022-03' },
      },
      module: { type: 'es6' },
    });
    return result.code;
  },
};

let workspace: string;
let counter = 0;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'cereale-toolchain-'));
  // The emitted probe reaches the decorator through a global rather than an import, so that
  // it needs no module resolution back into a package that has not been built yet.
  (globalThis as Record<string, unknown>).__cerealeProbeRule = IsString;
});

afterAll(async () => {
  delete (globalThis as Record<string, unknown>).__cerealeProbeRule;
  await rm(workspace, { recursive: true, force: true });
});

/** Writes emitted JavaScript to disk and imports it, the way a consumer's runtime would. */
async function load(code: string): Promise<{ Probe: unknown }> {
  const file = path.join(workspace, `probe-${counter++}.mjs`);
  await writeFile(file, code);
  return import(pathToFileURL(file).href) as Promise<{ Probe: unknown }>;
}

describe('compilers that emit standard decorators', () => {
  it('tsc records the rule', async () => {
    const { Probe } = await load(emit.tsc(PROBE, STANDARD));
    expect(Object.keys(modelOf(Probe))).toEqual(['name']);
  });

  it('esbuild records the rule', async () => {
    const { Probe } = await load(await emit.esbuild(PROBE, STANDARD));
    expect(Object.keys(modelOf(Probe))).toEqual(['name']);
  });

  it('swc records the rule', async () => {
    const { Probe } = await load(await emit.swc(PROBE, STANDARD));
    expect(Object.keys(modelOf(Probe))).toEqual(['name']);
  });
});

describe('compilers configured for legacy decorators', () => {
  // Left unguarded, both of these die inside cereale with `TypeError: Cannot convert undefined
  // or null to object`, which names neither the cause nor the setting that fixes it.
  it('tsc emit is refused by name', async () => {
    await expect(load(emit.tsc(PROBE, LEGACY))).rejects.toThrow(/experimentalDecorators/);
  });

  it('esbuild emit is refused by name', async () => {
    await expect(load(await emit.esbuild(PROBE, LEGACY))).rejects.toThrow(/experimentalDecorators/);
  });

  it('swc emit is refused by name', async () => {
    await expect(load(await emit.swc(PROBE, LEGACY))).rejects.toThrow(/experimentalDecorators/);
  });
});

describe('cereale/vite', () => {
  const plugin = (options?: Parameters<typeof standardDecorators>[0]) => standardDecorators(options);

  it('lowers decorator syntax that oxc would pass through untouched', async () => {
    const result = await plugin().transform(PROBE, '/app/src/model.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toMatch(/@Rule\(\)/);

    const { Probe } = await load(result!.code);
    expect(Object.keys(modelOf(Probe))).toEqual(['name']);
  });

  it('produces working output through the TypeScript compiler too', async () => {
    const result = await plugin({ transformer: 'typescript' }).transform(PROBE, '/app/src/model.ts');
    const { Probe } = await load(result!.code);
    expect(Object.keys(modelOf(Probe))).toEqual(['name']);
  });

  it('emits a source map', async () => {
    const result = await plugin().transform(PROBE, '/app/src/model.ts');
    expect(result!.map).toBeTruthy();
  });

  // tsc appends one pointing at a file that was never written; Vite follows it and logs a
  // failure to read the map for every transformed module.
  it('does not leave a sourceMappingURL comment behind', async () => {
    for (const transformer of ['esbuild', 'typescript'] as const) {
      const result = await plugin({ transformer }).transform(PROBE, '/app/src/model.ts');
      expect(result!.code, transformer).not.toMatch(/sourceMappingURL/);
    }
  });

  for (const id of ['/app/src/model.ts', '/app/src/model.mts', '/app/src/model.cts', '/app/src/model.ts?v=123']) {
    it(`transforms ${id}`, async () => {
      expect(await plugin().transform(PROBE, id)).not.toBeNull();
    });
  }

  for (const id of ['/app/node_modules/dep/model.ts', '/app/src/model.js', '/app/src/model.tsx', '/app/src/style.css']) {
    it(`leaves ${id} alone`, async () => {
      expect(await plugin().transform(PROBE, id)).toBeNull();
    });
  }

  it('honours a caller-supplied include', async () => {
    const onlyModels = plugin({ include: id => id.includes('/models/') });
    expect(await onlyModels.transform(PROBE, '/app/src/models/user.ts')).not.toBeNull();
    expect(await onlyModels.transform(PROBE, '/app/src/routes/user.ts')).toBeNull();
  });

  it('runs before Vite’s own transform', () => {
    expect(plugin().enforce).toBe('pre');
  });

  it('rejects a target the compiler does not know', async () => {
    const bad = plugin({ transformer: 'typescript', target: 'es1999' });
    await expect(bad.transform(PROBE, '/app/src/model.ts')).rejects.toThrow(/es1999/);
  });
});
