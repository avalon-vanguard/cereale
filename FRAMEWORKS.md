# Using cereale with your framework

Every recipe here was run before it was written. Where something does not work, this says so
rather than offering a workaround that has not been tried.

## The only requirement

cereale reads the metadata that a **TC39 standard** decorator transform emits. That means your
compiler must have `experimentalDecorators` **off** — which is the default in TypeScript 5.0
and later, but not what several frameworks scaffold.

There is no partial credit and no per-file override: `experimentalDecorators` is a property of
a TypeScript *program*, so every decorator in one compilation uses the same system. If the flag
is on, `tsc` refuses cereale's decorators outright:

```
error TS1240: Unable to resolve signature of property decorator when called as an expression.
  Argument of type 'User' is not assignable to parameter of type 'undefined'.
```

and if you skip type-checking (esbuild, swc and Babel all strip types without checking them),
the emit reaches cereale as a legacy call and it says so by name rather than failing obscurely.

## Two ways to adopt it

**Inline** — write cereale decorators directly in your app. Needs `experimentalDecorators: false`.
This is what you want, and most toolchains allow it.

**A precompiled models package** — when the program is committed to legacy decorators for
something else (NestJS's DI, TypeORM entities, Next's SWC pipeline), put your cereale classes in
a separate package compiled by `tsc`, and import the built output. The decorators run at class
definition time inside that package; your app only ever sees plain JavaScript, so its own
decorator setting is irrelevant. Verified working inside a program with **both**
`experimentalDecorators: true` and `emitDecoratorMetadata: true`.

You keep the compile-time guarantee where it matters — in the package where the rules are
written — and lose nothing at runtime.

## Support

Verified on the versions listed, on 2026-08-05. ✅ inline, ⚠️ via a precompiled package.
Rows marked — were not tested; they are listed so their absence is not mistaken for a verdict.

| Toolchain | | Notes |
| --- | --- | --- |
| `tsc` 5.2+ | ✅ | `experimentalDecorators: false`, `target: ES2022`+ |
| **Angular** 21 | ✅ | flip the scaffolded `experimentalDecorators` to `false` — Angular does not need it |
| **Vite** 8 | ✅ | add `cereale/vite`; covers React, Vue, Svelte, Solid, Qwik, Astro, Nuxt, SvelteKit |
| **Vitest** 4 | ✅ | same plugin |
| **Bun** 1.3 | ✅ | works with no configuration |
| esbuild 0.25 | ✅ | top-level `target: es2022`+ **and** `experimentalDecorators: false` |
| swc 1.15 | ✅ | `jsc.transform.decoratorVersion: "2022-03"` |
| **Next.js** 16 | ⚠️ | no inline support — see below |
| **NestJS** 11.1 | ⚠️ | its DI needs `emitDecoratorMetadata` — see below |
| Deno | — | untested |
| webpack + `ts-loader` | — | untested; follows whatever `tsc` is configured to do |

---

## Angular

The surprise is that Angular works. The CLI scaffolds `"experimentalDecorators": true`, but
Angular's compiler does not need it — `ngtsc` erases `@Component` and `@Injectable` into static
properties itself, rather than relying on TypeScript's decorator emit. Turn the flag off and
both work in the same program.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": false,   // was true; Angular does not need it
    "target": "ES2022",
    "lib": ["ESNext", "DOM", "ESNext.Decorators"]
  }
}
```

```ts
// user.dto.ts
import { IsString, MinLength, IsInt, Min, JsonProperty } from 'cereale';

export class UserDto {
  @JsonProperty('display_name')
  @IsString() @MinLength(3)
  displayName!: string;

  @IsInt() @Min(18)
  age!: number;
}
```

```ts
// user.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { toInstanceSync } from 'cereale';
import { UserDto } from './user.dto';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);

  load(id: string) {
    return this.http.get(`/api/users/${id}`).pipe(map(body => toInstanceSync(UserDto, body)));
  }
}
```

Verified with `ngc` on Angular 21.2 and `strictTemplates: true`: the component's template is
still type-checked, and a wrong cereale rule is still a compile error inside the Angular build —
`@IsString()` on `age!: number` fails with TS1240 exactly as it does anywhere else.

## Any Vite app — React, Vue, Svelte, Solid, Astro, Nuxt, SvelteKit

Vite 8 transforms with oxc, which does not implement the standard decorator transform **and does
not report that**. `vite build` succeeds and leaves the decorator syntax in the bundle, which
throws the moment anything imports it. cereale ships the plugin that fixes it.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';          // or vue(), svelte(), solid()…
import { standardDecorators } from 'cereale/vite';

export default defineConfig({
  plugins: [standardDecorators(), react()],
});
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "target": "ES2022",
    "lib": ["ESNext", "DOM", "ESNext.Decorators"]
  }
}
```

```tsx
// UserForm.tsx
import { useState } from 'react';
import { toInstanceSync, validateSync, flattenErrors } from 'cereale';
import { UserDto } from './user.dto';   // a .ts file, not .tsx — see below

export function UserForm() {
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function onSubmit(form: FormData) {
    const draft = toInstanceSync(UserDto, Object.fromEntries(form), { validate: false });
    setErrors(flattenErrors(validateSync(draft)));
  }
  // …
}
```

