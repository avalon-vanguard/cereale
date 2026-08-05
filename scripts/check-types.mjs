/**
 * Compiles a minimal consumer against the built type declarations, in the least forgiving
 * configuration a real project might have: no `skipLibCheck`, no `DOM` lib, no `types`.
 *
 * A zero-dependency library's public types have to stand on their own. `fromRequest` used to
 * be declared as taking the global `Request`, so cereale's own `.d.ts` raised
 * `Cannot find name 'Request'` in any project whose `lib` and `types` did not happen to
 * supply it — an error inside a dependency, in code the consumer may never call, that they
 * cannot fix from the outside. The library's own test suite hid it by enabling both.
 *
 * Run after `npm run build`, since it checks what is actually published.
 */
import ts from 'typescript';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const types = path.join(root, 'dist/esm/index.d.ts');

try {
  await access(types);
} catch {
  console.error('dist/esm/index.d.ts is missing — run `npm run build` first.');
  process.exit(1);
}

const CONSUMER = `
import {
  IsString, MinLength, IsInt, Min, IsDate, JsonProperty, JsonWriteOnly,
  ValidateNested, JsonType, fromJsonSync, toPlainSync, validateSync, fromRequest,
} from ${JSON.stringify(types.replace(/\.d\.ts$/, '.js'))};

class Address {
  @IsString() city!: string;
}

export class User {
  @JsonProperty('display_name')
  @IsString() @MinLength(2)
  displayName!: string;

  @IsInt() @Min(0)
  age!: number;

  @IsDate()
  joinedAt!: Date;

  @JsonWriteOnly() @IsString()
  password!: string;

  @ValidateNested() @JsonType(() => Address)
  address!: Address;

  greet(): string { return 'Hi ' + this.displayName; }
}

export function use(body: string) {
  const user = fromJsonSync(User, body);
  return [user.greet(), toPlainSync(user), validateSync(user)];
}

// Declared structurally, so this must type-check without the DOM or Node globals.
export function fromAnythingWithJson(source: { json(): Promise<unknown> }) {
  return fromRequest(User, source);
}
`;

const dir = await mkdtemp(path.join(tmpdir(), 'cereale-consumer-'));
try {
  const file = path.join(dir, 'consumer.ts');
  await writeFile(file, CONSUMER);

  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Deliberately bare: no DOM, no node, and lib checking left on.
    lib: ['lib.esnext.d.ts', 'lib.esnext.decorators.d.ts'],
    types: [],
    strict: true,
    strictPropertyInitialization: false,
    skipLibCheck: false,
    noEmit: true,
  });

  const diagnostics = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  if (diagnostics.length > 0) {
    console.error(
      'cereale\'s published types do not stand alone. A consumer without DOM lib or @types/node sees:\n' +
      diagnostics.slice(0, 12).map((d) => {
        const where = d.file ? `${path.basename(d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ` : '';
        return `  - ${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      }).join('\n')
    );
    process.exit(1);
  }

  console.log('type check passed — published types resolve with no DOM lib and no @types/node.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