The plugin transforms `.ts`, `.mts` and `.cts` outside `node_modules`. `.tsx` is excluded by
default, because lowering decorators there means also deciding what happens to the JSX — keep
decorated classes in `.ts` files, or pass an `include` of your own:

```ts
standardDecorators({ include: (id) => /\.[cm]?tsx?$/.test(id) && !id.includes('/node_modules/') })
```

Options: `include`, `target` (default `es2022`), and `transformer` (`'auto'` prefers esbuild and
falls back to the TypeScript compiler; cereale depends on neither).

## Vitest

Same plugin, same reason — Vitest 4 uses the same oxc pipeline, and without it prints `0 test`
next to a bare `SyntaxError`.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { standardDecorators } from 'cereale/vite';

export default defineConfig({ plugins: [standardDecorators()] });
```

## Node, with tsc

Nothing to configure beyond the flag.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "lib": ["ESNext", "ESNext.Decorators"],
    "experimentalDecorators": false,
    "strictPropertyInitialization": false   // optional; `field!: T` otherwise needs the `!`
  }
}
```

```ts
import express from 'express';
import { fromJsonSync, JsonValidationError, flattenErrors } from 'cereale';
import { UserDto } from './user.dto.js';

app.post('/users', (req, res) => {
  try {
    const user = fromJsonSync(UserDto, JSON.stringify(req.body));
    return res.status(201).json(user);
  } catch (error) {
    if (error instanceof JsonValidationError) {
      return res.status(400).json({ errors: flattenErrors(error.errors) });
    }
    throw error;
  }
});
```

## Bun

Works with no configuration — Bun's transpiler emits standard decorators when
`experimentalDecorators` is off, which is its default.

```bash
bun add cereale
bun run app.ts
```

## Next.js

**Not supported inline.** Next derives *both* the SWC parser's decorator support and its
transform mode from the single `experimentalDecorators` flag:

```js
const enableDecorators = Boolean(jsConfig?.compilerOptions?.experimentalDecorators);
//  parser:    decorators: enableDecorators
//  transform: legacyDecorator: enableDecorators
```

So the flag on gives legacy emit that cereale refuses, and the flag off makes `@` a syntax
error. There is no third setting, and no exposed `decoratorVersion` option.

Use a precompiled models package instead:

```
repo/
  models/            ← compiled by tsc, experimentalDecorators: false
    package.json     { "name": "@acme/models", "exports": { ".": "./dist/index.js" } }
    tsconfig.json
    src/user.dto.ts  ← your cereale classes live here
  web/               ← the Next app, untouched
    package.json     { "dependencies": { "@acme/models": "workspace:*" } }
```

```jsonc
// models/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "ESNext.Decorators"],
    "experimentalDecorators": false,
    "useDefineForClassFields": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

Build `models` before `web`. Next only ever sees the compiled JavaScript — no decorator syntax
reaches its parser — and mapping and validation work normally. Verified against Next 16.3's own
SWC configuration.

## NestJS

**Not supported inline.** Nest scaffolds `experimentalDecorators: true` *and*
`emitDecoratorMetadata: true`, and its dependency injection genuinely needs the `design:type`
metadata that only legacy decorators emit. Turning the flag off breaks Nest.

The precompiled models package above works here too, and this is the case that proves the
pattern: a program compiled with **both** legacy flags on can import cereale DTOs from a
precompiled package and validate with them normally, alongside its own `@Injectable()` and
`@Inject()` decorators.

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { UserDto } from '@acme/models';                  // precompiled
import { toInstanceSync, validateSync, formatErrors } from 'cereale';

@Injectable()
export class UsersService {
  create(body: unknown) {
    const draft = toInstanceSync(UserDto, body, { validate: false });
    const errors = validateSync(draft);
    if (errors.length) throw new BadRequestException(formatErrors(errors));
    return draft;
  }
}
```

If you would rather not split the package, stay on class-validator for now — Nest's own
`ValidationPipe` is built around it, and cereale does not try to replace that integration.

## Other bundlers

**esbuild** needs its own top-level `target`, not one inside `tsconfigRaw`. A `target` in
`tsconfigRaw` sets the `useDefineForClassFields` default and nothing else, so the decorators
are left in the output:

```js
await esbuild.build({
  target: 'es2022',                                   // ← required, and top-level
  tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
});
```

**swc** spells the choice as a proposal date:

```jsonc
// .swcrc
{
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "decoratorVersion": "2022-03" },
    "target": "es2022"
  }
}
```

## A single file, no bundler

`cereale/min` is the whole library flattened into one minified ES module (25.5 KB, 8.6 KB
gzipped) for import maps, `<script type="module">`, Deno and Workers. Bundler users should keep
the default entry point: measured through esbuild and through rollup + terser, the two produce
consumer bundles within a couple of hundred bytes of each other and tree-shake identically, and
the per-module build keeps readable stack traces.

```html
<script type="importmap">
  { "imports": { "cereale": "https://unpkg.com/cereale/dist/cereale.min.js" } }
</script>
```
